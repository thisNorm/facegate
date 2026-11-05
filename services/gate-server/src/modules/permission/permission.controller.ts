import { Router } from 'express';
import type { AuditService } from '../audit/audit.service.ts';
import { adminOf, keyOf, nameOf } from '../../shared/route.ts';
import { kst } from '../../shared/time.ts';
import type { GroupInput, PermissionRepository } from './permission.repository.ts';
import { parseDays } from './schedule.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** 달력에 있는 날짜인지. Date.parse는 2월 30일을 3월 2일로 넘겨 받으므로 되돌려 같은지 본다 */
const realDate = (text: string) => {
  const at = new Date(`${text}T00:00:00Z`);
  return DATE.test(text) && !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === text;
};

/** 권한 그룹, 시간표, 휴일 관리 (D-61) */
export function createPermissionRouter({
  permissions,
  audit,
  now,
  exists,
  employeeOf,
}: {
  permissions: PermissionRepository;
  audit: AuditService;
  now: () => Date;
  /** 번호 목록이 모두 있는 게이트, 소속, 직원인지 */
  exists: Record<'gates' | 'orgs' | 'employees', (keys: number[]) => boolean>;
  employeeOf: (employeeKey: number) => { employeeKey: number; department: string } | undefined;
}): Router {
  const router = Router();
  const list = (value: unknown, valid: (keys: number[]) => boolean): number[] | null =>
    Array.isArray(value) && value.every((k) => Number.isSafeInteger(k)) && valid(value as number[])
      ? [...new Set(value as number[])].sort((a, b) => a - b)
      : null;

  function groupInput(body: unknown): GroupInput | null {
    const b = (body ?? {}) as Record<string, unknown>;
    const name = nameOf(b.name);
    const scheduleKey = b.scheduleKey;
    const gateKeys = list(b.gateKeys ?? [], exists.gates);
    const orgKeys = list(b.orgKeys ?? [], exists.orgs);
    const employeeKeys = list(b.employeeKeys ?? [], exists.employees);
    if (!name || !Number.isSafeInteger(scheduleKey) || !permissions.schedule(scheduleKey as number))
      return null;
    if (!gateKeys || !orgKeys || !employeeKeys) return null;
    return { name, scheduleKey: scheduleKey as number, gateKeys, orgKeys, employeeKeys };
  }
  const GROUP_ERROR =
    'name(1-40), an existing scheduleKey and existing gateKeys, orgKeys, employeeKeys required';

  // ---- 권한 그룹 ----
  router.get('/access-groups', (_req, res) => {
    res.json(permissions.groups());
  });

  router.post('/access-groups', (req, res) => {
    const g = groupInput(req.body);
    if (!g) {
      res.status(400).json({ error: GROUP_ERROR });
      return;
    }
    if (permissions.groupNameTaken(g.name)) {
      res.status(409).json({ error: 'group name already exists' });
      return;
    }
    const groupKey = permissions.createGroup(g, kst(now()));
    audit.record(adminOf(res), 'ACCESS_GROUP_CREATE', `group:${groupKey}`, { ...g });
    res.status(201).json(permissions.group(groupKey));
  });

  router.patch('/access-groups/:groupKey', (req, res) => {
    const groupKey = keyOf(req.params.groupKey);
    if (groupKey === null || !permissions.group(groupKey)) {
      res.sendStatus(404);
      return;
    }
    const g = groupInput(req.body);
    if (!g) {
      res.status(400).json({ error: GROUP_ERROR });
      return;
    }
    if (permissions.groupNameTaken(g.name, groupKey)) {
      res.status(409).json({ error: 'group name already exists' });
      return;
    }
    permissions.updateGroup(groupKey, g);
    audit.record(adminOf(res), 'ACCESS_GROUP_UPDATE', `group:${groupKey}`, { ...g });
    res.json(permissions.group(groupKey));
  });

  router.delete('/access-groups/:groupKey', (req, res) => {
    const groupKey = keyOf(req.params.groupKey);
    const group = groupKey === null ? undefined : permissions.group(groupKey);
    if (!group) {
      res.sendStatus(404);
      return;
    }
    permissions.removeGroup(group.groupKey);
    audit.record(adminOf(res), 'ACCESS_GROUP_DELETE', `group:${group.groupKey}`, {
      name: group.name,
    });
    res.json({ ok: true });
  });

  // ---- 시간표 ----
  router.get('/schedules', (_req, res) => {
    res.json(permissions.schedules());
  });

  router.post('/schedules', (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const name = nameOf(b.name);
    const days = parseDays(b.days);
    if (!name || !days) {
      res
        .status(400)
        .json({ error: 'name(1-40) and 8 days (Sun..Sat, holiday) of {start,end} or null' });
      return;
    }
    if (permissions.scheduleNameTaken(name)) {
      res.status(409).json({ error: 'schedule name already exists' });
      return;
    }
    const scheduleKey = permissions.createSchedule(name, days, kst(now()));
    audit.record(adminOf(res), 'SCHEDULE_CREATE', `schedule:${scheduleKey}`, { name, days });
    res.status(201).json(permissions.schedule(scheduleKey));
  });

  router.patch('/schedules/:scheduleKey', (req, res) => {
    const scheduleKey = keyOf(req.params.scheduleKey);
    if (scheduleKey === null || !permissions.schedule(scheduleKey)) {
      res.sendStatus(404);
      return;
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const name = b.name === undefined ? undefined : nameOf(b.name);
    const days = b.days === undefined ? undefined : parseDays(b.days);
    if (name === null || days === null || (name === undefined && days === undefined)) {
      res.status(400).json({ error: 'send name(1-40) or 8 days' });
      return;
    }
    if (name && permissions.scheduleNameTaken(name, scheduleKey)) {
      res.status(409).json({ error: 'schedule name already exists' });
      return;
    }
    permissions.updateSchedule(scheduleKey, { name, days });
    audit.record(adminOf(res), 'SCHEDULE_UPDATE', `schedule:${scheduleKey}`, { name, days });
    res.json(permissions.schedule(scheduleKey));
  });

  router.delete('/schedules/:scheduleKey', (req, res) => {
    const scheduleKey = keyOf(req.params.scheduleKey);
    const schedule = scheduleKey === null ? undefined : permissions.schedule(scheduleKey);
    const result = schedule ? permissions.removeSchedule(schedule.scheduleKey) : 'NOT_FOUND';
    if (result === 'NOT_FOUND') res.sendStatus(404);
    else if (result === 'IN_USE') res.status(409).json({ error: 'schedule is used by groups' });
    else if (result === 'LAST') res.status(409).json({ error: 'keep at least one schedule' });
    else {
      audit.record(adminOf(res), 'SCHEDULE_DELETE', `schedule:${scheduleKey}`, {
        name: schedule!.name,
      });
      res.json({ ok: true });
    }
  });

  // ---- 휴일 ----
  router.get('/holidays', (_req, res) => {
    res.json(permissions.holidays());
  });

  router.post('/holidays', (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const name = nameOf(b.name);
    const date = typeof b.date === 'string' && realDate(b.date) ? b.date : null;
    if (!name || !date) {
      res.status(400).json({ error: 'date YYYY-MM-DD and name(1-40) required' });
      return;
    }
    permissions.addHoliday({ date, name });
    audit.record(adminOf(res), 'HOLIDAY_ADD', null, { date, name });
    res.status(201).json(permissions.holidays());
  });

  router.delete('/holidays/:date', (req, res) => {
    if (!permissions.removeHoliday(req.params.date)) {
      res.sendStatus(404);
      return;
    }
    audit.record(adminOf(res), 'HOLIDAY_DELETE', null, { date: req.params.date });
    res.json(permissions.holidays());
  });

  // ---- 직원별: 직접 넣은 그룹 ----
  router.get('/employees/:employeeKey/access-groups', (req, res) => {
    const employeeKey = keyOf(req.params.employeeKey);
    const employee = employeeKey === null ? undefined : employeeOf(employeeKey);
    if (!employee) {
      res.sendStatus(404);
      return;
    }
    res.json(permissions.employeeAccess(employee));
  });

  router.put('/employees/:employeeKey/access-groups', (req, res) => {
    const employeeKey = keyOf(req.params.employeeKey);
    const employee = employeeKey === null ? undefined : employeeOf(employeeKey);
    if (!employee) {
      res.sendStatus(404);
      return;
    }
    const groupKeys = list((req.body as { groupKeys?: unknown } | undefined)?.groupKeys, (keys) =>
      keys.every((k) => permissions.group(k) !== undefined),
    );
    if (!groupKeys) {
      res.status(400).json({ error: 'groupKeys must be existing group numbers' });
      return;
    }
    permissions.setEmployeeGroups(employee.employeeKey, groupKeys);
    audit.record(adminOf(res), 'ACCESS_RULE_UPDATE', `employee:${employee.employeeKey}`, {
      groupKeys,
    });
    res.json(permissions.employeeAccess(employee));
  });

  return router;
}
