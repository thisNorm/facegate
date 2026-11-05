import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../src/infrastructure/database/database.ts';
import { createRepositories } from '../../src/app/repositories.ts';
import { createAuditService } from '../../src/modules/audit/audit.service.ts';
import { createAdminService } from '../../src/modules/admin/admin.service.ts';

const PASSWORD = 'correct horse battery';

async function setup() {
  const repos = createRepositories(openDatabase(':memory:'));
  let clock = new Date('2026-10-29T00:00:00.000Z'); // KST 09:00
  const now = () => clock;
  const audit = createAuditService({ audits: repos.audits, now });
  const service = createAdminService({ admins: repos.admins, audit, now });
  await service.createAdmin('hr.kim', '김인사', PASSWORD);
  const advance = (ms: number) => (clock = new Date(clock.getTime() + ms));
  const actions = () =>
    repos.audits
      .list(100)
      .map((log) => log.action)
      .reverse();
  return { service, repos, advance, actions };
}

test('createAdmin rejects invalid ids, empty passwords and duplicates but accepts short passwords', async () => {
  const { service } = await setup();
  await assert.rejects(service.createAdmin('A', '대문자', PASSWORD), /login id/);
  await assert.rejects(service.createAdmin('empty.pw', '빈 값', ''), /password is required/);
  await assert.rejects(service.createAdmin('hr.kim', '중복', PASSWORD), /already exists/);
  await service.createAdmin('short.pw', '짧음', 'x');
  assert.ok(!('error' in (await service.login('short.pw', 'x'))));
  await service.createAdmin('space.pw', '공백도 값', ' ');
  assert.ok(!('error' in (await service.login('space.pw', ' '))));
});

test('login issues an 8 hour web session that authenticate accepts', async () => {
  const { service, advance, actions } = await setup();
  const result = await service.login('hr.kim', PASSWORD);
  assert.ok(!('error' in result));
  assert.equal(result.expiresAt, '2026-10-29 17:00:00');
  assert.equal(service.authenticate(result.token, 'WEB')?.name, '김인사');
  assert.equal(service.authenticate(result.token, 'TERMINAL'), null);
  assert.equal(service.authenticate(undefined, 'WEB'), null);
  advance(8 * 60 * 60 * 1000);
  assert.equal(service.authenticate(result.token, 'WEB'), null);
  assert.deepEqual(actions(), ['ADMIN_CREATE', 'LOGIN']);
});

test('wrong password and unknown id both answer INVALID', async () => {
  const { service, actions } = await setup();
  assert.deepEqual(await service.login('hr.kim', 'wrong password!'), { error: 'INVALID' });
  assert.deepEqual(await service.login('nobody', PASSWORD), { error: 'INVALID' });
  assert.deepEqual(actions(), ['ADMIN_CREATE', 'LOGIN_FAILED', 'LOGIN_FAILED']);
});

test('five failures lock the account for 10 minutes', async () => {
  const { service, advance } = await setup();
  for (let i = 0; i < 5; i++) await service.login('hr.kim', 'wrong password!');
  assert.deepEqual(await service.login('hr.kim', PASSWORD), { error: 'LOCKED' });
  advance(10 * 60 * 1000);
  const result = await service.login('hr.kim', PASSWORD);
  assert.ok(!('error' in result));
});

test('a successful login resets the failure count', async () => {
  const { service } = await setup();
  for (let i = 0; i < 4; i++) await service.login('hr.kim', 'wrong password!');
  assert.ok(!('error' in (await service.login('hr.kim', PASSWORD))));
  for (let i = 0; i < 4; i++) await service.login('hr.kim', 'wrong password!');
  assert.ok(!('error' in (await service.login('hr.kim', PASSWORD))));
});

test('logout ends the session', async () => {
  const { service, actions } = await setup();
  const result = await service.login('hr.kim', PASSWORD);
  assert.ok(!('error' in result));
  service.logout(result.token, result.admin);
  assert.equal(service.authenticate(result.token, 'WEB'), null);
  assert.equal(actions().at(-1), 'LOGOUT');
});

test('terminal login gives a 10 minute token that only works as a terminal session', async () => {
  const { service, advance, actions } = await setup();
  const result = await service.terminalLogin('hr.kim', PASSWORD, 101);
  assert.ok(!('error' in result));
  assert.equal(result.expiresAt, '2026-10-29 09:10:00');
  assert.equal(service.authenticate(result.token, 'TERMINAL')?.loginId, 'hr.kim');
  assert.equal(service.authenticate(result.token, 'WEB'), null);
  assert.deepEqual(await service.terminalLogin('hr.kim', 'wrong password!', 101), {
    error: 'INVALID',
  });
  advance(10 * 60 * 1000);
  assert.equal(service.authenticate(result.token, 'TERMINAL'), null);
  assert.deepEqual(actions().slice(-2), ['TERMINAL_LOGIN', 'TERMINAL_LOGIN_FAILED']);
});

test('terminal and web logins share the failure lock', async () => {
  const { service } = await setup();
  for (let i = 0; i < 5; i++) await service.terminalLogin('hr.kim', 'wrong password!', 101);
  assert.deepEqual(await service.login('hr.kim', PASSWORD), { error: 'LOCKED' });
});

test('parallel wrong passwords lock the account and the lock is not erased', async () => {
  const { service } = await setup();
  const wrong = () => service.login('hr.kim', 'wrong password!');
  await Promise.all(Array.from({ length: 9 }, wrong));
  assert.deepEqual(await service.login('hr.kim', PASSWORD), { error: 'LOCKED' });
});

test('a correct password that finishes after the lock is refused', async () => {
  const { service } = await setup();
  const wrong = () => service.login('hr.kim', 'wrong password!');
  // 맞는 비밀번호가 마지막에 큐에 들어가 잠금 뒤에 끝남
  const results = await Promise.all([
    ...Array.from({ length: 8 }, wrong),
    service.login('hr.kim', PASSWORD),
  ]);
  assert.deepEqual(results.at(-1), { error: 'LOCKED' });
  assert.deepEqual(await service.login('hr.kim', PASSWORD), { error: 'LOCKED' });
});

test('a login id that breaks the pattern answers INVALID and is not stored raw', async () => {
  const { service, repos } = await setup();
  const raw = 'X'.repeat(500);
  assert.deepEqual(await service.login(raw, PASSWORD), { error: 'INVALID' });
  assert.deepEqual(await service.terminalLogin(raw, PASSWORD, 101), { error: 'INVALID' });
  const targets = repos.audits.list(100).map((log) => log.target);
  assert.deepEqual(targets.slice(0, 2), ['loginId:<invalid>', 'loginId:<invalid>']);
});
