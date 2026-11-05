import { Router } from 'express';
import type { Admin } from '../admin/admin.types.ts';
import type { AuditService } from '../audit/audit.service.ts';
import type { GateAdmin } from './gate.admin.ts';
import { parseGateInput, parseRemoteOpen, parseTerminalChange } from './gate.dto.ts';
import type { RemoteOpenService } from './gate.remote.ts';

const keyOf = (value: string) => (/^\d+$/.test(value) ? Number(value) : null);
const GATE_INPUT_ERROR =
  'name(1-40) and adapter { type: MOCK } or { type: DRY_CONTACT, host(IPv4), port?, unitId?, coil?, pulseMs?(100-5000) } required, floor?(integer -10..200 or null), openToAll?(boolean)';

export function createGateRouter(
  service: RemoteOpenService,
  gates: GateAdmin,
  audit: AuditService,
): Router {
  const router = Router();

  router.get('/gates', (_req, res) => {
    res.json(gates.list());
  });

  router.post('/gates', (req, res) => {
    const input = parseGateInput(req.body);
    if (!input) {
      res.status(400).json({ error: GATE_INPUT_ERROR });
      return;
    }
    const gate = gates.create(input);
    audit.record((res.locals.admin as Admin).adminKey, 'GATE_CREATE', `gate:${gate.gateKey}`, {
      name: gate.name,
    });
    res.status(201).json(gate);
  });

  router.patch('/gates/:gateKey', (req, res) => {
    const gateKey = keyOf(req.params.gateKey);
    const input = parseGateInput(req.body);
    if (gateKey !== null && !input) {
      res.status(400).json({ error: GATE_INPUT_ERROR });
      return;
    }
    const gate = gateKey === null || !input ? null : gates.update(gateKey, input);
    if (!gate) {
      res.sendStatus(404);
      return;
    }
    audit.record((res.locals.admin as Admin).adminKey, 'GATE_UPDATE', `gate:${gateKey}`, {
      name: gate.name,
      adapter: gate.adapter.type,
      floor: gate.floor,
      openToAll: gate.openToAll,
    });
    res.json(gate);
  });

  router.delete('/gates/:gateKey', (req, res) => {
    const gateKey = keyOf(req.params.gateKey);
    const result = gateKey === null ? 'NOT_FOUND' : gates.remove(gateKey);
    if (result === 'NOT_FOUND') res.sendStatus(404);
    else if (result === 'HAS_TERMINALS') res.status(409).json({ error: 'gate has terminals' });
    else {
      audit.record((res.locals.admin as Admin).adminKey, 'GATE_DELETE', `gate:${gateKey}`);
      res.json({ ok: true });
    }
  });

  router.patch('/terminals/:terminalKey', (req, res) => {
    const terminalKey = keyOf(req.params.terminalKey);
    const change = parseTerminalChange(req.body);
    if (terminalKey !== null && !change) {
      res.status(400).json({ error: 'name(1-40) or gateKey required' });
      return;
    }
    const result =
      terminalKey === null || !change ? 'NOT_FOUND' : gates.updateTerminal(terminalKey, change);
    if (result === 'NOT_FOUND') res.sendStatus(404);
    else if (result === 'NO_GATE') res.status(409).json({ error: 'no such gate' });
    else {
      audit.record(
        (res.locals.admin as Admin).adminKey,
        'TERMINAL_UPDATE',
        `terminal:${terminalKey}`,
        change,
      );
      res.json({ ok: true });
    }
  });

  router.delete('/terminals/:terminalKey', (req, res) => {
    const terminalKey = keyOf(req.params.terminalKey);
    const gateKey = terminalKey === null ? null : gates.unpair(terminalKey);
    if (gateKey === null) {
      res.sendStatus(404);
      return;
    }
    audit.record(
      (res.locals.admin as Admin).adminKey,
      'TERMINAL_UNPAIR',
      `terminal:${terminalKey}`,
      {
        gateKey,
      },
    );
    res.json({ ok: true });
  });

  // FR-A-09·09-1: 빠른 개방 화면도 같은 API
  router.post('/gates/:gateKey/open', async (req, res) => {
    const gateKey = keyOf(req.params.gateKey);
    const dto = parseRemoteOpen(req.body);
    if (gateKey === null) {
      res.sendStatus(404);
      return;
    }
    if (!dto) {
      res.status(400).json({
        error: 'reason is VISITOR (with visitor.name), RECOGNITION_FAILED or OTHER (with note)',
      });
      return;
    }
    const admin = res.locals.admin as Admin;
    const opened = await service.open(gateKey, dto, admin.adminKey);
    if (!opened) {
      res.sendStatus(404);
      return;
    }
    audit.record(admin.adminKey, 'REMOTE_OPEN', `gate:${gateKey}`, {
      reason: dto.reason,
      eventKey: opened.eventKey,
      result: opened.result,
    });
    res.status(opened.result === 'GRANTED' ? 200 : 502).json(opened);
  });

  return router;
}
