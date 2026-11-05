import crypto from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { kst } from '../../shared/time.ts';
import { TERMINAL_SESSION_MS, type AdminService } from '../admin/admin.service.ts';
import type { AuditService } from '../audit/audit.service.ts';
import { parseRemoteOpen } from '../gate/gate.dto.ts';
import type { RemoteOpenService } from '../gate/gate.remote.ts';
import type { Gate } from '../gate/gate.types.ts';
import type { SettingService } from '../setting/setting.service.ts';
import { bearerToken, findTerminal } from './terminal.auth.ts';

export const TERMINAL_ADMIN_HEADER = 'X-Terminal-Admin-Token';
const LOCK_MS = 10 * 60 * 1000;
const MAX_MISSES = 5;

type TerminalRef = { gateKey: number; terminalKey: number };
/** 단말 관리자 모드에서 작업한 사람. 관리자 번호로 들어오면 계정이 없어 adminKey가 null */
export type TerminalOperator = { adminKey: number | null; name: string };
export type PinSessions = ReturnType<typeof createPinSessions>;

/** 관리자 번호로 들어온 단말 세션 (메모리, 10분). 단말마다 5번 틀리면 10분 잠금 */
export function createPinSessions(now: () => Date = () => new Date()) {
  const sessions = new Map<string, { terminalKey: number; until: number }>();
  const misses = new Map<number, { count: number; until: number }>();
  return {
    issue(terminalKey: number) {
      const token = crypto.randomBytes(32).toString('hex');
      const until = now().getTime() + TERMINAL_SESSION_MS;
      sessions.set(token, { terminalKey, until });
      misses.delete(terminalKey);
      return { token, expiresAt: kst(new Date(until)) };
    },
    find(token: string | undefined, terminalKey: number): boolean {
      const s = token ? sessions.get(token) : undefined;
      if (!s || s.until < now().getTime()) {
        if (token) sessions.delete(token);
        return false;
      }
      return s.terminalKey === terminalKey;
    },
    locked(terminalKey: number): boolean {
      return (misses.get(terminalKey)?.until ?? 0) > now().getTime();
    },
    miss(terminalKey: number): void {
      const m = misses.get(terminalKey) ?? { count: 0, until: 0 };
      if (m.until && m.until <= now().getTime()) m.count = 0;
      m.count++;
      m.until = m.count >= MAX_MISSES ? now().getTime() + LOCK_MS : 0;
      misses.set(terminalKey, m);
    },
  };
}

export function requireTerminal(gates: Pick<Gate, 'gateKey' | 'terminals'>[]): RequestHandler {
  return (req, res, next) => {
    const terminal = findTerminal(gates, bearerToken(req.get('Authorization')));
    if (!terminal) {
      res.status(401).json({ error: 'invalid terminal token' });
      return;
    }
    res.locals.terminal = terminal;
    next();
  };
}

/** `requireTerminal` 뒤. 단말 관리자 모드에서만 쓰는 API 보호. 계정 세션 또는 관리자 번호 세션 */
export function requireTerminalAdmin(service: AdminService, pins: PinSessions): RequestHandler {
  return (req, res, next) => {
    const token = req.get(TERMINAL_ADMIN_HEADER);
    const { terminalKey } = res.locals.terminal as TerminalRef;
    const admin = service.authenticate(token, 'TERMINAL');
    if (admin) res.locals.admin = admin;
    else if (pins.find(token, terminalKey))
      res.locals.admin = {
        adminKey: null,
        name: `단말 ${terminalKey} 관리자 번호`,
      } satisfies TerminalOperator;
    else {
      res.status(401).json({ error: 'terminal admin login required' });
      return;
    }
    next();
  };
}

export function createTerminalAdminRouter({
  admins,
  settings,
  pins,
  audit,
}: {
  admins: AdminService;
  settings: Pick<
    SettingService,
    'terminalAdmin' | 'verifyTerminalPin' | 'terminalLight' | 'terminalVoice'
  >;
  pins: PinSessions;
  audit: AuditService;
}): Router {
  const router = Router();

  // 단말이 설정 버튼에서 무엇을 물을지 정한다 (D-58)
  router.get('/admin/mode', (_req, res) => {
    res.json({ mode: settings.terminalAdmin().mode });
  });

  // 단말이 서버에 붙을 때마다 받아 간다. 바뀌면 웹소켓 light 메시지로도 온다
  router.get('/light', (_req, res) => {
    res.json(settings.terminalLight());
  });

  // 음성 안내 문구. 불빛과 같이 붙을 때 받고, 바뀌면 voice 메시지로도 온다
  router.get('/voice', (_req, res) => {
    res.json(settings.terminalVoice());
  });

  router.post('/admin/login', async (req, res) => {
    if (settings.terminalAdmin().mode !== 'ACCOUNT') {
      res.status(403).json({ error: 'this server uses the admin pin' });
      return;
    }
    const { loginId, password } = (req.body ?? {}) as { loginId?: unknown; password?: unknown };
    if (typeof loginId !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'loginId and password are required' });
      return;
    }
    const { terminalKey } = res.locals.terminal as TerminalRef;
    const result = await admins.terminalLogin(loginId, password, terminalKey);
    if ('error' in result) {
      if (result.error === 'LOCKED')
        res.status(423).json({ error: 'account locked, try again later' });
      else res.status(401).json({ error: 'invalid login' });
      return;
    }
    res.set('Cache-Control', 'no-store');
    res.json({
      token: result.token,
      expiresAt: result.expiresAt,
      admin: { name: result.admin.name },
    });
  });

  router.post('/admin/pin-login', async (req, res) => {
    if (settings.terminalAdmin().mode !== 'PIN') {
      res.status(403).json({ error: 'this server uses admin accounts' });
      return;
    }
    const { pin } = (req.body ?? {}) as { pin?: unknown };
    const { terminalKey } = res.locals.terminal as TerminalRef;
    if (typeof pin !== 'string') {
      res.status(400).json({ error: 'pin is required' });
      return;
    }
    if (pins.locked(terminalKey)) {
      res.status(423).json({ error: 'locked, try again later' });
      return;
    }
    if (!(await settings.verifyTerminalPin(pin))) {
      pins.miss(terminalKey);
      audit.record(null, 'TERMINAL_LOGIN_FAILED', `terminal:${terminalKey}`, { via: 'PIN' });
      res.status(401).json({ error: 'invalid pin' });
      return;
    }
    const issued = pins.issue(terminalKey);
    audit.record(null, 'TERMINAL_LOGIN', `terminal:${terminalKey}`, { via: 'PIN' });
    res.set('Cache-Control', 'no-store');
    res.json({ ...issued, admin: { name: `단말 ${terminalKey} 관리자 번호` } });
  });

  router.get('/admin/me', requireTerminalAdmin(admins, pins), (_req, res) => {
    res.json({ admin: { name: (res.locals.admin as TerminalOperator).name } });
  });

  return router;
}

/** 관리자 모드 뒤. 단말이 붙은 게이트를 연다. 웹 원격 개방과 같은 서비스·기록 (관리자 웹이 먹통일 때) */
export function createTerminalOpenRouter(service: RemoteOpenService, audit: AuditService): Router {
  const router = Router();
  router.post('/open', async (req, res) => {
    const dto = parseRemoteOpen(req.body);
    if (!dto) {
      res.status(400).json({
        error: 'reason is VISITOR (with visitor.name), RECOGNITION_FAILED or OTHER (with note)',
      });
      return;
    }
    const { gateKey, terminalKey } = res.locals.terminal as TerminalRef;
    const operator = res.locals.admin as TerminalOperator;
    const opened = await service.open(gateKey, dto, operator.adminKey);
    if (!opened) {
      res.sendStatus(404);
      return;
    }
    audit.record(operator.adminKey, 'REMOTE_OPEN', `gate:${gateKey}`, {
      reason: dto.reason,
      eventKey: opened.eventKey,
      result: opened.result,
      terminalKey,
    });
    res.status(opened.result === 'GRANTED' ? 200 : 502).json(opened);
  });
  return router;
}
