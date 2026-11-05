import type { DatabaseSync } from 'node:sqlite';
import { ALL_DAY, isOpen, type WeekDays } from './schedule.ts';

/** 권한 그룹, 시간표, 휴일 (D-61). 소속별 게이트와 개인 추가 게이트를 대체 */
export type ScheduleView = {
  scheduleKey: number;
  name: string;
  days: WeekDays;
  groupCount: number;
};
export type GroupInput = {
  name: string;
  scheduleKey: number;
  gateKeys: number[];
  orgKeys: number[];
  employeeKeys: number[];
};
export type GroupView = GroupInput & { groupKey: number; scheduleName: string };
export type Holiday = { date: string; name: string };
/** ALLOWED 통과, NO_GATE 이 게이트 권한 없음, OFF_HOURS 권한은 있지만 시간 밖 */
export type GateCheck = 'ALLOWED' | 'NO_GATE' | 'OFF_HOURS';
export type PermissionRepository = ReturnType<typeof createPermissionRepository>;

export function createPermissionRepository(sql: DatabaseSync) {
  const tx = <T>(job: () => T): T => {
    sql.exec('BEGIN');
    try {
      const result = job();
      sql.exec('COMMIT');
      return result;
    } catch (error) {
      sql.exec('ROLLBACK');
      throw error;
    }
  };
  const keys = (query: string, ...args: (number | string)[]) =>
    (sql.prepare(query).all(...args) as { k: number }[]).map((r) => r.k);
  const unique = (list: number[]) => [...new Set(list)].sort((a, b) => a - b);

  function writeMembers(groupKey: number, g: GroupInput): void {
    for (const [table, column, list] of [
      ['access_group_gate', 'gate_key', g.gateKeys],
      ['access_group_org', 'org_key', g.orgKeys],
      ['access_group_employee', 'employee_key', g.employeeKeys],
    ] as const) {
      sql.prepare(`DELETE FROM ${table} WHERE group_key = ?`).run(groupKey);
      const add = sql.prepare(`INSERT INTO ${table} (group_key, ${column}) VALUES (?, ?)`);
      for (const key of unique(list)) add.run(groupKey, key);
    }
  }

  const repo = {
    // ---- 시간표 ----
    /** 번호를 주면 그 시간표만 */
    schedules(scheduleKey: number | null = null): ScheduleView[] {
      const rows = sql
        .prepare(
          `SELECT s.schedule_key AS scheduleKey, s.name, s.days,
             (SELECT COUNT(*) FROM access_group g WHERE g.schedule_key = s.schedule_key) AS groupCount
           FROM schedule s WHERE ?1 IS NULL OR s.schedule_key = ?1 ORDER BY s.schedule_key`,
        )
        .all(scheduleKey) as (Omit<ScheduleView, 'days'> & { days: string })[];
      return rows.map((r) => ({ ...r, days: JSON.parse(r.days) as WeekDays }));
    },

    schedule(scheduleKey: number): ScheduleView | undefined {
      return repo.schedules(scheduleKey)[0];
    },

    scheduleNameTaken(name: string, except?: number): boolean {
      return (
        sql
          .prepare('SELECT 1 FROM schedule WHERE name = ? AND schedule_key IS NOT ?')
          .get(name, except ?? null) !== undefined
      );
    },

    createSchedule(name: string, days: WeekDays, at: string): number {
      return Number(
        sql
          .prepare('INSERT INTO schedule (name, days, created_at) VALUES (?, ?, ?)')
          .run(name, JSON.stringify(days), at).lastInsertRowid,
      );
    },

    updateSchedule(scheduleKey: number, s: { name?: string; days?: WeekDays }): boolean {
      return (
        sql
          .prepare(
            'UPDATE schedule SET name = COALESCE(?, name), days = COALESCE(?, days) WHERE schedule_key = ?',
          )
          .run(s.name ?? null, s.days ? JSON.stringify(s.days) : null, scheduleKey).changes > 0
      );
    },

    /** 그룹이 쓰거나 마지막 하나면 지우지 않는다 (새 그룹이 고를 시간표가 있어야 함) */
    removeSchedule(scheduleKey: number): 'OK' | 'NOT_FOUND' | 'IN_USE' | 'LAST' {
      const s = repo.schedule(scheduleKey);
      if (!s) return 'NOT_FOUND';
      if (s.groupCount > 0) return 'IN_USE';
      if (repo.schedules().length === 1) return 'LAST';
      sql.prepare('DELETE FROM schedule WHERE schedule_key = ?').run(scheduleKey);
      return 'OK';
    },

    // ---- 휴일 ----
    holidays(): Holiday[] {
      return sql.prepare('SELECT date, name FROM holiday ORDER BY date').all() as Holiday[];
    },

    /** 같은 날짜면 이름만 바꾼다 */
    addHoliday(h: Holiday): void {
      sql
        .prepare(
          'INSERT INTO holiday (date, name) VALUES (?, ?) ON CONFLICT (date) DO UPDATE SET name = excluded.name',
        )
        .run(h.date, h.name);
    },

    removeHoliday(date: string): boolean {
      return sql.prepare('DELETE FROM holiday WHERE date = ?').run(date).changes > 0;
    },

    // ---- 권한 그룹 ----
    /** 번호를 주면 그 그룹만 */
    groups(groupKey: number | null = null): GroupView[] {
      const rows = sql
        .prepare(
          `SELECT g.group_key AS groupKey, g.name, g.schedule_key AS scheduleKey, s.name AS scheduleName
           FROM access_group g JOIN schedule s ON s.schedule_key = g.schedule_key
           WHERE ?1 IS NULL OR g.group_key = ?1 ORDER BY g.name`,
        )
        .all(groupKey) as Omit<GroupView, 'gateKeys' | 'orgKeys' | 'employeeKeys'>[];
      return rows.map((g) => ({
        ...g,
        gateKeys: keys(
          'SELECT gate_key AS k FROM access_group_gate WHERE group_key = ? ORDER BY k',
          g.groupKey,
        ),
        orgKeys: keys(
          'SELECT org_key AS k FROM access_group_org WHERE group_key = ? ORDER BY k',
          g.groupKey,
        ),
        employeeKeys: keys(
          'SELECT employee_key AS k FROM access_group_employee WHERE group_key = ? ORDER BY k',
          g.groupKey,
        ),
      }));
    },

    group(groupKey: number): GroupView | undefined {
      return repo.groups(groupKey)[0];
    },

    groupNameTaken(name: string, except?: number): boolean {
      return (
        sql
          .prepare('SELECT 1 FROM access_group WHERE name = ? AND group_key IS NOT ?')
          .get(name, except ?? null) !== undefined
      );
    },

    createGroup(g: GroupInput, at: string): number {
      return tx(() => repo.createGroupRaw(g, at));
    },

    updateGroup(groupKey: number, g: GroupInput): boolean {
      return tx(() => {
        const changed = sql
          .prepare('UPDATE access_group SET name = ?, schedule_key = ? WHERE group_key = ?')
          .run(g.name, g.scheduleKey, groupKey).changes;
        if (changed) writeMembers(groupKey, g);
        return changed > 0;
      });
    },

    removeGroup(groupKey: number): boolean {
      return sql.prepare('DELETE FROM access_group WHERE group_key = ?').run(groupKey).changes > 0;
    },

    // ---- 직원별 ----
    /** 직접 넣은 그룹과 소속으로 받는 그룹, 통과할 수 있는 게이트(시간표는 따지지 않음) */
    employeeAccess(employee: { employeeKey: number; department: string }) {
      const groupKeys = keys(
        'SELECT group_key AS k FROM access_group_employee WHERE employee_key = ? ORDER BY k',
        employee.employeeKey,
      );
      const orgGroupKeys = keys(
        `SELECT ag.group_key AS k FROM access_group_org ag JOIN org o ON o.org_key = ag.org_key
         WHERE o.name = ? AND ? <> '' ORDER BY k`,
        employee.department,
        employee.department,
      );
      const all = unique([...groupKeys, ...orgGroupKeys]);
      const gateKeys = all.length
        ? keys(
            `SELECT DISTINCT gate_key AS k FROM access_group_gate WHERE group_key IN (${all.map(() => '?').join(',')}) ORDER BY k`,
            ...all,
          )
        : [];
      return { groupKeys, orgGroupKeys, gateKeys };
    },

    setEmployeeGroups(employeeKey: number, groupKeys: number[]): void {
      tx(() => {
        sql.prepare('DELETE FROM access_group_employee WHERE employee_key = ?').run(employeeKey);
        const add = sql.prepare(
          'INSERT INTO access_group_employee (group_key, employee_key) VALUES (?, ?)',
        );
        for (const groupKey of unique(groupKeys)) add.run(groupKey, employeeKey);
      });
    },

    /** 판정 때마다 DB에서 읽는다 (게이트 15대, 직원 수백 명이라 캐시 없이 충분) */
    check(
      employee: { employeeKey: number; department: string },
      gate: { gateKey: number; openToAll: boolean },
      at: Date,
    ): GateCheck {
      if (gate.openToAll) return 'ALLOWED';
      const rows = sql
        .prepare(
          `SELECT DISTINCT s.days FROM access_group g
           JOIN access_group_gate gg ON gg.group_key = g.group_key AND gg.gate_key = ?1
           JOIN schedule s ON s.schedule_key = g.schedule_key
           WHERE g.group_key IN (
             SELECT group_key FROM access_group_employee WHERE employee_key = ?2
             UNION SELECT ag.group_key FROM access_group_org ag JOIN org o ON o.org_key = ag.org_key
                   WHERE o.name = ?3 AND ?3 <> '')`,
        )
        .all(gate.gateKey, employee.employeeKey, employee.department) as { days: string }[];
      if (rows.length === 0) return 'NO_GATE';
      const holiday = sql.prepare('SELECT 1 FROM holiday WHERE date = ?');
      const isHoliday = (date: string) => holiday.get(date) !== undefined;
      return rows.some((r) => isOpen(JSON.parse(r.days) as WeekDays, at, isHoliday))
        ? 'ALLOWED'
        : 'OFF_HOURS';
    },

    /**
     * 서버를 켤 때: 시간표가 없으면 "24시간"을 만들고, 예전 소속별 게이트와 개인 추가 게이트(D-59)가
     * 남아 있으면 그룹으로 옮긴 뒤 예전 표를 지운다. 만든 그룹 수
     */
    prepare(at: string): number {
      return tx(() => {
        if (repo.schedules().length === 0) repo.createSchedule('24시간', ALL_DAY, at);
        const fullDay = repo.schedules()[0].scheduleKey;
        const has = (table: string) =>
          sql
            .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
            .get(table) !== undefined;
        let made = 0;
        const name = (base: string) => {
          let candidate = base;
          for (let n = 2; repo.groupNameTaken(candidate); n++) candidate = `${base} ${n}`;
          return candidate;
        };
        if (has('org_gate')) {
          const orgs = sql
            .prepare(
              'SELECT DISTINCT o.org_key AS orgKey, o.name FROM org_gate og JOIN org o ON o.org_key = og.org_key',
            )
            .all() as { orgKey: number; name: string }[];
          for (const o of orgs) {
            const gateKeys = keys('SELECT gate_key AS k FROM org_gate WHERE org_key = ?', o.orgKey);
            repo.createGroupRaw(
              {
                name: name(o.name),
                scheduleKey: fullDay,
                gateKeys,
                orgKeys: [o.orgKey],
                employeeKeys: [],
              },
              at,
            );
            made++;
          }
          sql.exec('DROP TABLE org_gate');
        }
        if (has('employee_gate')) {
          const people = sql
            .prepare(
              `SELECT DISTINCT e.employee_key AS employeeKey, e.name, e.employee_no AS employeeNo
               FROM employee_gate eg JOIN employee e ON e.employee_key = eg.employee_key`,
            )
            .all() as { employeeKey: number; name: string; employeeNo: string }[];
          for (const p of people) {
            const gateKeys = keys(
              'SELECT gate_key AS k FROM employee_gate WHERE employee_key = ?',
              p.employeeKey,
            );
            repo.createGroupRaw(
              {
                name: name(`${p.name}(${p.employeeNo}) 개인`),
                scheduleKey: fullDay,
                gateKeys,
                orgKeys: [],
                employeeKeys: [p.employeeKey],
              },
              at,
            );
            made++;
          }
          sql.exec('DROP TABLE employee_gate');
        }
        return made;
      });
    },

    /** prepare 안에서 쓰는 트랜잭션 없는 그룹 만들기 */
    createGroupRaw(g: GroupInput, at: string): number {
      const groupKey = Number(
        sql
          .prepare('INSERT INTO access_group (name, schedule_key, created_at) VALUES (?, ?, ?)')
          .run(g.name, g.scheduleKey, at).lastInsertRowid,
      );
      writeMembers(groupKey, g);
      return groupKey;
    },
  };
  return repo;
}
