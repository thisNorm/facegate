import { kstMs } from '../../shared/time.ts';
import type { AccessRepository } from '../access/access.repository.ts';
import type { RemoteOpenDto } from './gate.dto.ts';
import type { Gate, GateControl } from './gate.types.ts';

export type RemoteOpenService = ReturnType<typeof createRemoteOpenService>;

export function createRemoteOpenService({
  gates,
  gateControl,
  accessLogs,
  now,
}: {
  gates: Gate[];
  gateControl: GateControl;
  accessLogs: AccessRepository;
  now: () => Date;
}) {
  return {
    /** 없는 게이트면 null. 릴레이 실패도 기록하고 GATE_ERROR로 돌려줌 */
    async open(
      gateKey: number,
      dto: RemoteOpenDto,
      adminKey: number | null,
    ): Promise<{ eventKey: number; result: 'GRANTED' | 'GATE_ERROR' } | null> {
      const gate = gates.find((g) => g.gateKey === gateKey);
      if (!gate) return null;
      const receivedAt = kstMs(now());
      let result: 'GRANTED' | 'GATE_ERROR' = 'GRANTED';
      let openedAt: string | null = null;
      try {
        await gateControl.open(gate);
        openedAt = kstMs(now());
      } catch (error) {
        console.error(`remote open gate ${gateKey} failed: ${(error as Error).message}`);
        result = 'GATE_ERROR';
      }
      const eventKey = accessLogs.insertRemoteOpen({
        gateKey,
        result,
        receivedAt,
        openedAt,
        remoteReason: dto.reason,
        remoteNote: dto.note,
        visitorName: dto.visitor?.name ?? null,
        visitorCompany: dto.visitor?.company ?? null,
        visitTargetKey: dto.visitor?.targetEmployeeKey ?? null,
        adminKey,
      });
      return { eventKey, result };
    },
  };
}
