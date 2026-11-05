import type { GateRepository, TerminalRow } from './gate.repository.ts';
import type { Gate } from './gate.types.ts';

export type GateRegistry = ReturnType<typeof createGateRegistry>;

export function rtspUriOf(
  t: Pick<TerminalRow, 'rtspUser' | 'rtspPassword' | 'lastIp' | 'rtspPort'>,
): string {
  return `rtsp://${encodeURIComponent(t.rtspUser)}:${encodeURIComponent(t.rtspPassword)}@${t.lastIp}:${t.rtspPort}/`;
}

/**
 * DB의 게이트·단말을 지금 모듈들이 쓰는 Gate[] 모양으로 들고 있다.
 * 모듈들이 시작할 때 받은 배열을 계속 읽도록 같은 배열 객체의 내용만 바꾼다.
 */
export function createGateRegistry(repo: GateRepository) {
  const gates: Gate[] = [];
  return {
    gates,
    reload(): void {
      const terminals = repo.listTerminals();
      const next: Gate[] = repo.listGates().map((g) => ({
        ...g,
        terminals: terminals
          .filter((t) => t.gateKey === g.gateKey)
          .map((t) => ({
            terminalKey: t.terminalKey,
            tokenHash: t.tokenHash,
            rtspUri: rtspUriOf(t),
          })),
      }));
      gates.splice(0, gates.length, ...next);
    },
  };
}
