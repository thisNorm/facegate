import { Router } from 'express';
import type { AuditService } from '../audit/audit.service.ts';
import { adminOf, keyOf, nameOf } from '../../shared/route.ts';
import { kst } from '../../shared/time.ts';
import type { OrgKind, OrgRepository } from './org.repository.ts';

const KINDS: OrgKind[] = ['DEPARTMENT', 'TENANT'];

/** 관리자 웹 소속 관리 (D-59) */
export function createOrgRouter(orgs: OrgRepository, audit: AuditService, now: () => Date): Router {
  const router = Router();
  router.get('/orgs', (_req, res) => {
    res.json(orgs.list());
  });

  router.post('/orgs', (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const name = nameOf(b.name);
    if (!name || !KINDS.includes(b.kind as OrgKind)) {
      res.status(400).json({ error: 'name(1-40) and kind DEPARTMENT or TENANT required' });
      return;
    }
    if (orgs.getByName(name)) {
      res.status(409).json({ error: 'org name already exists' });
      return;
    }
    const orgKey = orgs.create({ name, kind: b.kind as OrgKind }, kst(now()));
    audit.record(adminOf(res), 'ORG_CREATE', `org:${orgKey}`, { name, kind: b.kind });
    res.status(201).json(orgs.get(orgKey));
  });

  router.patch('/orgs/:orgKey', (req, res) => {
    const orgKey = keyOf(req.params.orgKey);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const name = b.name === undefined ? undefined : nameOf(b.name);
    const kind = b.kind as OrgKind | undefined;
    if (
      name === null ||
      (kind !== undefined && !KINDS.includes(kind)) ||
      (name === undefined && kind === undefined)
    ) {
      res.status(400).json({ error: 'send name(1-40) or kind' });
      return;
    }
    const other = name ? orgs.getByName(name) : undefined;
    if (other && other.orgKey !== orgKey) {
      res.status(409).json({ error: 'org name already exists' });
      return;
    }
    if (orgKey === null || !orgs.update(orgKey, { name, kind })) {
      res.sendStatus(404);
      return;
    }
    audit.record(adminOf(res), 'ORG_UPDATE', `org:${orgKey}`, { name, kind });
    res.json(orgs.get(orgKey));
  });

  router.delete('/orgs/:orgKey', (req, res) => {
    const orgKey = keyOf(req.params.orgKey);
    const result = orgKey === null ? 'NOT_FOUND' : orgs.remove(orgKey);
    if (result === 'NOT_FOUND') res.sendStatus(404);
    else if (result === 'HAS_EMPLOYEES') res.status(409).json({ error: 'org has employees' });
    else {
      audit.record(adminOf(res), 'ORG_DELETE', `org:${orgKey}`);
      res.json({ ok: true });
    }
  });

  return router;
}

/** 단말 관리자 모드의 직원 등록에서 소속 고르기 */
export function createOrgTerminalRouter(orgs: OrgRepository): Router {
  const router = Router();
  router.get('/orgs', (_req, res) => {
    res.json(orgs.list());
  });
  return router;
}
