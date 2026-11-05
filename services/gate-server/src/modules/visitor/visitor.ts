import type { DatabaseSync } from 'node:sqlite';
import { Router } from 'express';
import type { FileStore } from '../../infrastructure/filesystem/file-store.ts';
import { decodeJpeg } from '../../shared/image.ts';
import { kst, parseKst } from '../../shared/time.ts';
import type { Admin } from '../admin/admin.types.ts';
import type { AuditService } from '../audit/audit.service.ts';

/** 같은 단말에서 연달아 누르면 이 시간 안에는 새 호출을 만들지 않는다 */
export const CALL_COOLDOWN_MS = 30_000;

export type VisitorCall = {
  callKey: number;
  gateKey: number;
  terminalKey: number;
  hasPhoto: boolean;
  createdAt: string;
  ackAt: string | null;
};
export type VisitorRepository = ReturnType<typeof createVisitorRepository>;

const COLUMNS = `call_key AS callKey, gate_key AS gateKey, terminal_key AS terminalKey,
  has_photo AS hasPhoto, created_at AS createdAt, ack_at AS ackAt`;
const toCall = (row: VisitorCall) => ({ ...row, hasPhoto: Boolean(row.hasPhoto) });

export function createVisitorRepository(sql: DatabaseSync) {
  return {
    add(gateKey: number, terminalKey: number, at: string): number {
      return Number(
        sql
          .prepare('INSERT INTO visitor_call (gate_key, terminal_key, created_at) VALUES (?, ?, ?)')
          .run(gateKey, terminalKey, at).lastInsertRowid,
      );
    },
    markPhoto(callKey: number): void {
      sql.prepare('UPDATE visitor_call SET has_photo = 1 WHERE call_key = ?').run(callKey);
    },
    get(callKey: number): VisitorCall | undefined {
      const row = sql
        .prepare(`SELECT ${COLUMNS} FROM visitor_call WHERE call_key = ?`)
        .get(callKey) as VisitorCall | undefined;
      return row && toCall(row);
    },
    latestOf(terminalKey: number): VisitorCall | undefined {
      const row = sql
        .prepare(
          `SELECT ${COLUMNS} FROM visitor_call WHERE terminal_key = ? ORDER BY call_key DESC LIMIT 1`,
        )
        .get(terminalKey) as VisitorCall | undefined;
      return row && toCall(row);
    },
    pending(): VisitorCall[] {
      return (
        sql
          .prepare(
            `SELECT ${COLUMNS} FROM visitor_call WHERE ack_at IS NULL ORDER BY call_key DESC LIMIT 20`,
          )
          .all() as unknown as VisitorCall[]
      ).map(toCall);
    },
    ack(callKey: number, at: string, adminKey: number): boolean {
      return (
        Number(
          sql
            .prepare(
              'UPDATE visitor_call SET ack_at = ?, ack_by = ? WHERE call_key = ? AND ack_at IS NULL',
            )
            .run(at, adminKey, callKey).changes,
        ) > 0
      );
    },
    /** 보존 기간이 지난 사진. 행은 남기고 사진 표시만 지운다 */
    purgePhotos(before: string): number[] {
      const keys = (
        sql
          .prepare('SELECT call_key AS k FROM visitor_call WHERE has_photo = 1 AND created_at < ?')
          .all(before) as { k: number }[]
      ).map((r) => r.k);
      for (const k of keys)
        sql.prepare('UPDATE visitor_call SET has_photo = 0 WHERE call_key = ?').run(k);
      return keys;
    },
  };
}

type TerminalRef = { gateKey: number; terminalKey: number };

/** 단말 방문객 버튼 (T-08). 누른 순간 사진 1장과 함께 관리자 웹에 알린다 */
export function createVisitorTerminalRouter({
  calls,
  files,
  audit,
  now,
}: {
  calls: VisitorRepository;
  files: Pick<FileStore, 'saveVisitorPhoto'>;
  audit: AuditService;
  now: () => Date;
}): Router {
  const router = Router();
  router.post('/visitor-calls', async (req, res) => {
    const { gateKey, terminalKey } = res.locals.terminal as TerminalRef;
    const raw = (req.body as { photo?: unknown } | undefined)?.photo;
    const photo = raw === undefined ? null : decodeJpeg(raw);
    if (raw !== undefined && !photo) {
      res.status(400).json({ error: 'photo must be a JPEG data URL' });
      return;
    }
    const last = calls.latestOf(terminalKey);
    if (
      last &&
      !last.ackAt &&
      now().getTime() - parseKst(last.createdAt)!.getTime() < CALL_COOLDOWN_MS
    ) {
      res.json({ callKey: last.callKey, repeated: true });
      return;
    }
    const callKey = calls.add(gateKey, terminalKey, kst(now()));
    if (photo) {
      await files.saveVisitorPhoto(callKey, photo);
      calls.markPhoto(callKey);
    }
    audit.record(null, 'VISITOR_CALL', `gate:${gateKey}`, { callKey, terminalKey });
    res.status(201).json({ callKey });
  });
  return router;
}

/** 관리자 웹: 대기 중인 호출 보기·사진·확인 */
export function createVisitorAdminRouter({
  calls,
  files,
  audit,
  now,
}: {
  calls: VisitorRepository;
  files: Pick<FileStore, 'visitorPhotoPath'>;
  audit: AuditService;
  now: () => Date;
}): Router {
  const router = Router();
  const keyOf = (value: string) => (/^\d+$/.test(value) ? Number(value) : -1);

  router.get('/visitor-calls', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(calls.pending());
  });

  router.get('/visitor-calls/:callKey/photo', (req, res) => {
    const call = calls.get(keyOf(req.params.callKey));
    if (!call?.hasPhoto) {
      res.sendStatus(404);
      return;
    }
    res.set('Cache-Control', 'private, no-store');
    res.type('image/jpeg').sendFile(files.visitorPhotoPath(call.callKey), (error) => {
      if (error && !res.headersSent) res.sendStatus(404);
    });
  });

  router.post('/visitor-calls/:callKey/ack', (req, res) => {
    const callKey = keyOf(req.params.callKey);
    const admin = res.locals.admin as Admin;
    if (!calls.get(callKey)) {
      res.sendStatus(404);
      return;
    }
    if (calls.ack(callKey, kst(now()), admin.adminKey))
      audit.record(admin.adminKey, 'VISITOR_CALL_ACK', `visitor-call:${callKey}`);
    res.json({ ok: true });
  });
  return router;
}
