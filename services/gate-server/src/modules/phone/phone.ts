import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Router } from 'express';
import { readCookie } from '../../shared/cookie.ts';
import { adminOf, keyOf } from '../../shared/route.ts';
import { sha256 } from '../../shared/secret.ts';
import { kst, kstMs } from '../../shared/time.ts';
import { decide } from '../access/access.rules.ts';
import type { AccessResult } from '../access/access.types.ts';
import { isCrossSite } from '../admin/admin.controller.ts';
import type { AuditService } from '../audit/audit.service.ts';
import type { Repositories } from '../../app/repositories.ts';
import type { Gate, GateControl } from '../gate/gate.types.ts';
import type { TerminalHub, TerminalMessage } from '../terminal/terminal.types.ts';

/**
 * 핸드폰으로 열기 (D-62). 핸드폰에는 앱이 없다.
 * 단말이 일회용 주소를 NFC 태그와 QR로 내보내고, 핸드폰 브라우저가 그 주소를 열어
 * 등록 때 받은 쿠키와 함께 보내면 서버가 그 직원으로 판정한다.
 */
export const PHONE_COOKIE = 'facegate_phone';
const INVITE_MS = 24 * 3600_000;
export const PASS_CODE_MS = 60_000;
const PHONE_COOKIE_MS = 2 * 365 * 24 * 3600_000;

export type Phone = {
  phoneKey: number;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
};
export type PhoneRepository = ReturnType<typeof createPhoneRepository>;

export function createPhoneRepository(sql: DatabaseSync) {
  return {
    addInvite(employeeKey: number, tokenHash: string, expiresAt: string): void {
      sql
        .prepare('INSERT INTO phone_invite (token_hash, employee_key, expires_at) VALUES (?, ?, ?)')
        .run(tokenHash, employeeKey, expiresAt);
    },
    /** 쓰지 않았고 기한 안인 등록 링크를 쓴 것으로 바꾸고 직원 번호를 돌려준다 */
    takeInvite(tokenHash: string, at: string): number | undefined {
      const row = sql
        .prepare(
          `UPDATE phone_invite SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
           RETURNING employee_key AS employeeKey`,
        )
        .get(at, tokenHash, at) as { employeeKey: number } | undefined;
      return row?.employeeKey;
    },
    add(employeeKey: number, tokenHash: string, label: string, at: string): number {
      return Number(
        sql
          .prepare(
            'INSERT INTO phone (employee_key, token_hash, label, created_at) VALUES (?, ?, ?, ?)',
          )
          .run(employeeKey, tokenHash, label, at).lastInsertRowid,
      );
    },
    byToken(tokenHash: string): { phoneKey: number; employeeKey: number } | undefined {
      return sql
        .prepare(
          'SELECT phone_key AS phoneKey, employee_key AS employeeKey FROM phone WHERE token_hash = ?',
        )
        .get(tokenHash) as { phoneKey: number; employeeKey: number } | undefined;
    },
    touch(phoneKey: number, at: string): void {
      sql.prepare('UPDATE phone SET last_used_at = ? WHERE phone_key = ?').run(at, phoneKey);
    },
    list(employeeKey: number): Phone[] {
      return sql
        .prepare(
          `SELECT phone_key AS phoneKey, label, created_at AS createdAt, last_used_at AS lastUsedAt
           FROM phone WHERE employee_key = ? ORDER BY phone_key`,
        )
        .all(employeeKey) as unknown as Phone[];
    },
    /** 지운 핸드폰의 직원 번호. 없으면 undefined */
    remove(phoneKey: number): number | undefined {
      const row = sql
        .prepare('DELETE FROM phone WHERE phone_key = ? RETURNING employee_key AS employeeKey')
        .get(phoneKey) as { employeeKey: number } | undefined;
      return row?.employeeKey;
    },
  };
}

/** 단말마다 내보내는 일회용 값. 서버를 다시 켜면 사라지고 단말이 새로 받는다 */
export function createPassCodes(now: () => Date) {
  const codes = new Map<string, { gateKey: number; terminalKey: number; expiresMs: number }>();
  return {
    issue(terminal: { gateKey: number; terminalKey: number }): string {
      const nowMs = now().getTime();
      for (const [code, c] of codes) if (c.expiresMs <= nowMs) codes.delete(code);
      const code = crypto.randomBytes(16).toString('base64url');
      codes.set(code, { ...terminal, expiresMs: nowMs + PASS_CODE_MS });
      return code;
    },
    /** 한 번 쓰면 없어진다 */
    take(code: string): { gateKey: number; terminalKey: number } | undefined {
      const found = codes.get(code);
      codes.delete(code);
      return found && found.expiresMs > now().getTime() ? found : undefined;
    },
  };
}
export type PassCodes = ReturnType<typeof createPassCodes>;

const phoneLabel = (userAgent: string | undefined) =>
  /iPhone|iPad/.test(userAgent ?? '')
    ? '아이폰'
    : /Android/.test(userAgent ?? '')
      ? '안드로이드'
      : '기타';

/** `/api/admin` 아래. 직원에게 줄 등록 링크, 등록된 핸드폰 목록과 해제 */
export function createPhoneAdminRouter({
  phones,
  audit,
  now,
  baseUrl,
  employeeExists,
}: {
  phones: PhoneRepository;
  audit: AuditService;
  now: () => Date;
  baseUrl: string | undefined;
  employeeExists: (employeeKey: number) => boolean;
}): Router {
  const router = Router();
  const employeeKeyOf = (value: string) => {
    const key = keyOf(value);
    return key !== null && employeeExists(key) ? key : null;
  };

  router.post('/employees/:employeeKey/phone-invite', (req, res) => {
    const employeeKey = employeeKeyOf(req.params.employeeKey);
    if (employeeKey === null) {
      res.sendStatus(404);
      return;
    }
    if (!baseUrl) {
      res.status(409).json({ error: 'PHONE_BASE_URL not set' });
      return;
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = kst(new Date(now().getTime() + INVITE_MS));
    phones.addInvite(employeeKey, sha256(token), expiresAt);
    audit.record(adminOf(res), 'PHONE_INVITE', `employee:${employeeKey}`);
    res.status(201).json({ url: `${baseUrl}/m/register?t=${token}`, expiresAt });
  });

  router.get('/employees/:employeeKey/phones', (req, res) => {
    const employeeKey = employeeKeyOf(req.params.employeeKey);
    if (employeeKey === null) res.sendStatus(404);
    else res.json({ enabled: Boolean(baseUrl), phones: phones.list(employeeKey) });
  });

  router.delete('/phones/:phoneKey', (req, res) => {
    const phoneKey = keyOf(req.params.phoneKey);
    const employeeKey = phoneKey === null ? undefined : phones.remove(phoneKey);
    if (employeeKey === undefined) {
      res.sendStatus(404);
      return;
    }
    audit.record(adminOf(res), 'PHONE_REVOKE', `employee:${employeeKey}`, { phoneKey });
    res.json({ ok: true });
  });
  return router;
}

/** `/api/terminal` 아래 (requireTerminal 뒤). 단말이 NFC 태그와 QR에 넣을 주소 */
export function createPhoneTerminalRouter(codes: PassCodes, baseUrl: string | undefined): Router {
  return Router().get('/pass-code', (_req, res) => {
    if (!baseUrl) {
      res.sendStatus(404);
      return;
    }
    const code = codes.issue(res.locals.terminal as { gateKey: number; terminalKey: number });
    res.json({ url: `${baseUrl}/m/pass?c=${code}`, expiresInMs: PASS_CODE_MS });
  });
}

export type PassResult =
  | { ok: false; error: 'PHONE' | 'CODE' }
  | { ok: true; result: AccessResult; name?: string; gateName: string };

/** 핸드폰 쿠키와 일회용 값으로 판정하고 열면 단말에 알린다. 얼굴과 같은 규칙 (access.rules) */
export function createPhonePass({
  phones,
  codes,
  repos,
  gates,
  gateControl,
  terminalHub,
  now,
}: {
  phones: PhoneRepository;
  codes: PassCodes;
  repos: Pick<Repositories, 'employees' | 'permissions' | 'accessLogs'>;
  gates: Gate[];
  gateControl: GateControl;
  terminalHub: Pick<TerminalHub, 'broadcast'>;
  now: () => Date;
}) {
  return async (code: string, phoneToken: string | undefined): Promise<PassResult> => {
    // 등록 안 된 핸드폰이 값을 써 버리지 않게 핸드폰부터 본다
    const phone = phoneToken ? phones.byToken(sha256(phoneToken)) : undefined;
    if (!phone) return { ok: false, error: 'PHONE' };
    const terminal = codes.take(code);
    const gate = terminal && gates.find((g) => g.gateKey === terminal.gateKey);
    if (!terminal || !gate) return { ok: false, error: 'CODE' };

    const receivedAt = now();
    const employee = repos.employees.getEmployee(phone.employeeKey);
    let result: AccessResult = decide({
      isWorker: true,
      employee,
      access: employee ? repos.permissions.check(employee, gate, receivedAt) : 'NO_GATE',
      lastGrantedMs: undefined,
      nowMs: receivedAt.getTime(),
      duplicateWindowMs: 0,
    });
    let openedAt: string | null = null;
    if (result === 'GRANTED') {
      try {
        await gateControl.open(gate);
        openedAt = kstMs(now());
      } catch (error) {
        console.error(`gate ${gate.gateKey} open failed: ${(error as Error).message}`);
        result = 'GATE_ERROR';
      }
    }
    phones.touch(phone.phoneKey, kst(receivedAt));
    const eventKey = repos.accessLogs.insertAccessLog({
      terminalKey: terminal.terminalKey,
      gateKey: gate.gateKey,
      employeeKey: employee?.employeeKey ?? null,
      aiTrackKey: null,
      method: 'PHONE',
      result,
      appearTime: kstMs(receivedAt),
      receivedAt: kstMs(receivedAt),
      openedAt,
    });
    const message: TerminalMessage = {
      type: 'decision',
      event_key: eventKey,
      result,
      at: kst(receivedAt),
    };
    if (result === 'GRANTED' && employee) {
      message.name = employee.name;
      message.department = employee.department;
    }
    terminalHub.broadcast(gate.gateKey, message);
    return {
      ok: true,
      result,
      name: result === 'GRANTED' ? employee?.name : undefined,
      gateName: gate.name,
    };
  };
}

/** `/m` 아래. 핸드폰 브라우저가 여는 화면과 그 화면이 부르는 API */
export function createPhonePublicRouter({
  phones,
  pass,
  now,
  employeeName,
}: {
  phones: PhoneRepository;
  pass: ReturnType<typeof createPhonePass>;
  now: () => Date;
  employeeName: (employeeKey: number) => string | undefined;
}): Router {
  const router = Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer'); // 주소의 일회용 값이 다른 곳에 새지 않게
    if (req.method !== 'GET' && isCrossSite(req)) res.status(403).json({ error: 'cross-site' });
    else next();
  });

  router.get('/register', (_req, res) => {
    res.type('html').send(page('핸드폰 등록', REGISTER_SCRIPT));
  });
  router.post('/api/register', (req, res) => {
    const token = (req.body as { t?: unknown } | undefined)?.t;
    const at = kst(now());
    const employeeKey =
      typeof token === 'string' ? phones.takeInvite(sha256(token), at) : undefined;
    if (employeeKey === undefined) {
      res.status(410).json({ error: 'invite expired or used' });
      return;
    }
    const phoneToken = crypto.randomBytes(32).toString('base64url');
    phones.add(employeeKey, sha256(phoneToken), phoneLabel(req.get('User-Agent')), at);
    res.cookie(PHONE_COOKIE, phoneToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure,
      path: '/m',
      maxAge: PHONE_COOKIE_MS,
    });
    res.json({ name: employeeName(employeeKey) ?? '' });
  });

  router.get('/pass', (_req, res) => {
    res.type('html').send(page('출입', PASS_SCRIPT));
  });
  router.post('/api/pass', async (req, res) => {
    const code = (req.body as { c?: unknown } | undefined)?.c;
    const result =
      typeof code === 'string'
        ? await pass(code, readCookie(req.headers.cookie, PHONE_COOKIE))
        : ({ ok: false, error: 'CODE' } as const);
    if (!result.ok) res.status(result.error === 'PHONE' ? 401 : 410).json({ error: result.error });
    else res.json(result);
  });
  return router;
}

// ---- 핸드폰 화면. 앱 없이 열리는 작은 페이지라 관리자 웹 빌드와 따로 둔다 ----

const page = (title: string, script: string) => `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; background: #f5f6f8; color: #1d2433;
    min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  main { width: min(360px, calc(100% - 32px)); text-align: center; }
  h1 { font-size: 22px; margin: 0 0 12px; }
  p { font-size: 16px; line-height: 1.5; color: #4a5263; margin: 0 0 20px; }
  button { width: 100%; padding: 14px; font-size: 17px; border: 0; border-radius: 10px;
    background: #2457d6; color: #fff; }
  button:disabled { opacity: .5; }
  .ok h1 { color: #127a4b; } .no h1 { color: #b4232c; }
</style></head>
<body><main id="m"><h1>${title}</h1><p>잠시만 기다려 주세요.</p></main>
<script>
const m = document.getElementById('m');
const show = (cls, head, text, button) => {
  m.className = cls;
  m.replaceChildren();
  const h = document.createElement('h1'); h.textContent = head; m.append(h);
  const p = document.createElement('p'); p.textContent = text; m.append(p);
  if (button) m.append(button);
};
const q = new URLSearchParams(location.search);
history.replaceState(null, '', location.pathname); // 주소창과 방문 기록에 일회용 값을 남기지 않음
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body), credentials: 'same-origin' });
${script}
</script></body></html>`;

// 링크 미리 보기(메신저 등)가 등록을 써 버리지 않게, 사람이 누를 때만 등록한다
const REGISTER_SCRIPT = `
const t = q.get('t');
const b = document.createElement('button'); b.textContent = '이 핸드폰으로 등록';
b.onclick = async () => {
  b.disabled = true;
  const r = await post('api/register', { t }).catch(() => null);
  if (r && r.ok) {
    const { name } = await r.json();
    show('ok', '등록했습니다', name + '님의 핸드폰으로 등록했습니다. 이제 게이트 단말에 핸드폰을 대거나 단말의 QR을 비추면 됩니다. 이 브라우저의 방문 기록과 쿠키를 지우면 다시 등록해야 합니다.');
  } else show('no', '등록할 수 없습니다', r ? '링크가 지났거나 이미 썼습니다. 관리자에게 새 링크를 받으세요.' : '서버에 연결할 수 없습니다. 사내 와이파이에 연결했는지 확인하세요.');
};
if (t) show('', '핸드폰 등록', '이 핸드폰을 출입용으로 등록합니다. 본인 핸드폰에서만 누르세요.', b);
else show('no', '등록할 수 없습니다', '링크가 올바르지 않습니다.');
`;

const PASS_SCRIPT = `
const c = q.get('c');
const DENIED = { DENIED_INACTIVE: '퇴사 처리된 직원입니다.', DENIED_GATE: '이 게이트를 지날 권한이 없습니다.',
  DENIED_TIME: '출입 가능 시간이 아닙니다.', GATE_ERROR: '게이트를 열지 못했습니다. 관리자에게 알려 주세요.' };
(async () => {
  const r = c ? await post('api/pass', { c }).catch(() => null) : null;
  if (!r) return show('no', '열 수 없습니다', c ? '서버에 연결할 수 없습니다. 사내 와이파이에 연결했는지 확인하세요.' : '주소가 올바르지 않습니다.');
  if (r.status === 401) return show('no', '등록되지 않은 핸드폰입니다', '관리자에게 핸드폰 등록 링크를 받으세요.');
  if (!r.ok) return show('no', '시간이 지났습니다', '단말에 핸드폰을 다시 대거나 QR을 다시 비춰 주세요.');
  const d = await r.json();
  if (d.result === 'GRANTED') show('ok', '통과하세요', d.name + '님, ' + d.gateName + ' 문이 열렸습니다.');
  else show('no', '열 수 없습니다', DENIED[d.result] || '관리자에게 문의하세요.');
})();
`;
