import type { DatabaseSync } from 'node:sqlite';
import type { GateAdapter } from './gate.types.ts';

export type GateRow = {
  gateKey: number;
  name: string;
  adapter: GateAdapter;
  /** 지하는 음수. 모르면 null */
  floor: number | null;
  /** 로비 등 소속 권한 없이 모든 사람이 통과 (D-59) */
  openToAll: boolean;
};
export type TerminalRow = {
  terminalKey: number;
  gateKey: number;
  name: string;
  model: string | null;
  appVersion: string | null;
  tokenHash: string;
  rtspUser: string;
  rtspPassword: string;
  rtspPort: number;
  lastIp: string;
  lastSeenAt: string | null;
  pairedAt: string;
};
export type PairCode = {
  code: string;
  gateKey: number;
  issuedBy: number;
  expiresAt: string;
  usedAt: string | null;
};
export type GateRepository = ReturnType<typeof createGateRepository>;

const TERMINAL_COLUMNS = `terminal_key AS terminalKey, gate_key AS gateKey, name, model,
  app_version AS appVersion, token_hash AS tokenHash, rtsp_user AS rtspUser,
  rtsp_password AS rtspPassword, rtsp_port AS rtspPort, last_ip AS lastIp,
  last_seen_at AS lastSeenAt, paired_at AS pairedAt`;

const GATE_COLUMNS = 'gate_key AS gateKey, name, adapter, floor, open_to_all AS openToAll';
type RawGate = {
  gateKey: number;
  name: string;
  adapter: string;
  floor: number | null;
  openToAll: number;
};
const toGate = (row: RawGate): GateRow => ({
  gateKey: row.gateKey,
  name: row.name,
  adapter: JSON.parse(row.adapter) as GateAdapter,
  floor: row.floor,
  openToAll: row.openToAll === 1,
});
const changed = (r: { changes: number | bigint }) => Number(r.changes) > 0;

export function createGateRepository(sql: DatabaseSync) {
  return {
    listGates(): GateRow[] {
      return (
        sql
          .prepare(`SELECT ${GATE_COLUMNS} FROM gate ORDER BY floor IS NULL, floor, gate_key`)
          .all() as RawGate[]
      ).map(toGate);
    },

    getGate(gateKey: number): GateRow | undefined {
      const row = sql
        .prepare(`SELECT ${GATE_COLUMNS} FROM gate WHERE gate_key = ?`)
        .get(gateKey) as RawGate | undefined;
      return row && toGate(row);
    },

    /** gateKey를 주면 그 번호로 (gates.json 가져오기), 없으면 다음 번호 */
    insertGate(
      g: {
        gateKey?: number;
        name: string;
        adapter: GateAdapter;
        floor?: number | null;
        openToAll?: boolean;
      },
      at: string,
    ): number {
      const r = sql
        .prepare(
          'INSERT INTO gate (gate_key, name, adapter, floor, open_to_all, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          g.gateKey ?? null,
          g.name,
          JSON.stringify(g.adapter),
          g.floor ?? null,
          g.openToAll ? 1 : 0,
          at,
        );
      return Number(r.lastInsertRowid);
    },

    updateGate(
      gateKey: number,
      g: { name: string; adapter: GateAdapter; floor: number | null; openToAll: boolean },
    ): boolean {
      return changed(
        sql
          .prepare(
            'UPDATE gate SET name = ?, adapter = ?, floor = ?, open_to_all = ? WHERE gate_key = ?',
          )
          .run(g.name, JSON.stringify(g.adapter), g.floor, g.openToAll ? 1 : 0, gateKey),
      );
    },

    /** 단말이 붙어 있으면 외래 키 오류. 호출 전에 확인한다 */
    deleteGate(gateKey: number): boolean {
      return changed(sql.prepare('DELETE FROM gate WHERE gate_key = ?').run(gateKey));
    },

    listTerminals(): TerminalRow[] {
      return sql
        .prepare(`SELECT ${TERMINAL_COLUMNS} FROM terminal ORDER BY terminal_key`)
        .all() as TerminalRow[];
    },

    getTerminal(terminalKey: number): TerminalRow | undefined {
      return sql
        .prepare(`SELECT ${TERMINAL_COLUMNS} FROM terminal WHERE terminal_key = ?`)
        .get(terminalKey) as TerminalRow | undefined;
    },

    /** 단말 번호는 101부터 (AI device_key와 같은 값, D-56) */
    nextTerminalKey(): number {
      const row = sql.prepare('SELECT MAX(terminal_key) AS k FROM terminal').get() as {
        k: number | null;
      };
      return (row.k ?? 100) + 1;
    },

    insertTerminal(t: TerminalRow): void {
      sql
        .prepare(
          `INSERT INTO terminal (terminal_key, gate_key, name, model, app_version, token_hash,
             rtsp_user, rtsp_password, rtsp_port, last_ip, last_seen_at, paired_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          t.terminalKey,
          t.gateKey,
          t.name,
          t.model,
          t.appVersion,
          t.tokenHash,
          t.rtspUser,
          t.rtspPassword,
          t.rtspPort,
          t.lastIp,
          t.lastSeenAt,
          t.pairedAt,
        );
    },

    updateTerminal(terminalKey: number, t: { name?: string; gateKey?: number }): boolean {
      return changed(
        sql
          .prepare(
            `UPDATE terminal SET name = COALESCE(?, name), gate_key = COALESCE(?, gate_key)
             WHERE terminal_key = ?`,
          )
          .run(t.name ?? null, t.gateKey ?? null, terminalKey),
      );
    },

    deleteTerminal(terminalKey: number): boolean {
      return changed(sql.prepare('DELETE FROM terminal WHERE terminal_key = ?').run(terminalKey));
    },

    touchTerminal(terminalKey: number, ip: string, at: string): void {
      sql
        .prepare('UPDATE terminal SET last_ip = ?, last_seen_at = ? WHERE terminal_key = ?')
        .run(ip, at, terminalKey);
    },

    /** 게이트마다 살아 있는 코드는 하나. 새로 발급하면 쓰지 않은 이전 코드는 지운다 */
    replaceCode(c: { code: string; gateKey: number; issuedBy: number; expiresAt: string }): void {
      sql.prepare('DELETE FROM pair_code WHERE gate_key = ? AND used_at IS NULL').run(c.gateKey);
      sql
        .prepare(
          'INSERT OR REPLACE INTO pair_code (code, gate_key, issued_by, expires_at) VALUES (?, ?, ?, ?)',
        )
        .run(c.code, c.gateKey, c.issuedBy, c.expiresAt);
    },

    findCode(code: string): PairCode | undefined {
      return sql
        .prepare(
          `SELECT code, gate_key AS gateKey, issued_by AS issuedBy, expires_at AS expiresAt,
             used_at AS usedAt FROM pair_code WHERE code = ?`,
        )
        .get(code) as PairCode | undefined;
    },

    useCode(code: string, at: string): boolean {
      return changed(
        sql
          .prepare('UPDATE pair_code SET used_at = ? WHERE code = ? AND used_at IS NULL')
          .run(at, code),
      );
    },
  };
}
