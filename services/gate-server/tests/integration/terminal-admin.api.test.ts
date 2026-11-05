import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../../src/infrastructure/database/database.ts';
import { createRepositories } from '../../src/app/repositories.ts';
import { createServer } from '../../src/app/server.ts';
import { ADMIN_PASSWORD, loginAsAdmin } from './admin-session.ts';
import { testRegistry } from './registry.ts';
import type { FileGate } from '../../src/app/config.ts';

const DEVICE = { Authorization: 'Bearer device-token' };

async function start() {
  const repos = createRepositories(openDatabase(':memory:'));
  const gates: FileGate[] = [
    {
      gateKey: 1,
      name: 'g1',
      adapter: { type: 'MOCK' },
      terminals: [
        { terminalKey: 101, token: 'device-token', rtspUri: 'rtsp://gate101:pw@10.0.0.5:8555/' },
      ],
    },
  ];
  const server = await createServer({
    config: { ingestKey: 'ingest', fileDir: 'storage/test-files', duplicateWindowMs: 5000 },
    repos,
    registry: testRegistry(repos, gates),
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

test('terminal admin API needs the device token', async () => {
  const { server, repos, base, call } = await start();
  await loginAsAdmin(repos, base);
  const body = { loginId: 'hr.kim', password: ADMIN_PASSWORD };
  assert.equal((await call('POST', '/api/terminal/admin/login', body)).status, 401);
  assert.equal(
    (await call('POST', '/api/terminal/admin/login', body, { Authorization: 'Bearer wrong' }))
      .status,
    401,
  );
  server.close();
});

test('id and password give a 10 minute terminal admin token', async () => {
  const { server, repos, base, call } = await start();
  await loginAsAdmin(repos, base);
  const res = await call(
    'POST',
    '/api/terminal/admin/login',
    { loginId: 'hr.kim', password: ADMIN_PASSWORD },
    DEVICE,
  );
  assert.equal(res.status, 200);
  const { token, expiresAt, admin } = (await res.json()) as {
    token: string;
    expiresAt: string;
    admin: { name: string };
  };
  assert.equal(expiresAt, '2026-10-29 09:10:00');
  assert.equal(admin.name, '김인사');
  const me = await call('GET', '/api/terminal/admin/me', undefined, {
    ...DEVICE,
    'X-Terminal-Admin-Token': token,
  });
  assert.equal(me.status, 200);
  assert.equal((await call('GET', '/api/terminal/admin/me', undefined, DEVICE)).status, 401);
  // 단말 토큰은 웹 세션으로 쓸 수 없다
  assert.equal(
    (
      await call('GET', '/api/admin/access-logs', undefined, {
        Cookie: `facegate_session=${token}`,
      })
    ).status,
    401,
  );
  server.close();
});

test('terminal logins and failures are written to the audit log with the terminal id', async () => {
  const { server, repos, base, call } = await start();
  const cookie = await loginAsAdmin(repos, base);
  await call(
    'POST',
    '/api/terminal/admin/login',
    { loginId: 'hr.kim', password: ADMIN_PASSWORD },
    DEVICE,
  );
  await call(
    'POST',
    '/api/terminal/admin/login',
    { loginId: 'hr.kim', password: 'wrong password!' },
    DEVICE,
  );
  const logs = (await (await call('GET', '/api/admin/audit-logs', undefined, cookie)).json())
    .items as {
    action: string;
    target: string | null;
    detail: unknown;
  }[];
  assert.equal(logs[1].action, 'TERMINAL_LOGIN');
  assert.equal(logs[1].target, 'terminal:101');
  assert.equal(logs[0].action, 'TERMINAL_LOGIN_FAILED');
  assert.deepEqual(logs[0].detail, { terminalKey: 101 });
  server.close();
});

test('missing fields are 400', async () => {
  const { server, call } = await start();
  assert.equal(
    (await call('POST', '/api/terminal/admin/login', { loginId: 'hr.kim' }, DEVICE)).status,
    400,
  );
  server.close();
});
