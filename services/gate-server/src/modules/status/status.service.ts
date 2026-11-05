import { kst, parseKst } from '../../shared/time.ts';
import type { AiRepository } from '../ai/ai.repository.ts';
import type { Gate } from '../gate/gate.types.ts';
import type { SettingService } from '../setting/setting.service.ts';
import type { TerminalHub } from '../terminal/terminal.types.ts';

export const AI_OFFLINE_AFTER_MS = 3 * 60 * 1000;

export type StatusSnapshot = ReturnType<ReturnType<typeof createStatusService>['snapshot']>;

/** AI 상태 보고(외부 계약 cameras, snake_case)에서 단말별 rtsp_ok만 뽑음. device_key = terminalKey */
function rtspByTerminal(reportJson: string | null): Map<number, boolean> {
  const map = new Map<number, boolean>();
  try {
    for (const item of JSON.parse(reportJson ?? '[]') as unknown[]) {
      const c = item as { device_key?: unknown; rtsp_ok?: unknown };
      if (typeof c.device_key === 'number' && typeof c.rtsp_ok === 'boolean')
        map.set(c.device_key, c.rtsp_ok);
    }
  } catch {
    // 형식이 깨졌으면 모름으로 둠
  }
  return map;
}

export function createStatusService({
  gates,
  aiStatus,
  terminalHub,
  settings,
  now,
}: {
  gates: Gate[];
  aiStatus: AiRepository;
  terminalHub: Pick<TerminalHub, 'isConnected'>;
  settings: Pick<SettingService, 'ingestKeyInfo'>;
  now: () => Date;
}) {
  return {
    snapshot() {
      const at = now();
      const status = aiStatus.getStatus();
      const last = parseKst(status?.lastStatusAt ?? null);
      const online = last !== null && at.getTime() - last.getTime() <= AI_OFFLINE_AFTER_MS;
      const rtsp = online ? rtspByTerminal(status?.rtspReport ?? null) : new Map<number, boolean>();
      return {
        checkedAt: kst(at),
        ai: {
          online,
          powerOnAt: status?.powerOnAt ?? null,
          lastStatusAt: status?.lastStatusAt ?? null,
        },
        ingestKeyIssued: settings.ingestKeyInfo().issued,
        gates: gates.map((gate) => ({
          gateKey: gate.gateKey,
          name: gate.name,
          floor: gate.floor,
          adapterType: gate.adapter.type,
          terminals: gate.terminals.map(({ terminalKey }) => ({
            terminalKey,
            connected: terminalHub.isConnected(terminalKey),
            /** AI가 이 단말 영상을 받고 있는지. 모르면 null */
            aiRtspOk: rtsp.get(terminalKey) ?? null,
          })),
        })),
      };
    },
  };
}
