import type { DatabaseSync } from 'node:sqlite';
import type { AuditEntry, AuditLog } from './audit.types.ts';

/** `employee:7`처럼 콜론 뒤 번호 */
const ID = (column: string) => `CAST(substr(${column}, instr(${column}, ':') + 1) AS INTEGER)`;

export type AuditRepository = ReturnType<typeof createAuditRepository>;

export function createAuditRepository(sql: DatabaseSync) {
  return {
    add(entry: AuditEntry, createdAt: string, via: string | null = null): void {
      sql
        .prepare(
          'INSERT INTO audit_log (admin_key, action, target, detail, created_at, via) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          entry.adminKey,
          entry.action,
          entry.target,
          entry.detail === null ? null : JSON.stringify(entry.detail),
          createdAt,
          via,
        );
    },

    list(limit: number, offset = 0): AuditLog[] {
      const rows = sql
        .prepare(
          `SELECT l.audit_key AS auditKey, l.admin_key AS adminKey, a.name AS adminName, l.action,
                  l.target, l.detail, l.created_at AS createdAt, l.via,
                  (SELECT t.name || ' (' || g.name || ')' FROM terminal t JOIN gate g ON g.gate_key = t.gate_key
                   WHERE l.via LIKE 'TERMINAL:%' AND t.terminal_key = ${ID('l.via')}) AS viaName,
                  CASE substr(l.target, 1, instr(l.target, ':') - 1)
                    WHEN 'employee' THEN (SELECT name FROM employee WHERE employee_key = ${ID('l.target')})
                    WHEN 'admin' THEN (SELECT name FROM admin_user WHERE admin_key = ${ID('l.target')})
                    WHEN 'gate' THEN (SELECT name FROM gate WHERE gate_key = ${ID('l.target')})
                    WHEN 'org' THEN (SELECT name FROM org WHERE org_key = ${ID('l.target')})
                    WHEN 'group' THEN (SELECT name FROM access_group WHERE group_key = ${ID('l.target')})
                    WHEN 'schedule' THEN (SELECT name FROM schedule WHERE schedule_key = ${ID('l.target')})
                    WHEN 'terminal' THEN (SELECT name FROM terminal WHERE terminal_key = ${ID('l.target')})
                    WHEN 'visitor-call' THEN (SELECT g.name FROM visitor_call c JOIN gate g ON g.gate_key = c.gate_key
                                              WHERE c.call_key = ${ID('l.target')})
                  END AS targetName
           FROM audit_log l LEFT JOIN admin_user a ON a.admin_key = l.admin_key
           ORDER BY l.audit_key DESC LIMIT ? OFFSET ?`,
        )
        .all(limit, offset) as (Omit<AuditLog, 'detail'> & { detail: string | null })[];
      return rows.map((row) => ({
        ...row,
        detail: row.detail === null ? null : JSON.parse(row.detail),
      }));
    },

    count(): number {
      return (sql.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n;
    },
  };
}
