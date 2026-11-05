import type { DatabaseSync } from 'node:sqlite';

type AiStatus = {
  powerOnAt: string | null;
  lastStatusAt: string | null;
  rtspReport: string | null;
};

export type AiRepository = ReturnType<typeof createAiRepository>;

export function createAiRepository(sql: DatabaseSync) {
  return {
    setPowerOn(at: string): void {
      sql
        .prepare(
          `INSERT INTO ai_status (id, power_on_at) VALUES (1, ?)
           ON CONFLICT (id) DO UPDATE SET power_on_at = excluded.power_on_at`,
        )
        .run(at);
    },

    setStatus(at: string, rtspReportJson: string): void {
      sql
        .prepare(
          `INSERT INTO ai_status (id, last_status_at, rtsp_report) VALUES (1, ?, ?)
           ON CONFLICT (id) DO UPDATE SET last_status_at = excluded.last_status_at, rtsp_report = excluded.rtsp_report`,
        )
        .run(at, rtspReportJson);
    },

    getStatus(): AiStatus | undefined {
      return sql
        .prepare(
          `SELECT power_on_at AS powerOnAt, last_status_at AS lastStatusAt, rtsp_report AS rtspReport
           FROM ai_status WHERE id = 1`,
        )
        .get() as AiStatus | undefined;
    },
  };
}
