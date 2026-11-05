import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/infrastructure/database/database.ts';
import { createRepositories } from '../../src/app/repositories.ts';
import {
  ALL_DAY,
  isOpen,
  parseDays,
  type WeekDays,
} from '../../src/modules/permission/schedule.ts';

const AT = '2026-11-04 09:00:00';
/** 한국 시간 문자열 → Date */
const kst = (text: string) => new Date(`${text}+09:00`);
const mock = { type: 'MOCK' } as const;
/** 평일 09~18시, 주말과 휴일 막음 */
const OFFICE: WeekDays = [null, ...Array(5).fill({ start: '09:00', end: '18:00' }), null, null];

test('schedule days: weekday ranges, holidays use the 8th slot, and bad input is refused', () => {
  const none = () => false;
  assert.equal(isOpen(OFFICE, kst('2026-11-04T09:00:00'), none), true); // 수요일 시작 시각
  assert.equal(isOpen(OFFICE, kst('2026-11-04T17:59:00'), none), true);
  assert.equal(isOpen(OFFICE, kst('2026-11-04T18:00:00'), none), false); // 끝은 포함 안 함
  assert.equal(isOpen(OFFICE, kst('2026-11-08T10:00:00'), none), false); // 일요일
  assert.equal(
    isOpen(OFFICE, kst('2026-11-04T10:00:00'), (d) => d === '2026-11-04'),
    false,
  );
  assert.equal(isOpen(ALL_DAY, kst('2026-11-04T23:59:00'), none), true);
  assert.deepEqual(parseDays(OFFICE), OFFICE);
  for (const bad of [
    [],
    Array(8).fill({ start: '18:00', end: '09:00' }),
    Array(8).fill({ start: '9:00', end: '18:00' }),
  ])
    assert.equal(parseDays(bad), null);
});

test('a person passes an open gate or a gate of a group they belong to, inside its schedule', () => {
  const repos = createRepositories(openDatabase(':memory:'));
  repos.permissions.prepare(AT);
  const [fullDay] = repos.permissions.schedules();
  assert.equal(fullDay.name, '24시간');
  const office = repos.permissions.createSchedule('근무시간', OFFICE, AT);
  const lobby = repos.gates.insertGate(
    { name: '로비', adapter: mock, floor: 1, openToAll: true },
    AT,
  );
  const g3 = repos.gates.insertGate({ name: '3층', adapter: mock, floor: 3 }, AT);
  const g7 = repos.gates.insertGate({ name: '7층', adapter: mock, floor: 7 }, AT);
  const dev = repos.orgs.create({ name: '개발팀', kind: 'DEPARTMENT' }, AT);
  const kim = {
    employeeKey: repos.employees.addEmployee({ employeeNo: 'K', name: '김', department: '개발팀' }),
    department: '개발팀',
  };
  const boss = {
    employeeKey: repos.employees.addEmployee({ employeeNo: 'B', name: '대표', department: '' }),
    department: '',
  };
  repos.permissions.createGroup(
    { name: '개발팀', scheduleKey: office, gateKeys: [g3], orgKeys: [dev], employeeKeys: [] },
    AT,
  );
  const all = repos.permissions.createGroup(
    {
      name: '전체 출입',
      scheduleKey: fullDay.scheduleKey,
      gateKeys: [g3, g7],
      orgKeys: [],
      employeeKeys: [boss.employeeKey],
    },
    AT,
  );
  const gate = (key: number) => repos.gates.getGate(key)!;
  const at = (who: typeof kim, when: string) =>
    [lobby, g3, g7].map((k) => repos.permissions.check(who, gate(k), kst(when)));

  assert.deepEqual(at(kim, '2026-11-04T10:00:00'), ['ALLOWED', 'ALLOWED', 'NO_GATE']);
  assert.deepEqual(at(kim, '2026-11-04T20:00:00'), ['ALLOWED', 'OFF_HOURS', 'NO_GATE']);
  assert.deepEqual(at(boss, '2026-11-04T20:00:00'), ['ALLOWED', 'ALLOWED', 'ALLOWED']);
  repos.permissions.addHoliday({ date: '2026-11-04', name: '창립기념일' });
  assert.equal(repos.permissions.check(kim, gate(g3), kst('2026-11-04T10:00:00')), 'OFF_HOURS');

  // 한 사람이 여러 그룹: 직접 넣으면 소속 그룹과 합쳐진다
  repos.permissions.setEmployeeGroups(kim.employeeKey, [all, all]);
  assert.deepEqual(repos.permissions.employeeAccess(kim), {
    groupKeys: [all],
    orgGroupKeys: [1],
    gateKeys: [g3, g7],
  });
  assert.equal(repos.permissions.check(kim, gate(g3), kst('2026-11-04T10:00:00')), 'ALLOWED');

  assert.equal(repos.permissions.removeSchedule(office), 'IN_USE');
  repos.gates.deleteGate(g7); // 게이트를 지우면 그룹에서도 빠진다
  assert.deepEqual(repos.permissions.group(all)?.gateKeys, [g3]);
});

test('old org gates and personal gates move into groups once, then the old tables are gone', () => {
  const sql = openDatabase(':memory:');
  const repos = createRepositories(sql);
  const g3 = repos.gates.insertGate({ name: '3층', adapter: mock, floor: 3 }, AT);
  const g7 = repos.gates.insertGate({ name: '7층', adapter: mock, floor: 7 }, AT);
  const dev = repos.orgs.create({ name: '개발팀', kind: 'DEPARTMENT' }, AT);
  const kim = repos.employees.addEmployee({ employeeNo: 'E1', name: '김', department: '개발팀' });
  // 권한 그룹 이전(D-59) 표
  sql.exec(`CREATE TABLE org_gate (org_key INTEGER, gate_key INTEGER);
            CREATE TABLE employee_gate (employee_key INTEGER, gate_key INTEGER);`);
  sql.prepare('INSERT INTO org_gate VALUES (?, ?)').run(dev, g3);
  sql.prepare('INSERT INTO employee_gate VALUES (?, ?)').run(kim, g7);

  assert.equal(repos.permissions.prepare(AT), 2);
  assert.deepEqual(
    repos.permissions.groups().map(({ name, scheduleName, gateKeys, orgKeys, employeeKeys }) => ({
      name,
      scheduleName,
      gateKeys,
      orgKeys,
      employeeKeys,
    })),
    [
      { name: '개발팀', scheduleName: '24시간', gateKeys: [g3], orgKeys: [dev], employeeKeys: [] },
      {
        name: '김(E1) 개인',
        scheduleName: '24시간',
        gateKeys: [g7],
        orgKeys: [],
        employeeKeys: [kim],
      },
    ],
  );
  const tables = (sql as DatabaseSync)
    .prepare("SELECT name FROM sqlite_master WHERE name IN ('org_gate', 'employee_gate')")
    .all();
  assert.deepEqual(tables, []);
  assert.equal(repos.permissions.prepare(AT), 0); // 두 번째 시작은 아무것도 안 함
  assert.equal(repos.permissions.schedules().length, 1);
});
