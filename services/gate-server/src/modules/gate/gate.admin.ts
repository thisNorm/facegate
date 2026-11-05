import { kst } from '../../shared/time.ts';
import type { TerminalHub } from '../terminal/terminal.types.ts';
import type { GateRegistry } from './gate.registry.ts';
import type { GateRepository, GateRow } from './gate.repository.ts';
import type { GateAdapter } from './gate.types.ts';

export type GateInput = {
  name: string;
  adapter: GateAdapter;
  floor: number | null;
  openToAll: boolean;
};
export type GateAdmin = ReturnType<typeof createGateAdmin>;
export type GateView = GateRow & {
  terminals: {
    terminalKey: number;
    name: string;
    model: string | null;
    appVersion: string | null;
    ip: string;
    connected: boolean;
    lastSeenAt: string | null;
  }[];
};

/** 관리자 웹 게이트 화면 (D-57). 바꾸면 레지스트리를 다시 읽어 서버 전체에 바로 반영한다 */
export function createGateAdmin({
  repo,
  registry,
  terminalHub,
  now,
}: {
  repo: GateRepository;
  registry: GateRegistry;
  terminalHub: Pick<TerminalHub, 'isConnected' | 'disconnect'>;
  now: () => Date;
}) {
  const admin = {
    /** RTSP 계정·토큰은 내보내지 않는다 */
    view(gateKey: number): GateView | null {
      const gate = repo.getGate(gateKey);
      if (!gate) return null;
      const terminals = repo
        .listTerminals()
        .filter((t) => t.gateKey === gateKey)
        .map((t) => ({
          terminalKey: t.terminalKey,
          name: t.name,
          model: t.model,
          appVersion: t.appVersion,
          ip: t.lastIp,
          connected: terminalHub.isConnected(t.terminalKey),
          lastSeenAt: t.lastSeenAt,
        }));
      return { ...gate, terminals };
    },

    list(): GateView[] {
      return repo.listGates().map((g) => admin.view(g.gateKey)!);
    },

    create(input: GateInput): GateView {
      const gateKey = repo.insertGate(input, kst(now()));
      registry.reload();
      return admin.view(gateKey)!;
    },

    update(gateKey: number, input: GateInput): GateView | null {
      if (!repo.updateGate(gateKey, input)) return null;
      registry.reload();
      return admin.view(gateKey);
    },

    remove(gateKey: number): 'OK' | 'NOT_FOUND' | 'HAS_TERMINALS' {
      if (!repo.getGate(gateKey)) return 'NOT_FOUND';
      if (repo.listTerminals().some((t) => t.gateKey === gateKey)) return 'HAS_TERMINALS';
      repo.deleteGate(gateKey);
      registry.reload();
      return 'OK';
    },

    updateTerminal(
      terminalKey: number,
      change: { name?: string; gateKey?: number },
    ): 'OK' | 'NOT_FOUND' | 'NO_GATE' {
      if (!repo.getTerminal(terminalKey)) return 'NOT_FOUND';
      if (change.gateKey !== undefined && !repo.getGate(change.gateKey)) return 'NO_GATE';
      repo.updateTerminal(terminalKey, change);
      registry.reload();
      return 'OK';
    },

    /** 단말 행을 지워 토큰을 폐기하고, 접속 중이면 4401로 끊는다. 없으면 null */
    unpair(terminalKey: number): number | null {
      const terminal = repo.getTerminal(terminalKey);
      if (!terminal) return null;
      repo.deleteTerminal(terminalKey);
      registry.reload();
      terminalHub.disconnect(terminalKey);
      return terminal.gateKey;
    },
  };
  return admin;
}
