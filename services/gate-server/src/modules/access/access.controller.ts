import path from 'node:path';
import { Router } from 'express';
import { kst } from '../../shared/time.ts';
import type { Gate } from '../gate/gate.types.ts';
import { toCsv } from './access.csv.ts';
import { parseAccessFilter } from './access.dto.ts';
import type { AccessRepository } from './access.repository.ts';
import type { AccessLogView } from './access.types.ts';

const MAX_LIMIT = 500;
const MAX_CSV_ROWS = 50_000;
const BAD_FILTER =
  'bad filter: from/to YYYY-MM-DD, gateKey/beforeEventKey/limit positive integers, known result/method';

function toItem({ fullImage, cropImage, ...rest }: AccessLogView) {
  return { ...rest, hasFullImage: fullImage !== null, hasCropImage: cropImage !== null };
}

export function createAccessRouter({
  accessLogs,
  gates,
  fileDir,
  now,
}: {
  accessLogs: AccessRepository;
  gates: Gate[];
  fileDir: string;
  now: () => Date;
}): Router {
  const router = Router();
  const eventDir = path.resolve(fileDir, 'events') + path.sep;

  router.get('/access-logs', (req, res) => {
    const filter = parseAccessFilter(req.query as Record<string, unknown>, MAX_LIMIT);
    if (!filter) {
      res.status(400).json({ error: BAD_FILTER });
      return;
    }
    const rows = accessLogs.searchAccessLogs(filter);
    res.json({
      items: rows.map(toItem),
      nextBeforeEventKey: rows.length === filter.limit ? rows[rows.length - 1].eventKey : null,
    });
  });

  router.get('/access-logs.csv', (req, res) => {
    const filter = parseAccessFilter(
      { ...(req.query as Record<string, unknown>), limit: String(MAX_CSV_ROWS) },
      MAX_CSV_ROWS,
    );
    if (!filter) {
      res.status(400).json({ error: BAD_FILTER });
      return;
    }
    const csv = toCsv(
      accessLogs.searchAccessLogs(filter),
      new Map(gates.map((g) => [g.gateKey, g.name])),
    );
    const day = kst(now()).slice(0, 10).replaceAll('-', '');
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="access-logs-${day}.csv"`);
    res.send(csv);
  });

  router.get('/access-logs/:eventKey/images/:kind', (req, res) => {
    const eventKey = /^\d+$/.test(req.params.eventKey) ? Number(req.params.eventKey) : null;
    const row = eventKey === null ? undefined : accessLogs.getAccessLog(eventKey);
    const kind = req.params.kind;
    const file = !row
      ? null
      : kind === 'full'
        ? row.fullImage
        : kind === 'crop'
          ? row.cropImage
          : null;
    // DB 값이 잘못돼도 사진 폴더 밖 파일은 내주지 않음
    if (!file || !path.resolve(file).startsWith(eventDir)) {
      res.sendStatus(404);
      return;
    }
    res.set('Cache-Control', 'private, no-store');
    res.type('image/jpeg').sendFile(path.resolve(file), (error) => {
      if (error && !res.headersSent) res.sendStatus(404);
    });
  });

  return router;
}
