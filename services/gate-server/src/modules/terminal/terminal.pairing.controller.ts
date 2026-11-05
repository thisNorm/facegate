import express, { Router, type Request } from 'express';
import type { Admin } from '../admin/admin.types.ts';
import type { AuditService } from '../audit/audit.service.ts';
import { isIpv4 } from '../gate/gate.dto.ts';
import { parseDevice, type PairingService } from './terminal.pairing.ts';

export const clientIp = (req: Request) => (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
const keyOf = (value: string) => (/^\d+$/.test(value) ? Number(value) : -1);
const SIX_DIGITS = /^\d{6}$/;

/** 아직 토큰이 없는 단말이 쓰는 두 API. requireTerminal보다 앞에 붙인다 */
export function createPairingRouter(pairing: PairingService): Router {
  const router = Router();

  router.get('/hello', (_req, res) => {
    res.json({ app: 'FaceGate' });
  });

  // 본문 파서는 이 경로에만. /api/terminal 전체에 걸면 단말 API의 사진(20MB 한도)보다 먼저 100KB에서 막는다
  router.post('/pair', express.json(), (req, res) => {
    const device = parseDevice(req.body);
    const code = (req.body as { code?: unknown } | undefined)?.code;
    if (!device || typeof code !== 'string' || !SIX_DIGITS.test(code)) {
      res.status(400).json({ error: 'code(6 digits), model, appVersion and rtspPort required' });
      return;
    }
    const result = pairing.pairWithCode(code, device, clientIp(req));
    if (typeof result !== 'string') {
      res.json(result);
      return;
    }
    const status = { INVALID: 401, EXPIRED: 410, USED: 410, LOCKED: 429 }[result];
    res.status(status).json({ error: result });
  });

  return router;
}

/** 관리자 세션 뒤. QR 코드 발급과 번호 연결 */
export function createPairAdminRouter(pairing: PairingService, audit: AuditService): Router {
  const router = Router();

  router.post('/gates/:gateKey/pair-codes', (req, res) => {
    const gateKey = keyOf(req.params.gateKey);
    const admin = res.locals.admin as Admin;
    const issued = pairing.issueCode(gateKey, admin.adminKey);
    if (!issued) {
      res.sendStatus(404);
      return;
    }
    audit.record(admin.adminKey, 'PAIR_CODE_ISSUE', `gate:${gateKey}`);
    res.status(201).json(issued);
  });

  router.post('/gates/:gateKey/terminals', async (req, res) => {
    const { address, pin } = (req.body ?? {}) as { address?: unknown; pin?: unknown };
    if (!isIpv4(address) || typeof pin !== 'string' || !SIX_DIGITS.test(pin)) {
      res.status(400).json({ error: 'address(IPv4) and pin(6 digits) required' });
      return;
    }
    const admin = res.locals.admin as Admin;
    const result = await pairing.pairByNumber(
      keyOf(req.params.gateKey),
      address,
      pin,
      admin.adminKey,
    );
    if (result === 'NOT_FOUND') res.sendStatus(404);
    else if (result === 'WRONG_PIN') res.status(400).json({ error: result });
    else if (result === 'UNREACHABLE') res.status(502).json({ error: result });
    else res.status(201).json(result);
  });

  return router;
}
