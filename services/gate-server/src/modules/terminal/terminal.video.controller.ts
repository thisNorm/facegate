import { Router } from 'express';
import { isCrossSite } from '../admin/admin.controller.ts';
import type { TerminalVideo } from './terminal.video.ts';

const numberKey = (value: string) =>
  /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : -1;

export function createTerminalVideoRouter(video: TerminalVideo): Router {
  const router = Router();
  // 영상은 GET이라도 다른 사이트에서 읽히면 안 된다.
  router.use('/terminals/:terminalKey/frame', (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    if (isCrossSite(req)) {
      res.status(403).json({ error: 'cross-site request rejected' });
      return;
    }
    next();
  });

  router.get('/terminals/:terminalKey/frame', (req, res) => {
    if (req.method !== 'GET') {
      res.sendStatus(405);
      return;
    }
    const result = video.frame(numberKey(req.params.terminalKey));
    if (!result) {
      res.sendStatus(404);
    } else if ('jpeg' in result) {
      res.set('X-Frame-Age-Ms', String(result.ageMs)).type('image/jpeg').send(result.jpeg);
    } else if (result.state === 'starting') {
      res.sendStatus(204);
    } else if (result.state === 'busy') {
      res.status(503).json({ error: 'too many terminal videos open' });
    } else {
      res.status(503).json({ error: 'terminal video unavailable' });
    }
  });
  return router;
}
