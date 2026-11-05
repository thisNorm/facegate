import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../src/infrastructure/database/database.ts';
import { createRepositories } from '../../src/app/repositories.ts';

const repos = () => createRepositories(openDatabase(':memory:'));
const T = '2026-10-29 09:00:00';

test('admin accounts are unique by login id', () => {
  const { admins } = repos();
  const key = admins.addAdmin({
    loginId: 'hr.kim',
    name: '김인사',
    passwordHash: 'h',
    createdAt: T,
  });
  const row = admins.findByLoginId('hr.kim');
  assert.equal(row?.adminKey, key);
  assert.equal(row?.name, '김인사');
  assert.equal(row?.enabled, 1);
  assert.equal(row?.failedCount, 0);
  assert.equal(row?.lockedUntil, null);
  assert.throws(() =>
    admins.addAdmin({ loginId: 'hr.kim', name: '중복', passwordHash: 'h', createdAt: T }),
  );
});

test('failures and lock time are stored per admin', () => {
  const { admins } = repos();
  const key = admins.addAdmin({ loginId: 'a.b', name: 'A', passwordHash: 'h', createdAt: T });
  admins.setFailures(key, 0, '2026-10-29 09:10:00');
  assert.equal(admins.findByLoginId('a.b')?.lockedUntil, '2026-10-29 09:10:00');
});

test('sessions match by hash, kind and expiry', () => {
  const { admins } = repos();
  const adminKey = admins.addAdmin({ loginId: 'a.b', name: 'A', passwordHash: 'h', createdAt: T });
  admins.addSession({
    tokenHash: 'w',
    adminKey,
    kind: 'WEB',
    expiresAt: '2026-10-29 17:00:00',
    createdAt: T,
  });
  assert.equal(admins.findSession('w', 'WEB', T)?.loginId, 'a.b');
  assert.equal(admins.findSession('w', 'TERMINAL', T), undefined);
  assert.equal(admins.findSession('w', 'WEB', '2026-10-29 17:00:00'), undefined);
  admins.deleteExpiredSessions('2026-10-29 17:00:01');
  assert.equal(admins.findSession('w', 'WEB', T), undefined);
});

test('audit log keeps admin name and JSON detail, newest first', () => {
  const { admins, audits } = repos();
  const adminKey = admins.addAdmin({ loginId: 'a.b', name: 'A', passwordHash: 'h', createdAt: T });
  audits.add({ adminKey: null, action: 'LOGIN_FAILED', target: 'loginId:x', detail: null }, T);
  audits.add(
    { adminKey, action: 'EMPLOYEE_REGISTER', target: 'employee:1', detail: { employeeNo: 'E1' } },
    '2026-10-29 09:01:00',
  );
  const [latest, first] = audits.list(10);
  assert.equal(latest.action, 'EMPLOYEE_REGISTER');
  assert.equal(latest.adminName, 'A');
  assert.deepEqual(latest.detail, { employeeNo: 'E1' });
  assert.equal(first.adminKey, null);
  assert.equal(first.adminName, null);
  assert.equal(audits.list(1).length, 1);
  assert.equal(audits.list(1, 1)[0].action, 'LOGIN_FAILED'); // 두 번째 쪽
  assert.equal(audits.count(), 2);
});
