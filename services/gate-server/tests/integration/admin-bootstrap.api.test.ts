import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../../src/infrastructure/database/database.ts';
import { createRepositories } from '../../src/app/repositories.ts';
import { createServer } from '../../src/app/server.ts';
import type { ServerConfig } from '../../src/app/config.ts';
import type { AdminSession } from '../../src/modules/admin/admin.types.ts';
import { hashPassword, verifyPassword } from '../../src/shared/password.ts';
import { testRegistry } from './registry.ts';

const BOOT_ID = 'boot.admin';
const BOOT_PASSWORD = 'boot password';
const NOW = '2026-10-29 09:00:00';

async function start(
  t: TestContext,
  overrides: Partial<ServerConfig> = {},
  repos = createRepositories(openDatabase(':memory:')),
) {
  const server = await createServer({
    config: {
      ingestKey: 'ingest',
      fileDir: os.tmpdir(),
      duplicateWindowMs: 5000,
      initialAdminId: BOOT_ID,
      initialAdminPassword: BOOT_PASSWORD,
      ...overrides,
    },
    repos,
    registry: testRegistry(repos),
    gateControl: { async open() {}, async releaseAll() {} },
    terminalHub: { handleUpgrade() {}, broadcast() {}, isConnected: () => false, disconnect() {} },
    now: () => new Date('2026-10-29T00:00:00.000Z'),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
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
  return { repos, call };
}

const cookieOf = (res: Response) => ({
  Cookie: (res.headers.get('set-cookie') ?? '').split(';')[0],
});
const login = (
  call: Awaited<ReturnType<typeof start>>['call'],
  loginId = BOOT_ID,
  password = BOOT_PASSWORD,
) => call('POST', '/api/admin/auth/login', { loginId, password });

function warnings(t: TestContext) {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void lines.push(args.join(' '));
  t.after(() => {
    console.warn = original;
  });
  return lines;
}

test('startup seeds a hashed first account, with name equal to id and first-login flag', async (t) => {
  const lines = warnings(t);
  const { repos, call } = await start(t);
  const row = repos.admins.findByLoginId(BOOT_ID);
  assert.ok(row);
  assert.equal(row.name, BOOT_ID);
  assert.equal(row.mustChangeCredentials, 1);
  assert.notEqual(row.passwordHash, BOOT_PASSWORD);
  assert.equal(await verifyPassword(BOOT_PASSWORD, row.passwordHash), true);
  const res = await login(call);
  assert.equal(res.status, 200);
  const expected = {
    admin: { adminKey: row.adminKey, loginId: BOOT_ID, name: BOOT_ID },
    mustChangeCredentials: true,
    appEnv: 'production',
  };
  assert.deepEqual(await res.json(), { ...expected, expiresAt: '2026-10-29 17:00:00' });
  assert.deepEqual(
    await (await call('GET', '/api/admin/auth/me', undefined, cookieOf(res))).json(),
    expected,
  );
  const written = JSON.stringify({
    lines,
    audits: repos.audits.list(100).map(({ target, detail }) => ({ target, detail })),
  });
  assert.ok(!written.includes(BOOT_ID));
  assert.ok(!written.includes(BOOT_PASSWORD));
});

test('each missing initial value skips creation and gives exactly one warning per start', async (t) => {
  const lines = warnings(t);
  const cases = [
    { initialAdminId: undefined, initialAdminPassword: undefined },
    { initialAdminId: BOOT_ID, initialAdminPassword: undefined },
    { initialAdminId: undefined, initialAdminPassword: BOOT_PASSWORD },
    { initialAdminId: '', initialAdminPassword: '' },
  ];
  for (const config of cases) {
    const before = lines.length;
    const { repos, call } = await start(t, config);
    assert.equal(repos.admins.countAdmins(), 0);
    assert.equal((await call('GET', '/api/admin/auth/me')).status, 401);
    assert.equal(lines.length - before, 1);
    assert.match(lines.at(-1) ?? '', /INITIAL_ADMIN_ID.*INITIAL_ADMIN_PASSWORD/);
  }
  assert.ok(!lines.join('\n').includes(BOOT_ID));
  assert.ok(!lines.join('\n').includes(BOOT_PASSWORD));
});

test('restart never resets an existing normal account or makes a second initial account', async (t) => {
  const { repos, call } = await start(t);
  const cookie = cookieOf(await login(call));
  assert.equal(
    (
      await call(
        'POST',
        '/api/admin/auth/credentials',
        {
          currentPassword: BOOT_PASSWORD,
          newPassword: 'x',
        },
        cookie,
      )
    ).status,
    200,
  );
  const hash = repos.admins.findByLoginId(BOOT_ID)?.passwordHash;
  await start(t, { initialAdminId: 'another.admin', initialAdminPassword: 'another fake' }, repos);
  assert.equal(repos.admins.countAdmins(), 1);
  assert.equal(repos.admins.findByLoginId(BOOT_ID)?.passwordHash, hash);
  assert.equal(repos.admins.findByLoginId(BOOT_ID)?.mustChangeCredentials, 0);
  assert.equal(repos.admins.findByLoginId('another.admin'), undefined);
});

test('concurrent startup seeding still creates only one initial account', async (t) => {
  const repos = createRepositories(openDatabase(':memory:'));
  await Promise.all([start(t, {}, repos), start(t, {}, repos)]);
  assert.equal(repos.admins.countAdmins(), 1);
});

test('development creates dev without the first-login flag and reports the environment', async (t) => {
  const lines = warnings(t);
  const { repos, call } = await start(t, { appEnv: 'development' });
  assert.equal(repos.admins.countAdmins(), 2);
  const res = await login(call, 'dev', '1234');
  assert.equal(res.status, 200);
  const body = (await res.json()) as AdminSession & { expiresAt: string };
  assert.equal(body.mustChangeCredentials, false);
  assert.equal(body.appEnv, 'development');
  const me = await (await call('GET', '/api/admin/auth/me', undefined, cookieOf(res))).json();
  assert.deepEqual(me, { admin: body.admin, mustChangeCredentials: false, appEnv: 'development' });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /개발 모드/);
  assert.ok(!lines[0].includes('1234'));
});

test('ordinary admins cannot create the reserved development account', async (t) => {
  const { repos, call } = await start(t);
  const cookie = cookieOf(await login(call));
  const res = await call(
    'POST',
    '/api/admin/admins',
    {
      loginId: 'dev',
      name: 'development',
      password: 'fake password',
    },
    cookie,
  );
  assert.equal(res.status, 400);
  assert.equal(repos.admins.findByLoginId('dev'), undefined);
});

test('ordinary admins cannot rename themselves to the reserved development identity', async (t) => {
  const { repos, call } = await start(t);
  const cookie = cookieOf(await login(call));
  const res = await call(
    'POST',
    '/api/admin/auth/credentials',
    {
      loginId: 'dev',
      currentPassword: BOOT_PASSWORD,
    },
    cookie,
  );
  assert.equal(res.status, 400);
  assert.ok(repos.admins.findByLoginId(BOOT_ID));
  assert.equal(repos.admins.findByLoginId('dev'), undefined);
});

test('the development account cannot rename itself but can change its password', async (t) => {
  const { repos, call } = await start(t, { appEnv: 'development' });
  const cookie = cookieOf(await login(call, 'dev', '1234'));
  const res = await call(
    'POST',
    '/api/admin/auth/credentials',
    {
      loginId: 'renamed.dev',
      currentPassword: '1234',
    },
    cookie,
  );
  assert.equal(res.status, 400);
  assert.equal(repos.admins.findByLoginId('renamed.dev'), undefined);
  assert.ok(repos.admins.findByLoginId('dev'));
  assert.equal(
    (
      await call(
        'POST',
        '/api/admin/auth/credentials',
        {
          currentPassword: '1234',
          newPassword: 'changed fake',
        },
        cookie,
      )
    ).status,
    200,
  );
  assert.equal((await login(call, 'dev', 'changed fake')).status, 200);
});

test('development resets an existing dev password, flag, failures and disabled state', async (t) => {
  const lines = warnings(t);
  const repos = createRepositories(openDatabase(':memory:'));
  const devKey = repos.admins.addAdmin({
    loginId: 'dev',
    name: 'dev',
    passwordHash: await hashPassword('changed fake'),
    createdAt: NOW,
    mustChangeCredentials: true,
  });
  repos.admins.setEnabled(devKey, false);
  repos.admins.setFailures(devKey, 0, '2026-10-29 09:10:00');
  repos.admins.addSession({
    tokenHash: 'old-dev',
    adminKey: devKey,
    kind: 'WEB',
    expiresAt: '2026-10-29 17:00:00',
    createdAt: NOW,
  });
  const { call } = await start(t, { appEnv: 'development' }, repos);
  const row = repos.admins.findByLoginId('dev');
  assert.equal(row?.enabled, 1);
  assert.equal(row?.mustChangeCredentials, 0);
  assert.equal(row?.failedCount, 0);
  assert.equal(row?.lockedUntil, null);
  assert.equal(repos.admins.findSession('old-dev', 'WEB', NOW), undefined);
  assert.equal((await login(call, 'dev', '1234')).status, 200);
  assert.equal(lines.filter((line) => line.includes('개발 모드')).length, 1);
});

test('production removes dev including web and terminal sessions, then seeds if nobody remains', async (t) => {
  const lines = warnings(t);
  const repos = createRepositories(openDatabase(':memory:'));
  const devKey = repos.admins.addAdmin({
    loginId: 'dev',
    name: 'dev',
    passwordHash: await hashPassword('1234'),
    createdAt: NOW,
  });
  for (const kind of ['WEB', 'TERMINAL'] as const)
    repos.admins.addSession({
      tokenHash: kind,
      adminKey: devKey,
      kind,
      expiresAt: '2026-10-29 17:00:00',
      createdAt: NOW,
    });
  const { call } = await start(t, { appEnv: 'production' }, repos);
  assert.equal(repos.admins.findByLoginId('dev'), undefined);
  assert.equal(repos.admins.findSession('WEB', 'WEB', NOW), undefined);
  assert.equal(repos.admins.findSession('TERMINAL', 'TERMINAL', NOW), undefined);
  assert.equal(repos.admins.countAdmins(), 1);
  assert.equal((await login(call, 'dev', '1234')).status, 401);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /운영 모드.*개발 계정.*삭제/);
  assert.ok(!lines[0].includes('1234'));
});

for (const input of [
  { extra: {}, loginIdChanged: false, passwordChanged: false },
  {
    extra: { loginId: BOOT_ID, newPassword: BOOT_PASSWORD },
    loginIdChanged: false,
    passwordChanged: false,
  },
  { extra: { loginId: 'renamed.admin' }, loginIdChanged: true, passwordChanged: false },
  { extra: { newPassword: 'x' }, loginIdChanged: false, passwordChanged: true },
  {
    extra: { loginId: 'renamed.admin', newPassword: 'x' },
    loginIdChanged: true,
    passwordChanged: true,
  },
]) {
  test(`credentials accepts ${JSON.stringify(input.extra)} and audits only change booleans`, async (t) => {
    const { repos, call } = await start(t);
    const cookie = cookieOf(await login(call));
    const other = cookieOf(await login(call));
    const res = await call(
      'POST',
      '/api/admin/auth/credentials',
      { currentPassword: BOOT_PASSWORD, ...input.extra },
      cookie,
    );
    assert.equal(res.status, 200);
    const loginId = input.extra.loginId ?? BOOT_ID;
    assert.deepEqual(await res.json(), { admin: { adminKey: 1, loginId, name: BOOT_ID } });
    const row = repos.admins.findByLoginId(loginId);
    assert.equal(row?.mustChangeCredentials, 0);
    assert.equal(
      await verifyPassword(input.extra.newPassword ?? BOOT_PASSWORD, row?.passwordHash ?? ''),
      true,
    );
    const me = (await (
      await call('GET', '/api/admin/auth/me', undefined, cookie)
    ).json()) as AdminSession;
    assert.deepEqual(me, {
      admin: { adminKey: 1, loginId, name: BOOT_ID },
      mustChangeCredentials: false,
      appEnv: 'production',
    });
    const changed = input.loginIdChanged || input.passwordChanged;
    assert.equal(
      (await call('GET', '/api/admin/auth/me', undefined, other)).status,
      changed ? 401 : 200,
    );
    const [log] = repos.audits.list(100).filter((entry) => entry.action.startsWith('CREDENTIALS_'));
    assert.equal(log.action, changed ? 'CREDENTIALS_CHANGE' : 'CREDENTIALS_CONFIRM');
    assert.equal(log.target, 'admin:1');
    assert.deepEqual(log.detail, {
      loginIdChanged: input.loginIdChanged,
      passwordChanged: input.passwordChanged,
    });
    assert.ok(!JSON.stringify(log).includes(BOOT_PASSWORD));
    assert.ok(!JSON.stringify(log.detail).includes(loginId));
    assert.ok(!JSON.stringify(log.detail).includes('newPassword'));
  });
}

test('credentials rejects missing sessions, cross-site writes and bad inputs without clearing the flag', async (t) => {
  const { repos, call } = await start(t);
  const cookie = cookieOf(await login(call));
  repos.admins.addAdmin({
    loginId: 'taken.admin',
    name: '다른 관리자',
    passwordHash: await hashPassword('y'),
    createdAt: NOW,
  });
  const url = '/api/admin/auth/credentials';
  assert.equal((await call('POST', url, { currentPassword: BOOT_PASSWORD })).status, 401);
  assert.equal(
    (
      await call(
        'POST',
        url,
        { currentPassword: BOOT_PASSWORD },
        { ...cookie, Origin: 'http://evil.example' },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        'POST',
        url,
        { currentPassword: BOOT_PASSWORD },
        { ...cookie, 'Sec-Fetch-Site': 'cross-site' },
      )
    ).status,
    403,
  );
  for (const [body, status] of [
    [{}, 400],
    [{ currentPassword: '' }, 400],
    [{ currentPassword: 1 }, 400],
    [{ currentPassword: 'wrong fake' }, 401],
    [{ currentPassword: BOOT_PASSWORD, loginId: 'Bad Id' }, 400],
    [{ currentPassword: BOOT_PASSWORD, loginId: '' }, 400],
    [{ currentPassword: BOOT_PASSWORD, loginId: 1 }, 400],
    [{ currentPassword: BOOT_PASSWORD, loginId: 'taken.admin' }, 409],
    [{ currentPassword: BOOT_PASSWORD, newPassword: '' }, 400],
    [{ currentPassword: BOOT_PASSWORD, newPassword: null }, 400],
  ] as const) {
    assert.equal((await call('POST', url, body, cookie)).status, status);
    assert.equal(repos.admins.findByLoginId(BOOT_ID)?.mustChangeCredentials, 1);
  }
  assert.equal(
    repos.audits.list(100).filter((entry) => entry.action.startsWith('CREDENTIALS_')).length,
    0,
  );
});
