import crypto from 'node:crypto';
import { hashPassword, verifyPassword } from '../../shared/password.ts';
import { kst } from '../../shared/time.ts';
import type { AuditService } from '../audit/audit.service.ts';
import type { AdminRepository } from './admin.repository.ts';
import type {
  Admin,
  AdminSession,
  AppEnv,
  CredentialsInput,
  Issued,
  LoginFailure,
  SessionKind,
} from './admin.types.ts';

export const WEB_SESSION_MS = 8 * 60 * 60 * 1000;
export const TERMINAL_SESSION_MS = 10 * 60 * 1000;
export const MAX_FAILURES = 5;
export const LOCK_MS = 10 * 60 * 1000;
const LOGIN_ID = /^[a-z0-9._-]{3,32}$/;

export class AdminInputError extends Error {}
export class AdminConflictError extends AdminInputError {}

function validateLoginId(loginId: string): void {
  if (!LOGIN_ID.test(loginId))
    throw new AdminInputError('login id must match [a-z0-9._-], 3-32 chars');
}

function validatePassword(password: string): void {
  if (password.length === 0) throw new AdminInputError('password is required');
}

function validateNewAdmin(loginId: string, name: string, password: string): void {
  validateLoginId(loginId);
  if (!name.trim()) throw new AdminInputError('name is required');
  validatePassword(password);
}

const sha256 = (text: string) => crypto.createHash('sha256').update(text).digest('hex');
export type AdminService = ReturnType<typeof createAdminService>;

export function createAdminService({
  admins,
  audit,
  now = () => new Date(),
  appEnv = 'production',
}: {
  admins: AdminRepository;
  audit: AuditService;
  now?: () => Date;
  appEnv?: AppEnv;
}) {
  const dummyHash = hashPassword('dummy password value');
  const later = (ms: number) => kst(new Date(now().getTime() + ms));

  function issue(admin: Admin, kind: SessionKind, ttlMs: number): Issued {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = later(ttlMs);
    admins.addSession({
      tokenHash: sha256(token),
      adminKey: admin.adminKey,
      kind,
      expiresAt,
      createdAt: kst(now()),
    });
    return { token, expiresAt, admin };
  }

  async function checkPassword(loginId: string, password: string): Promise<Admin | LoginFailure> {
    const row = LOGIN_ID.test(loginId) ? admins.findByLoginId(loginId) : undefined;
    if (!row || !row.enabled) {
      await verifyPassword(password, await dummyHash);
      return { error: 'INVALID' };
    }
    if (row.lockedUntil !== null && row.lockedUntil > kst(now())) return { error: 'LOCKED' };
    const ok = await verifyPassword(password, row.passwordHash);
    // await 동안 다른 요청이 잠갔거나 계정을 바꿨을 수 있어 다시 읽음
    const fresh = admins.findByKey(row.adminKey);
    if (
      !fresh ||
      !fresh.enabled ||
      fresh.passwordHash !== row.passwordHash ||
      fresh.loginId !== loginId
    )
      return { error: 'INVALID' };
    if (fresh.lockedUntil !== null && fresh.lockedUntil > kst(now())) return { error: 'LOCKED' };
    if (!ok) {
      const failures = fresh.failedCount + 1;
      const locked = failures >= MAX_FAILURES;
      admins.setFailures(row.adminKey, locked ? 0 : failures, locked ? later(LOCK_MS) : null);
      return { error: 'INVALID' };
    }
    admins.setFailures(row.adminKey, 0, null);
    return { adminKey: fresh.adminKey, loginId: fresh.loginId, name: fresh.name };
  }

  function recordFailure(
    action: 'LOGIN_FAILED' | 'TERMINAL_LOGIN_FAILED',
    loginId: string,
    result: LoginFailure,
    detail: Record<string, unknown> | null = null,
  ) {
    audit.record(
      (LOGIN_ID.test(loginId) ? admins.findByLoginId(loginId)?.adminKey : undefined) ?? null,
      result.error === 'LOCKED' ? 'LOGIN_LOCKED' : action,
      LOGIN_ID.test(loginId) ? `loginId:${loginId}` : 'loginId:<invalid>',
      detail,
    );
  }

  return {
    /** createServer가 listen 전에 한 번 호출. 값은 Config를 통해서만 들어옴 */
    async initializeAccounts({
      initialAdminId,
      initialAdminPassword,
    }: {
      initialAdminId?: string;
      initialAdminPassword?: string;
    }): Promise<void> {
      if (appEnv === 'production') {
        const dev = admins.findByLoginId('dev');
        if (dev) {
          admins.deleteAdmin(dev.adminKey);
          console.warn('운영 모드: 개발 계정과 세션을 삭제했습니다.');
        }
      }
      if (admins.countAdmins() === 0) {
        if (!initialAdminId || !initialAdminPassword) {
          console.warn(
            'INITIAL_ADMIN_ID와 INITIAL_ADMIN_PASSWORD가 모두 필요합니다. 첫 관리자를 만들지 않았습니다.',
          );
        } else {
          if (initialAdminId === 'dev') throw new AdminInputError('INITIAL_ADMIN_ID is reserved');
          validateNewAdmin(initialAdminId, initialAdminId, initialAdminPassword);
          const passwordHash = await hashPassword(initialAdminPassword);
          // 해시를 기다리는 동안 다른 시작 경로가 생성했는지 재확인. 이후 삽입까지 await 없음
          if (admins.countAdmins() === 0) {
            const adminKey = admins.addAdmin({
              loginId: initialAdminId,
              name: initialAdminId,
              passwordHash,
              createdAt: kst(now()),
              mustChangeCredentials: true,
            });
            audit.record(null, 'ADMIN_CREATE', `admin:${adminKey}`, { via: 'INITIAL' });
          }
        }
      }
      if (appEnv === 'development') {
        const passwordHash = await hashPassword('1234');
        const dev = admins.findByLoginId('dev');
        if (dev) {
          admins.setCredentials(dev.adminKey, 'dev', passwordHash);
          admins.setEnabled(dev.adminKey, true);
          admins.setFailures(dev.adminKey, 0, null);
          admins.deleteSessionsOf(dev.adminKey);
        } else {
          admins.addAdmin({
            loginId: 'dev',
            name: 'dev',
            passwordHash,
            createdAt: kst(now()),
            mustChangeCredentials: false,
          });
        }
        console.warn('개발 모드: 개발 전용 계정을 준비했습니다. 운영 PC에서 사용하지 마세요.');
      }
    },

    authState(admin: Admin): AdminSession {
      return {
        admin,
        mustChangeCredentials: admins.findByKey(admin.adminKey)?.mustChangeCredentials === 1,
        appEnv,
      };
    },

    async createAdmin(
      loginId: string,
      name: string,
      password: string,
      createdBy: number | null = null,
    ): Promise<number> {
      validateNewAdmin(loginId, name, password);
      if (loginId === 'dev') throw new AdminInputError('dev is reserved for development');
      const passwordHash = await hashPassword(password);
      if (admins.findByLoginId(loginId)) throw new AdminConflictError('login id already exists');
      const adminKey = admins.addAdmin({
        loginId,
        name: name.trim(),
        passwordHash,
        createdAt: kst(now()),
      });
      audit.record(createdBy, 'ADMIN_CREATE', `admin:${adminKey}`);
      return adminKey;
    },

    listAdmins() {
      return admins.listAdmins();
    },

    setEnabled(actor: Admin, adminKey: number, enabled: boolean): 'SELF' | 'NOT_FOUND' | 'OK' {
      if (adminKey === actor.adminKey) return 'SELF';
      if (!admins.findByKey(adminKey)) return 'NOT_FOUND';
      admins.setEnabled(adminKey, enabled);
      if (!enabled) admins.deleteSessionsOf(adminKey);
      audit.record(actor.adminKey, enabled ? 'ADMIN_ENABLE' : 'ADMIN_DISABLE', `admin:${adminKey}`);
      return 'OK';
    },

    async changeCredentials(
      admin: Admin,
      token: string,
      input: CredentialsInput,
    ): Promise<Admin | 'INVALID' | 'DUPLICATE'> {
      const row = admins.findByKey(admin.adminKey);
      if (!row || !row.enabled || !(await verifyPassword(input.currentPassword, row.passwordHash)))
        return 'INVALID';
      if (input.loginId !== undefined) validateLoginId(input.loginId);
      if (input.newPassword !== undefined) validatePassword(input.newPassword);
      const passwordChanged =
        input.newPassword !== undefined && input.newPassword !== input.currentPassword;
      const passwordHash = passwordChanged
        ? await hashPassword(input.newPassword as string)
        : row.passwordHash;
      const fresh = admins.findByKey(admin.adminKey);
      if (
        !fresh ||
        !fresh.enabled ||
        fresh.passwordHash !== row.passwordHash ||
        !admins.findSession(sha256(token), 'WEB', kst(now()))
      )
        return 'INVALID';
      const loginId = input.loginId ?? fresh.loginId;
      if (loginId !== fresh.loginId && (loginId === 'dev' || fresh.loginId === 'dev'))
        throw new AdminInputError('dev is reserved for development');
      const taken = admins.findByLoginId(loginId);
      if (taken && taken.adminKey !== admin.adminKey) return 'DUPLICATE';
      const loginIdChanged = loginId !== fresh.loginId;
      admins.setCredentials(admin.adminKey, loginId, passwordHash);
      if (loginIdChanged || passwordChanged) admins.deleteSessionsOf(admin.adminKey, sha256(token));
      audit.record(
        admin.adminKey,
        loginIdChanged || passwordChanged ? 'CREDENTIALS_CHANGE' : 'CREDENTIALS_CONFIRM',
        `admin:${admin.adminKey}`,
        { loginIdChanged, passwordChanged },
      );
      return { adminKey: admin.adminKey, loginId, name: fresh.name };
    },

    async changePassword(
      admin: Admin,
      token: string,
      current: string,
      next: string,
    ): Promise<boolean> {
      validatePassword(next);
      const row = admins.findByKey(admin.adminKey);
      if (!row || !row.enabled || !(await verifyPassword(current, row.passwordHash))) return false;
      const passwordHash = await hashPassword(next);
      const fresh = admins.findByKey(admin.adminKey);
      if (
        !fresh ||
        !fresh.enabled ||
        fresh.passwordHash !== row.passwordHash ||
        !admins.findSession(sha256(token), 'WEB', kst(now()))
      )
        return false;
      admins.setPassword(admin.adminKey, passwordHash);
      admins.deleteSessionsOf(admin.adminKey, sha256(token));
      audit.record(admin.adminKey, 'PASSWORD_CHANGE');
      return true;
    },

    async login(loginId: string, password: string): Promise<Issued | LoginFailure> {
      admins.deleteExpiredSessions(kst(now()));
      const result = await checkPassword(loginId, password);
      if ('error' in result) {
        recordFailure('LOGIN_FAILED', loginId, result);
        return result;
      }
      audit.record(result.adminKey, 'LOGIN');
      return issue(result, 'WEB', WEB_SESSION_MS);
    },

    authenticate(token: string | undefined, kind: SessionKind): Admin | null {
      if (!token) return null;
      return admins.findSession(sha256(token), kind, kst(now())) ?? null;
    },

    logout(token: string, admin: Admin): void {
      admins.deleteSession(sha256(token));
      audit.record(admin.adminKey, 'LOGOUT');
    },

    async terminalLogin(
      loginId: string,
      password: string,
      terminalKey: number,
    ): Promise<Issued | LoginFailure> {
      admins.deleteExpiredSessions(kst(now()));
      const result = await checkPassword(loginId, password);
      if ('error' in result) {
        recordFailure('TERMINAL_LOGIN_FAILED', loginId, result, { terminalKey });
        return result;
      }
      audit.record(result.adminKey, 'TERMINAL_LOGIN', `terminal:${terminalKey}`);
      return issue(result, 'TERMINAL', TERMINAL_SESSION_MS);
    },
  };
}
