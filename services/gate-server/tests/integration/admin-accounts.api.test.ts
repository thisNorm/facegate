import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './harness.ts';
import { ADMIN_PASSWORD } from './admin-session.ts';

const login = (base: string, loginId: string, password: string) =>
  fetch(`${base}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginId, password }),
  });

test('admins can list and add other admins', async () => {
  const { server, call, base } = await startServer();
  const added = await call('POST', '/api/admin/admins', {
    loginId: 'hr.lee',
    name: '이인사',
    password: 'another long password',
  });
  assert.equal(added.status, 201);
  const list = (await (await call('GET', '/api/admin/admins')).json()) as {
    loginId: string;
    enabled: boolean;
  }[];
  assert.deepEqual(
    list.map((a) => [a.loginId, a.enabled]),
    [
      ['hr.kim', true],
      ['hr.lee', true],
    ],
  );
  assert.equal((await login(base, 'hr.lee', 'another long password')).status, 200);
  assert.equal(
    (
      await call('POST', '/api/admin/admins', {
        loginId: 'hr.lee',
        name: 'x',
        password: 'another long password',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call('POST', '/api/admin/admins', {
        loginId: 'Bad Id',
        name: 'x',
        password: 'another long password',
      })
    ).status,
    400,
  );
  assert.equal((await call('GET', '/api/admin/admins', undefined, {})).status, 401);
  server.close();
});

test('admin creation rejects an empty password but accepts one character', async () => {
  const { server, call, base } = await startServer();
  try {
    assert.equal(
      (
        await call('POST', '/api/admin/admins', {
          loginId: 'empty.admin',
          name: '빈 값',
          password: '',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call('POST', '/api/admin/admins', {
          loginId: 'short.admin',
          name: '짧음',
          password: 'x',
        })
      ).status,
      201,
    );
    const res = await login(base, 'short.admin', 'x');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).mustChangeCredentials, false);
  } finally {
    server.close();
  }
});

test('disabling an admin ends their sessions; you cannot disable yourself', async () => {
  const { server, call, base } = await startServer();
  const { adminKey } = (await (
    await call('POST', '/api/admin/admins', {
      loginId: 'hr.lee',
      name: '이인사',
      password: 'another long password',
    })
  ).json()) as { adminKey: number };
  const lee = {
    Cookie: (
      (await login(base, 'hr.lee', 'another long password')).headers.get('set-cookie') ?? ''
    ).split(';')[0],
  };
  assert.equal((await call('GET', '/api/admin/status', undefined, lee)).status, 200);

  assert.equal(
    (await call('PATCH', `/api/admin/admins/${adminKey}`, { enabled: false })).status,
    200,
  );
  assert.equal((await call('GET', '/api/admin/status', undefined, lee)).status, 401);
  assert.equal((await login(base, 'hr.lee', 'another long password')).status, 401);
  assert.equal((await call('PATCH', '/api/admin/admins/1', { enabled: false })).status, 400);
  assert.equal((await call('PATCH', '/api/admin/admins/99', { enabled: false })).status, 404);
  assert.equal(
    (await call('PATCH', `/api/admin/admins/${adminKey}`, { enabled: 'no' })).status,
    400,
  );

  assert.equal(
    (await call('PATCH', `/api/admin/admins/${adminKey}`, { enabled: true })).status,
    200,
  );
  assert.equal((await login(base, 'hr.lee', 'another long password')).status, 200);
  const actions = (
    (await (await call('GET', '/api/admin/audit-logs?limit=3')).json()).items as {
      action: string;
    }[]
  ).map((l) => l.action);
  assert.deepEqual(actions, ['LOGIN', 'ADMIN_ENABLE', 'LOGIN_FAILED']);
  server.close();
});

test('changing my password keeps this session and ends the others', async () => {
  const { server, call, base } = await startServer();
  const other = {
    Cookie: ((await login(base, 'hr.kim', ADMIN_PASSWORD)).headers.get('set-cookie') ?? '').split(
      ';',
    )[0],
  };
  const url = '/api/admin/auth/password';
  assert.equal(
    (
      await call('POST', url, {
        currentPassword: 'wrong password!',
        newPassword: 'brand new password',
      })
    ).status,
    401,
  );
  assert.equal(
    (await call('POST', url, { currentPassword: ADMIN_PASSWORD, newPassword: '' })).status,
    400,
  );
  assert.equal(
    (await call('POST', url, { currentPassword: ADMIN_PASSWORD, newPassword: 'x' })).status,
    200,
  );
  assert.equal((await call('GET', '/api/admin/status')).status, 200);
  assert.equal((await call('GET', '/api/admin/status', undefined, other)).status, 401);
  assert.equal((await login(base, 'hr.kim', 'x')).status, 200);
  server.close();
});
