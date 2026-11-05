import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../../src/infrastructure/database/database.ts';
import { createRepositories } from '../../src/app/repositories.ts';
import { createServer } from '../../src/app/server.ts';
import { ADMIN_PASSWORD, loginAsAdmin } from './admin-session.ts';
import { testRegistry } from './registry.ts';

async function start() {
  const repos = createRepositories(openDatabase(':memory:'));
  const server = await createServer({
    config: { ingestKey: 'ingest', fileDir: 'storage/test-files', duplicateWindowMs: 5000 },
    repos,
    registry: testRegistry(repos),
    gateControl: { async open() {}, async releaseAll() {} },
    terminalHub: { handleUpgrade() {}, broadcast() {}, isConnected: () => false, disconnect() {} },
    now: () => new Date('2026-10-29T00:00:00.000Z'),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { server, repos, base, call };
}

test('admin API needs a login session; the old X-Admin-Key no longer works', async () => {
  const { server, call } = await start();
  assert.equal((await call('GET', '/api/admin/access-logs')).status, 401);
  assert.equal(
    (await call('GET', '/api/admin/access-logs', undefined, { 'X-Admin-Key': 'admin' })).status,
    401,
  );
  server.close();
});

test('login sets an HttpOnly SameSite=Strict cookie that opens the admin API', async () => {
  const { server, repos, base, call } = await start();
  const cookie = await loginAsAdmin(repos, base);
  const res = await call('POST', '/api/admin/auth/login', {
    loginId: 'hr.kim',
    password: ADMIN_PASSWORD,
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /^facegate_session=[A-Za-z0-9_-]{43};/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.deepEqual(await res.json(), {
    admin: { adminKey: 1, loginId: 'hr.kim', name: '김인사' },
    expiresAt: '2026-10-29 17:00:00',
    mustChangeCredentials: false,
    appEnv: 'production',
  });
  assert.equal((await call('GET', '/api/admin/access-logs', undefined, cookie)).status, 200);
  assert.equal(
    (await (await call('GET', '/api/admin/auth/me', undefined, cookie)).json()).admin.loginId,
    'hr.kim',
  );
  server.close();
});

test('bad input is 400, wrong password 401, locked account 423', async () => {
  const { server, repos, base, call } = await start();
  await loginAsAdmin(repos, base);
  assert.equal((await call('POST', '/api/admin/auth/login', { loginId: 'hr.kim' })).status, 400);
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await call('POST', '/api/admin/auth/login', {
          loginId: 'hr.kim',
          password: 'wrong password!',
        })
      ).status,
      401,
    );
  const locked = await call('POST', '/api/admin/auth/login', {
    loginId: 'hr.kim',
    password: ADMIN_PASSWORD,
  });
  assert.equal(locked.status, 423);
  server.close();
});

test('logout clears the cookie and ends the session', async () => {
  const { server, repos, base, call } = await start();
  const cookie = await loginAsAdmin(repos, base);
  const res = await call('POST', '/api/admin/auth/logout', undefined, cookie);
  assert.match(res.headers.get('set-cookie') ?? '', /facegate_session=;/);
  assert.equal((await call('GET', '/api/admin/access-logs', undefined, cookie)).status, 401);
  assert.equal((await call('GET', '/api/admin/auth/me', undefined, cookie)).status, 401);
  server.close();
});

test('admin actions are written to the audit log with who did them', async () => {
  const { server, repos, base, call } = await start();
  const cookie = await loginAsAdmin(repos, base);
  await call('POST', '/api/admin/auth/login', { loginId: 'hr.kim', password: 'wrong password!' });
  const issued = await call('POST', '/api/admin/settings/ingest-key', undefined, cookie);
  const { key } = (await issued.json()) as { key: string };
  const res = await call('GET', '/api/admin/audit-logs?limit=10', undefined, cookie);
  const logs = (await res.json()).items as {
    action: string;
    adminName: string | null;
    detail: unknown;
  }[];
  assert.deepEqual(
    logs.map((log) => log.action),
    ['INGEST_KEY_ISSUE', 'LOGIN_FAILED', 'LOGIN'],
  );
  assert.equal(logs[0].adminName, '김인사');
  assert.deepEqual(logs[0].detail, { hint: key.slice(-4) });
  assert.ok(!JSON.stringify(logs).includes(key));
  server.close();
});

test('malformed JSON on login is 400 and the password is not logged', async () => {
  const { server, base } = await start();
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void lines.push(args.join(' '));
  try {
    const res = await fetch(`${base}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"loginId":"hr.kim","password":"s3cret-Pass-word"',
    });
    assert.equal(res.status, 400);
  } finally {
    console.warn = original;
    server.close();
  }
  assert.ok(lines.length > 0);
  assert.ok(lines.every((line) => !line.includes('s3cret-Pass-word')));
});

test('cross-site writes to the admin API are refused', async () => {
  const { server, call } = await start();
  const login = { loginId: 'nobody', password: 'x' };
  assert.equal(
    (await call('POST', '/api/admin/auth/login', login, { Origin: 'http://evil.example' })).status,
    403,
  );
  assert.equal(
    (await call('POST', '/api/admin/auth/login', login, { 'Sec-Fetch-Site': 'cross-site' })).status,
    403,
  );
  const { port } = server.address() as AddressInfo;
  const same = await call('POST', '/api/admin/auth/login', login, {
    Origin: `http://127.0.0.1:${port}`,
  });
  assert.equal(same.status, 401); // 통과해 비밀번호 검사까지 감
  assert.equal((await call('POST', '/api/admin/auth/login', login)).status, 401);
  server.close();
});
