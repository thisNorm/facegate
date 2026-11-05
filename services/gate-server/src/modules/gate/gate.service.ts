import { openDryContact, writeCoil } from './adapters/dry-contact.adapter.ts';
import type { Gate, GateControl } from './gate.types.ts';

// 게이트 종류와 상관없는 공통 명령 (04 문서 IF-3). 게이트가 선정되면 adapters/에 어댑터를 추가한다 (D-27).
export function createGateControl({
  log = console.log,
  offRetryMs,
}: { log?: (line: string) => void; offRetryMs?: number } = {}): GateControl {
  return {
    async open(gate: Gate) {
      const { adapter } = gate;
      switch (adapter.type) {
        case 'MOCK':
          log(`gate ${gate.gateKey} open (MOCK)`);
          return;
        case 'DRY_CONTACT':
          return openDryContact(adapter, log, offRetryMs);
        default:
          throw new Error(`unknown gate adapter ${(adapter as { type: string }).type}`);
      }
    },

    async releaseAll(gates: Gate[]) {
      for (const { gateKey, adapter } of gates) {
        if (adapter.type !== 'DRY_CONTACT') continue;
        const { host, port, unitId, coil } = adapter;
        try {
          await writeCoil({ host, port, unitId, coil, on: false });
        } catch (error) {
          log(`gate ${gateKey} startup release failed: ${(error as Error).message}`);
        }
      }
    },
  };
}
