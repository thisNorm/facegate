import { Router } from 'express';
import type { AuditRepository } from './audit.repository.ts';

const MAX_LIMIT = 500;

export function createAuditRouter(audits: AuditRepository): Router {
  const router = Router();
  router.get('/audit-logs', (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, MAX_LIMIT));
    const offset = Math.max(0, Math.floor(Number(req.query.offset) || 0));
    res.json({ items: audits.list(limit, offset), total: audits.count() });
  });
  return router;
}
