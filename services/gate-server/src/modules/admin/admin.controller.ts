import { Router, type Request, type RequestHandler, type Response } from 'express';
import { readCookie } from '../../shared/cookie.ts';
import {
  AdminConflictError,
  AdminInputError,
  WEB_SESSION_MS,
  type AdminService,
} from './admin.service.ts';
import type { Admin } from './admin.types.ts';

export const SESSION_COOKIE = 'facegate_session';

function setSession(req: Request, res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure,
    path: '/',
    maxAge: WEB_SESSION_MS,
  });
}

export function requireAdmin(service: AdminService): RequestHandler {
  return (req, res, next) => {
    const admin = service.authenticate(readCookie(req.headers.cookie, SESSION_COOKIE), 'WEB');
    if (!admin) {
      res.status(401).json({ error: 'login required' });
      return;
    }
    res.locals.admin = admin;
    next();
  };
}

/** 브라우저가 다른 사이트에서 보낸 요청인지. Origin이 없는 요청(curl 등)은 같은 사이트로 본다 */
export function isCrossSite(req: Request): boolean {
  const site = req.get('Sec-Fetch-Site');
  const origin = req.get('Origin');
  let host: string | undefined;
  try {
    host = origin === undefined ? undefined : new URL(origin).host;
  } catch {
    host = ''; // 알아볼 수 없는 Origin은 거절
  }
  return (
    (site !== undefined && site !== 'same-origin' && site !== 'none') ||
    (host !== undefined && host !== req.get('Host'))
  );
}

/** 쿠키 인증이라 다른 사이트에서 온 쓰기 요청을 막음 */
export const rejectCrossSite: RequestHandler = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') {
    next();
    return;
  }
  if (isCrossSite(req)) {
    res.status(403).json({ error: 'cross-site request rejected' });
    return;
  }
  next();
};

/** `/api/admin/auth` 아래. 로그인은 세션 없이, 나머지는 자체 확인 */
export function createAuthRouter(service: AdminService): Router {
  const router = Router();
  const sessionOf = (cookie: string | undefined) => {
    const token = readCookie(cookie, SESSION_COOKIE);
    return { token, admin: service.authenticate(token, 'WEB') };
  };

  router.post('/login', async (req, res) => {
    const { loginId, password } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof loginId !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'loginId and password are required' });
      return;
    }
    const result = await service.login(loginId, password);
    if ('error' in result) {
      if (result.error === 'LOCKED')
        res.status(423).json({ error: 'account locked, try again later' });
      else res.status(401).json({ error: 'invalid login' });
      return;
    }
    setSession(req, res, result.token);
    res.json({ ...service.authState(result.admin), expiresAt: result.expiresAt });
  });

  router.post('/logout', (req, res) => {
    const { token, admin } = sessionOf(req.headers.cookie);
    if (token && admin) service.logout(token, admin);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({});
  });

  router.get('/me', (req, res) => {
    const { admin } = sessionOf(req.headers.cookie);
    if (!admin) res.status(401).json({ error: 'login required' });
    else res.json(service.authState(admin));
  });

  router.post('/credentials', async (req, res) => {
    const { token, admin } = sessionOf(req.headers.cookie);
    if (!token || !admin) {
      res.status(401).json({ error: 'login required' });
      return;
    }
    const { loginId, currentPassword, newPassword } = (req.body ?? {}) as Record<string, unknown>;
    if (
      typeof currentPassword !== 'string' ||
      currentPassword.length === 0 ||
      (loginId !== undefined && typeof loginId !== 'string') ||
      (newPassword !== undefined && typeof newPassword !== 'string')
    ) {
      res
        .status(400)
        .json({ error: 'currentPassword is required; loginId and newPassword must be strings' });
      return;
    }
    try {
      const result = await service.changeCredentials(admin, token, {
        loginId,
        currentPassword,
        newPassword,
      });
      if (result === 'INVALID') res.status(401).json({ error: 'current password is wrong' });
      else if (result === 'DUPLICATE') res.status(409).json({ error: 'login id already exists' });
      else res.json({ admin: result });
    } catch (error) {
      if (!(error instanceof AdminInputError)) throw error;
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/password', async (req, res) => {
    const { token, admin } = sessionOf(req.headers.cookie);
    if (!token || !admin) {
      res.status(401).json({ error: 'login required' });
      return;
    }
    const { currentPassword, newPassword } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      res.status(400).json({ error: 'currentPassword and newPassword are required' });
      return;
    }
    try {
      const changed = await service.changePassword(admin, token, currentPassword, newPassword);
      if (!changed) res.status(401).json({ error: 'current password is wrong' });
      else res.json({});
    } catch (error) {
      if (!(error instanceof AdminInputError)) throw error;
      res.status(400).json({ error: error.message });
    }
  });

  return router;
}

export function createAdminAccountRouter(service: AdminService): Router {
  const router = Router();
  router.get('/admins', (_req, res) => {
    res.json(service.listAdmins());
  });
  router.post('/admins', async (req, res) => {
    const { loginId, name, password } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof loginId !== 'string' || typeof name !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'loginId, name and password are required' });
      return;
    }
    try {
      const adminKey = await service.createAdmin(
        loginId,
        name,
        password,
        (res.locals.admin as Admin).adminKey,
      );
      res.status(201).json({ adminKey });
    } catch (error) {
      if (error instanceof AdminConflictError) res.status(409).json({ error: error.message });
      else if (error instanceof AdminInputError) res.status(400).json({ error: error.message });
      else throw error;
    }
  });
  router.patch('/admins/:adminKey', (req, res) => {
    const adminKey = /^\d+$/.test(req.params.adminKey) ? Number(req.params.adminKey) : null;
    const { enabled } = (req.body ?? {}) as { enabled?: unknown };
    if (adminKey === null) {
      res.sendStatus(404);
      return;
    }
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be true or false' });
      return;
    }
    const result = service.setEnabled(res.locals.admin as Admin, adminKey, enabled);
    if (result === 'SELF') res.status(400).json({ error: 'you cannot disable yourself' });
    else if (result === 'NOT_FOUND') res.sendStatus(404);
    else res.json({});
  });
  return router;
}
