import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Gate } from '../gate/gate.types.ts';
import { isIpv4 } from '../gate/gate.dto.ts';
import { bearerToken, findTerminal } from './terminal.auth.ts';
import type { TerminalHub, TerminalMessage } from './terminal.types.ts';

const PING_INTERVAL_MS = 30_000;

export function createTerminalHub({
  gates,
  onConnect,
}: {
  gates: Pick<Gate, 'gateKey' | 'terminals'>[];
  /** 접속이 열릴 때마다. reported는 단말이 X-Terminal-Addresses로 알려 준 자기 IPv4들 */
  onConnect?: (terminalKey: number, address: string, reported: string[]) => void;
}) {
  const wss = new WebSocketServer({ noServer: true });
  /** 단말별 열린 소켓. 재접속이 겹치면 잠시 둘일 수 있다 */
  const byTerminal = new Map<number, Set<WebSocket>>();
  const alive = new WeakMap<WebSocket, boolean>();

  const pingTimer = setInterval(() => {
    for (const sockets of byTerminal.values()) {
      for (const ws of sockets) {
        if (alive.get(ws) === false) {
          ws.terminate();
          continue;
        }
        alive.set(ws, false);
        ws.ping();
      }
    }
  }, PING_INTERVAL_MS);

  function reject(socket: Duplex, status: number) {
    socket.write(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  }

  const hub: TerminalHub & { close(): void } = {
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
      let url: URL;
      try {
        url = new URL(req.url ?? '', 'http://localhost');
      } catch {
        return reject(socket, 400);
      }
      if (url.pathname !== '/ws/terminal') return reject(socket, 404);
      // 게이트는 토큰으로 정한다. 관리자 웹에서 단말을 옮겨도 단말이 들고 있는 gate_key와 상관없이 붙는다
      const found = findTerminal(gates, bearerToken(req.headers.authorization));
      if (!found) return reject(socket, 401);
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.on('error', () => ws.terminate());
        alive.set(ws, true);
        ws.on('pong', () => alive.set(ws, true));
        const sockets = byTerminal.get(found.terminalKey) ?? new Set<WebSocket>();
        sockets.add(ws);
        byTerminal.set(found.terminalKey, sockets);
        ws.on('close', () => sockets.delete(ws));
        const reported = String(req.headers['x-terminal-addresses'] ?? '')
          .split(',')
          .map((a) => a.trim())
          .filter(isIpv4)
          .slice(0, 4);
        onConnect?.(
          found.terminalKey,
          (req.socket.remoteAddress ?? '').replace(/^::ffff:/, ''),
          reported,
        );
      });
    },

    broadcast(gateKey: number, message: TerminalMessage) {
      const text = JSON.stringify(message);
      const gate = gates.find((g) => g.gateKey === gateKey);
      for (const { terminalKey } of gate?.terminals ?? [])
        for (const ws of byTerminal.get(terminalKey) ?? []) ws.send(text);
    },

    isConnected(terminalKey: number) {
      return (byTerminal.get(terminalKey)?.size ?? 0) > 0;
    },

    disconnect(terminalKey: number) {
      // 4401: 연결 해제됨. 단말은 연결 정보를 지우고 미연결 화면으로 간다
      for (const ws of byTerminal.get(terminalKey) ?? []) ws.close(4401, 'unpaired');
    },

    close() {
      clearInterval(pingTimer);
      for (const sockets of byTerminal.values()) {
        for (const ws of sockets) ws.terminate();
      }
      byTerminal.clear();
      wss.close();
    },
  };
  return hub;
}
