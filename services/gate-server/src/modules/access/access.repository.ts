import { jamoLike } from '../../shared/jamo.ts';
import type { DatabaseSync } from 'node:sqlite';
import type {
  AccessFilter,
  AccessLogRow,
  AccessLogView,
  NewAccessLog,
  RemoteOpenLog,
} from './access.types.ts';

type UpdatableField = 'openedAt' | 'disappearTime' | 'durationSec' | 'fullImage' | 'cropImage';

const UPDATABLE_COLUMNS: Record<UpdatableField, string> = {
  openedAt: 'opened_at',
  disappearTime: 'disappear_time',
  durationSec: 'duration_sec',
  fullImage: 'full_image',
  cropImage: 'crop_image',
};

const SELECT_ROW = `SELECT event_key AS eventKey, terminal_key AS terminalKey, gate_key AS gateKey,
  employee_key AS employeeKey, ai_track_key AS aiTrackKey, method, result,
  appear_time AS appearTime, received_at AS receivedAt, opened_at AS openedAt,
  disappear_time AS disappearTime, duration_sec AS durationSec,
  full_image AS fullImage, crop_image AS cropImage
  , remote_reason AS remoteReason, remote_note AS remoteNote, visitor_name AS visitorName,
  visitor_company AS visitorCompany, visit_target_key AS visitTargetKey, admin_key AS adminKey
  FROM access_log`;

const nextDay = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

export type AccessRepository = ReturnType<typeof createAccessRepository>;

export function createAccessRepository(sql: DatabaseSync) {
  return {
    insertAccessLog(row: NewAccessLog): number {
      const result = sql
        .prepare(
          `INSERT INTO access_log (terminal_key, gate_key, employee_key, ai_track_key, method, result,
             appear_time, received_at, opened_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          row.terminalKey,
          row.gateKey,
          row.employeeKey,
          row.aiTrackKey,
          row.method,
          row.result,
          row.appearTime,
          row.receivedAt,
          row.openedAt,
        );
      return Number(result.lastInsertRowid);
    },

    insertRemoteOpen(row: RemoteOpenLog): number {
      return Number(
        sql
          .prepare(
            `INSERT INTO access_log (gate_key, method, result, received_at, opened_at, remote_reason,
               remote_note, visitor_name, visitor_company, visit_target_key, admin_key)
             VALUES (?, 'REMOTE', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            row.gateKey,
            row.result,
            row.receivedAt,
            row.openedAt,
            row.remoteReason,
            row.remoteNote,
            row.visitorName,
            row.visitorCompany,
            row.visitTargetKey,
            row.adminKey,
          ).lastInsertRowid,
      );
    },

    updateAccessLog(
      eventKey: number,
      fields: Partial<Record<UpdatableField, string | number | null>>,
    ): void {
      const names = Object.keys(fields) as UpdatableField[];
      for (const name of names) {
        if (!(name in UPDATABLE_COLUMNS)) throw new Error(`${name} is not updatable`);
      }
      if (names.length === 0) return;
      const assignments = names.map((name) => `${UPDATABLE_COLUMNS[name]} = ?`).join(', ');
      sql
        .prepare(`UPDATE access_log SET ${assignments} WHERE event_key = ?`)
        .run(...names.map((name) => fields[name] ?? null), eventKey);
    },

    getAccessLog(eventKey: number): AccessLogRow | undefined {
      return sql.prepare(`${SELECT_ROW} WHERE event_key = ?`).get(eventKey) as
        AccessLogRow | undefined;
    },

    /** 사진을 아직 안 지운, 기준 시각 이전 출입 기록 */
    eventsToPurge(before: string): number[] {
      return (
        sql
          .prepare(
            'SELECT event_key AS eventKey FROM access_log WHERE received_at < ? AND images_purged = 0',
          )
          .all(before) as { eventKey: number }[]
      ).map((row) => row.eventKey);
    },

    markImagesPurged(eventKeys: number[]): void {
      const update = sql.prepare(
        'UPDATE access_log SET full_image = NULL, crop_image = NULL, images_purged = 1 WHERE event_key = ?',
      );
      // 행마다 커밋하면 처음 큰 정리 때 오래 멈추므로 한 트랜잭션으로
      sql.exec('BEGIN');
      try {
        for (const eventKey of eventKeys) update.run(eventKey);
        sql.exec('COMMIT');
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },

    /** 최신순. 날짜는 서버 수신 시각(received_at) 기준 한국 날짜 */
    searchAccessLogs(filter: AccessFilter): AccessLogView[] {
      const like = filter.q ? jamoLike(filter.q) : null;
      return sql
        .prepare(
          `SELECT l.*, e.employee_no AS employeeNo, e.name AS employeeName, e.department
           FROM (${SELECT_ROW}) l LEFT JOIN employee e ON e.employee_key = l.employeeKey
           WHERE (?1 IS NULL OR l.receivedAt >= ?1) AND (?2 IS NULL OR l.receivedAt < ?2)
             AND (?3 IS NULL OR l.gateKey = ?3) AND (?4 IS NULL OR l.result = ?4)
             AND (?5 IS NULL OR l.method = ?5) AND (?6 IS NULL OR l.eventKey < ?6)
             AND (?7 IS NULL OR jamo(e.name) LIKE ?7 ESCAPE '\\' OR jamo(e.employee_no) LIKE ?7 ESCAPE '\\'
                  OR jamo(l.visitorName) LIKE ?7 ESCAPE '\\')
           ORDER BY l.eventKey DESC LIMIT ?8`,
        )
        .all(
          filter.from ?? null,
          filter.to ? nextDay(filter.to) : null,
          filter.gateKey ?? null,
          filter.result ?? null,
          filter.method ?? null,
          filter.beforeEventKey ?? null,
          like,
          filter.limit,
        ) as AccessLogView[];
    },

    listAccessLogs(limit: number): AccessLogRow[] {
      return sql
        .prepare(`${SELECT_ROW} ORDER BY event_key DESC LIMIT ?`)
        .all(limit) as AccessLogRow[];
    },
  };
}
