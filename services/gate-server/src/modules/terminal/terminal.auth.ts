import { sameSecret, sha256 } from '../../shared/secret.ts';
import type { Gate } from '../gate/gate.types.ts';

export function bearerToken(header: string | undefined): string {
  return (header ?? '').replace(/^Bearer /, '');
}

/** 단말 기기 토큰으로 어느 게이트의 어느 단말인지 찾음. DB에는 해시만 있다 */
export function findTerminal(
  gates: Pick<Gate, 'gateKey' | 'terminals'>[],
  token: string,
): { gateKey: number; terminalKey: number } | undefined {
  if (!token) return undefined;
  const hash = sha256(token);
  for (const gate of gates)
    for (const terminal of gate.terminals)
      if (sameSecret(terminal.tokenHash, hash))
        return { gateKey: gate.gateKey, terminalKey: terminal.terminalKey };
  return undefined;
}
