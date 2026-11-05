import test from 'node:test';
import assert from 'node:assert/strict';
import { photoSet, startServer } from './harness.ts';

test('admins manage orgs and employees must pick a known org', async (t) => {
  const { server, call, repos } = await startServer();
  t.after(() => server.close());
  const make = (body: unknown) => call('POST', '/api/admin/orgs', body);
  assert.equal((await make({ name: '', kind: 'DEPARTMENT' })).status, 400);
  assert.equal((await make({ name: '플랫폼팀', kind: 'X' })).status, 400);
  const created = await make({ name: '플랫폼팀', kind: 'DEPARTMENT' });
  assert.equal(created.status, 201);
  const { orgKey } = (await created.json()) as { orgKey: number };
  assert.equal((await make({ name: '플랫폼팀', kind: 'TENANT' })).status, 409);
  const register = (department: string) =>
    call('POST', '/api/admin/employees', {
      employeeNo: `E-${department}`,
      name: '홍길동',
      department,
      photos: photoSet(1),
      consent: true,
    });
  assert.equal((await register('없는팀')).status, 400);
  assert.equal((await register('플랫폼팀')).status, 200);
  const patched = await call('PATCH', `/api/admin/orgs/${orgKey}`, { name: '코어팀' });
  assert.equal(((await patched.json()) as { name: string }).name, '코어팀');
  assert.equal((await call('DELETE', `/api/admin/orgs/${orgKey}`)).status, 409);
  assert.deepEqual(
    repos.audits
      .list(5)
      .map((a) => a.action)
      .slice(0, 2),
    ['ORG_UPDATE', 'EMPLOYEE_REGISTER'],
  );
});

test('admins build access groups with a schedule and members, and give people groups directly', async (t) => {
  const { server, call, repos } = await startServer();
  t.after(() => server.close());
  const [fullDay] = (await (await call('GET', '/api/admin/schedules')).json()) as {
    scheduleKey: number;
    name: string;
  }[];
  assert.equal(fullDay.name, '24시간');
  const office = Array(8).fill(null);
  office[2] = { start: '09:00', end: '18:00' };
  assert.equal(
    (await call('POST', '/api/admin/schedules', { name: '화요일', days: [] })).status,
    400,
  );
  const created = await call('POST', '/api/admin/schedules', { name: '화요일', days: office });
  assert.equal(created.status, 201);
  const { scheduleKey } = (await created.json()) as { scheduleKey: number };

  const { orgKey } = (await (
    await call('POST', '/api/admin/orgs', { name: '입주사 A', kind: 'TENANT' })
  ).json()) as { orgKey: number };
  const group = {
    name: '입주사 A',
    scheduleKey,
    gateKeys: [2, 2],
    orgKeys: [orgKey],
    employeeKeys: [],
  };
  for (const bad of [
    { ...group, gateKeys: [999] },
    { ...group, scheduleKey: 999 },
    { ...group, name: '' },
  ])
    assert.equal((await call('POST', '/api/admin/access-groups', bad)).status, 400);
  const made = await call('POST', '/api/admin/access-groups', group);
  assert.equal(made.status, 201);
  const { groupKey } = (await made.json()) as { groupKey: number };
  assert.equal((await call('POST', '/api/admin/access-groups', group)).status, 409);
  assert.equal((await call('DELETE', `/api/admin/schedules/${scheduleKey}`)).status, 409); // 그룹이 씀

  const { employeeKey } = (await (
    await call('POST', '/api/admin/employees', {
      employeeNo: 'T1',
      name: '라',
      department: '입주사 A',
      photos: photoSet(1),
      consent: true,
    })
  ).json()) as { employeeKey: number };
  const all = (await (
    await call('POST', '/api/admin/access-groups', {
      name: '전체 출입',
      scheduleKey: fullDay.scheduleKey,
      gateKeys: [1, 2],
    })
  ).json()) as { groupKey: number };
  const url = `/api/admin/employees/${employeeKey}/access-groups`;
  assert.equal((await call('PUT', url, { groupKeys: [999] })).status, 400);
  assert.deepEqual(await (await call('PUT', url, { groupKeys: [all.groupKey] })).json(), {
    groupKeys: [all.groupKey],
    orgGroupKeys: [groupKey],
    gateKeys: [1, 2],
  });
  assert.equal((await call('GET', '/api/admin/employees/999/access-groups')).status, 404);
  const [log] = repos.audits.list(1);
  assert.deepEqual(
    [log.action, log.target, log.detail],
    ['ACCESS_RULE_UPDATE', `employee:${employeeKey}`, { groupKeys: [all.groupKey] }],
  );

  for (const date of ['2026-13-01', '2026-02-30'])
    assert.equal(
      (await call('POST', '/api/admin/holidays', { date, name: 'x' })).status,
      400,
      date,
    );
  assert.deepEqual(
    await (await call('POST', '/api/admin/holidays', { date: '2027-02-08', name: '설날' })).json(),
    [{ date: '2027-02-08', name: '설날' }],
  );
  assert.deepEqual(await (await call('DELETE', '/api/admin/holidays/2027-02-08')).json(), []);
  assert.equal((await call('DELETE', `/api/admin/access-groups/${groupKey}`)).status, 200);
  assert.equal((await call('DELETE', `/api/admin/schedules/${scheduleKey}`)).status, 200);
  assert.deepEqual(
    repos.audits.list(3).map((l) => [l.action, l.targetName]),
    [
      ['SCHEDULE_DELETE', null],
      ['ACCESS_GROUP_DELETE', null],
      ['HOLIDAY_DELETE', null],
    ],
  );
  // 하나 남은 시간표는 지울 수 없다 (새 그룹이 고를 것이 있어야 함)
  await call('DELETE', `/api/admin/access-groups/${all.groupKey}`);
  const last = await call('DELETE', `/api/admin/schedules/${fullDay.scheduleKey}`);
  assert.deepEqual(
    [last.status, await last.json()],
    [409, { error: 'keep at least one schedule' }],
  );
});
