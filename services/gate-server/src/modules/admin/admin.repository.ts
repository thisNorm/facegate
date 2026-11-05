import type { DatabaseSync } from 'node:sqlite';
import type { Admin, SessionKind } from './admin.types.ts';

export type AdminRow = Admin & {
  passwordHash: string;
  enabled: number;
  failedCount: number;
  lockedUntil: string | null;
  mustChangeCredentials: number;
};

export type AdminRepository = ReturnType<typeof createAdminRepository>;
const COLUMNS = `admin_key AS adminKey, login_id AS loginId, name, password_hash AS passwordHash,
                 enabled, failed_count AS failedCount, locked_until AS lockedUntil,
                 must_change_credentials AS mustChangeCredentials`;

export function createAdminRepository(sql: DatabaseSync) {
  return {
    addAdmin(admin: {
      loginId: string;
      name: string;
      passwordHash: string;
      createdAt: string;
      mustChangeCredentials?: boolean;
    }): number {
      return Number(
        sql
          .prepare(
            `INSERT INTO admin_user (login_id, name, password_hash, created_at, must_change_credentials)
         VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            admin.loginId,
            admin.name,
            admin.passwordHash,
            admin.createdAt,
            admin.mustChangeCredentials ? 1 : 0,
          ).lastInsertRowid,
      );
    },

    countAdmins(): number {
      return (sql.prepare('SELECT COUNT(*) AS n FROM admin_user').get() as { n: number }).n;
    },

    findByLoginId(loginId: string): AdminRow | undefined {
      return sql.prepare(`SELECT ${COLUMNS} FROM admin_user WHERE login_id = ?`).get(loginId) as
        AdminRow | undefined;
    },

    findByKey(adminKey: number): AdminRow | undefined {
      return sql.prepare(`SELECT ${COLUMNS} FROM admin_user WHERE admin_key = ?`).get(adminKey) as
        AdminRow | undefined;
    },

    listAdmins(): {
      adminKey: number;
      loginId: string;
      name: string;
      enabled: boolean;
      createdAt: string;
    }[] {
      const rows = sql
        .prepare(
          `SELECT admin_key AS adminKey, login_id AS loginId, name, enabled, created_at AS createdAt
         FROM admin_user ORDER BY admin_key`,
        )
        .all() as {
        adminKey: number;
        loginId: string;
        name: string;
        enabled: number;
        createdAt: string;
      }[];
      return rows.map((row) => ({ ...row, enabled: row.enabled === 1 }));
    },

    setFailures(adminKey: number, failedCount: number, lockedUntil: string | null): void {
      sql
        .prepare('UPDATE admin_user SET failed_count = ?, locked_until = ? WHERE admin_key = ?')
        .run(failedCount, lockedUntil, adminKey);
    },

    setEnabled(adminKey: number, enabled: boolean): void {
      sql
        .prepare('UPDATE admin_user SET enabled = ? WHERE admin_key = ?')
        .run(enabled ? 1 : 0, adminKey);
    },

    setPassword(adminKey: number, passwordHash: string): void {
      sql
        .prepare('UPDATE admin_user SET password_hash = ? WHERE admin_key = ?')
        .run(passwordHash, adminKey);
    },

    setCredentials(adminKey: number, loginId: string, passwordHash: string): void {
      sql
        .prepare(
          'UPDATE admin_user SET login_id = ?, password_hash = ?, must_change_credentials = 0 WHERE admin_key = ?',
        )
        .run(loginId, passwordHash, adminKey);
    },

    deleteAdmin(adminKey: number): void {
      sql.prepare('DELETE FROM admin_user WHERE admin_key = ?').run(adminKey);
    },

    addSession(session: {
      tokenHash: string;
      adminKey: number;
      kind: SessionKind;
      expiresAt: string;
      createdAt: string;
    }): void {
      sql
        .prepare(
          'INSERT INTO admin_session (token_hash, admin_key, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(
          session.tokenHash,
          session.adminKey,
          session.kind,
          session.expiresAt,
          session.createdAt,
        );
    },

    findSession(tokenHash: string, kind: SessionKind, now: string): Admin | undefined {
      return sql
        .prepare(
          `SELECT a.admin_key AS adminKey, a.login_id AS loginId, a.name
         FROM admin_session s JOIN admin_user a ON a.admin_key = s.admin_key
         WHERE s.token_hash = ? AND s.kind = ? AND s.expires_at > ? AND a.enabled = 1`,
        )
        .get(tokenHash, kind, now) as Admin | undefined;
    },

    deleteSession(tokenHash: string): void {
      sql.prepare('DELETE FROM admin_session WHERE token_hash = ?').run(tokenHash);
    },

    deleteSessionsOf(adminKey: number, keepTokenHash: string | null = null): void {
      sql
        .prepare('DELETE FROM admin_session WHERE admin_key = ? AND token_hash IS NOT ?')
        .run(adminKey, keepTokenHash);
    },

    deleteExpiredSessions(now: string): void {
      sql.prepare('DELETE FROM admin_session WHERE expires_at <= ?').run(now);
    },
  };
}
