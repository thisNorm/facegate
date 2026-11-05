import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { AccessResult } from '../access/access.types.ts';
import type { LightColor } from '../setting/setting.service.ts';

// 단말과 주고받는 외부 계약이라 필드는 snake_case (contracts/examples/decision-*.json, 04 문서 IF-2)
export type DecisionMessage = {
  type: 'decision';
  event_key: number;
  result: AccessResult;
  at: string;
  name?: string;
  department?: string;
};

export type TerminalMessage =
  | DecisionMessage
  // 외관 불빛 색이 바뀌었을 때 (값은 LIGHT_COLORS)
  | { type: 'light'; idle: LightColor; granted: LightColor; denied: LightColor }
  // 음성 안내 문구가 바뀌었을 때. 빈 글자면 말하지 않음
  | { type: 'voice'; granted: string; denied: string; unregistered: string };

export interface TerminalHub {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  broadcast(gateKey: number, message: TerminalMessage): void;
  /** 단말이 지금 연결되어 있는지 (상태 대시보드) */
  isConnected(terminalKey: number): boolean;
  /** 연결 해제된 단말의 소켓을 닫기 코드 4401로 닫는다 */
  disconnect(terminalKey: number): void;
}
