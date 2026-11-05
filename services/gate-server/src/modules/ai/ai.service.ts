import { decide } from '../access/access.rules.ts';
import { decodeJpeg } from '../../shared/image.ts';
import { kst, kstMs } from '../../shared/time.ts';
import type { Repositories } from '../../app/repositories.ts';
import type { FileStore } from '../../infrastructure/filesystem/file-store.ts';
import type { AccessResult } from '../access/access.types.ts';
import type { Gate, GateControl } from '../gate/gate.types.ts';
import type { TerminalHub, TerminalMessage } from '../terminal/terminal.types.ts';
import type { AppearDto, DisappearDto, StatusDto } from './ai.dto.ts';

export type AiService = ReturnType<typeof createAiService>;

export function createAiService({
  duplicateWindowMs,
  repos,
  gates,
  gateControl,
  terminalHub,
  files,
  now,
}: {
  duplicateWindowMs: () => number;
  repos: Repositories;
  gates: Gate[];
  gateControl: GateControl;
  terminalHub: Pick<TerminalHub, 'broadcast'>;
  files: FileStore;
  now: () => Date;
}) {
  // 같은 사람의 반복 appear를 한 번의 방문으로 합침 (FR-S-08)
  const visits = new Map<
    string,
    { eventKey: Promise<number>; result?: AccessResult; lastMs: number }
  >();

  // 사진 저장은 응답·개방과 분리해 뒤에서 처리 (03 문서 4장)
  function saveImagesLater(
    eventKey: number,
    kind: 'appear' | 'disappear',
    fullFrame?: string,
    cropFrame?: string,
  ) {
    const save = async () => {
      const full = decodeJpeg(fullFrame);
      const crop = decodeJpeg(cropFrame);
      const fields: { fullImage?: string; cropImage?: string } = {};
      if (full) fields.fullImage = await files.saveEventImage(eventKey, `${kind}_full`, full);
      if (crop) fields.cropImage = await files.saveEventImage(eventKey, `${kind}_crop`, crop);
      if (kind === 'appear') repos.accessLogs.updateAccessLog(eventKey, fields);
    };
    save().catch((error: Error) =>
      console.error(`event ${eventKey} image save failed: ${error.message}`),
    );
  }

  async function processAppear(
    dto: AppearDto,
    gate: Gate,
    receivedAt: Date,
    visit: { result?: AccessResult },
  ): Promise<number> {
    const employee = dto.isWorker ? repos.employees.getEmployee(dto.workerKey) : undefined;
    let result: AccessResult = decide({
      isWorker: dto.isWorker,
      employee,
      access: employee ? repos.permissions.check(employee, gate, receivedAt) : 'NO_GATE',
      lastGrantedMs: undefined,
      nowMs: receivedAt.getTime(),
      duplicateWindowMs: duplicateWindowMs(),
    });

    let openedAt: string | null = null;
    if (result === 'GRANTED') {
      try {
        await gateControl.open(gate);
        openedAt = kstMs(now());
      } catch (error) {
        console.error(`gate ${gate.gateKey} open failed: ${(error as Error).message}`);
        result = 'GATE_ERROR';
      }
    }
    visit.result = result;

    const eventKey = repos.accessLogs.insertAccessLog({
      terminalKey: dto.terminalKey,
      gateKey: gate.gateKey,
      employeeKey: employee?.employeeKey ?? null,
      aiTrackKey: employee ? null : dto.workerKey,
      method: 'FACE',
      result,
      appearTime: dto.appearTime,
      receivedAt: kstMs(receivedAt),
      openedAt,
    });

    const message: TerminalMessage = {
      type: 'decision',
      event_key: eventKey,
      result,
      at: kst(receivedAt),
    };
    // 이름은 허가일 때만 (뒷사람에게 노출 방지, IF-2)
    if (result === 'GRANTED' && employee) {
      message.name = employee.name;
      message.department = employee.department;
    }
    terminalHub.broadcast(gate.gateKey, message);

    saveImagesLater(eventKey, 'appear', dto.fullFrame, dto.cropFrame);
    return eventKey;
  }

  return {
    rtspList() {
      return gates.flatMap((gate) =>
        gate.terminals.map((t) => ({ device_key: t.terminalKey, rtsp_uri: t.rtspUri })),
      );
    },

    dataset() {
      return repos.employees.faceDataset().map(({ employeeKey, fileNames }) => ({
        worker_key: employeeKey,
        image_path: fileNames.map((fileName) => `/file/${employeeKey}/${fileName}`),
      }));
    },

    facePath(employeeKey: number, fileName: string) {
      return files.facePath(employeeKey, fileName);
    },

    /** 모르는 단말이면 null */
    async handleAppear(dto: AppearDto): Promise<number | null> {
      // 게이트·단말은 관리자 웹에서 바뀌므로 호출 때마다 찾는다
      const gate = gates.find((g) => g.terminals.some((t) => t.terminalKey === dto.terminalKey));
      if (!gate) return null;

      const receivedAt = now();
      const receivedMs = receivedAt.getTime();
      const windowMs = duplicateWindowMs();
      for (const [key, visit] of visits)
        if (visit.result !== undefined && receivedMs - visit.lastMs >= windowMs) visits.delete(key);

      const visitKey = `${gate.gateKey}:${dto.isWorker ? 'w' : 'u'}:${dto.workerKey}`;
      const existing = visits.get(visitKey);
      if (existing && existing.result !== 'GATE_ERROR') {
        existing.lastMs = receivedMs; // 사람이 계속 보이는 동안 창이 이어진다
        return existing.eventKey;
      }

      const visit: NonNullable<typeof existing> = {
        eventKey: Promise.resolve(0),
        lastMs: receivedMs,
      };
      // await 전에 등록해야 동시 appear가 중복 개방하지 않는다
      visit.eventKey = processAppear(dto, gate, receivedAt, visit);
      visits.set(visitKey, visit);
      visit.eventKey.catch(() => {
        if (visits.get(visitKey) === visit) visits.delete(visitKey);
      });
      return visit.eventKey;
    },

    handleDisappear(dto: DisappearDto) {
      repos.accessLogs.updateAccessLog(dto.eventKey, {
        disappearTime: dto.disappearTime,
        durationSec: dto.durationSec,
      });
      saveImagesLater(dto.eventKey, 'disappear', dto.fullFrame, dto.cropFrame);
    },

    powerOn(eventTime: string) {
      repos.aiStatus.setPowerOn(eventTime);
    },

    status(dto: StatusDto) {
      // 온라인 판단은 서버 수신 시각 기준 (연동 문서)
      repos.aiStatus.setStatus(kst(now()), JSON.stringify(dto.rtspReport));
    },
  };
}
