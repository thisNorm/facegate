import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../src/infrastructure/database/database.ts';
import { createRepositories } from '../../src/app/repositories.ts';

const AT = '2026-11-03 09:00:00';

test('departments already typed on employees become orgs once', () => {
  const repos = createRepositories(openDatabase(':memory:'));
  repos.employees.addEmployee({ employeeNo: 'A', name: '가', department: '개발팀' });
  repos.employees.addEmployee({ employeeNo: 'B', name: '나', department: '개발팀' });
  repos.employees.addEmployee({ employeeNo: 'C', name: '다', department: '' });
  assert.equal(repos.orgs.seedFromDepartments(AT), 1);
  assert.equal(repos.orgs.seedFromDepartments(AT), 0);
  assert.deepEqual(
    repos.orgs.list().map((o) => ({ ...o })), // node:sqlite 행은 프로토타입이 없다
    [{ orgKey: 1, name: '개발팀', kind: 'DEPARTMENT', employeeCount: 2 }],
  );
});

test('renaming an org renames its employees; an org with employees cannot be removed', () => {
  const repos = createRepositories(openDatabase(':memory:'));
  const key = repos.orgs.create({ name: '입주사 A', kind: 'TENANT' }, AT);
  const emp = repos.employees.addEmployee({ employeeNo: 'T1', name: '라', department: '입주사 A' });
  assert.equal(repos.orgs.update(key, { name: '에이랩' }), true);
  assert.equal(repos.employees.getEmployee(emp)?.department, '에이랩');
  assert.equal(repos.orgs.remove(key), 'HAS_EMPLOYEES');
  repos.employees.updateEmployee(emp, { department: '' });
  assert.equal(repos.orgs.remove(key), 'OK');
  assert.equal(repos.orgs.remove(key), 'NOT_FOUND');
});
