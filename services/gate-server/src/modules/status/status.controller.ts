import { Router } from 'express';
import type { createStatusService } from './status.service.ts';

export function createStatusRouter(service: ReturnType<typeof createStatusService>): Router {
  const router = Router();
  router.get('/status', (_req, res) => {
    res.json(service.snapshot());
  });
  return router;
}
