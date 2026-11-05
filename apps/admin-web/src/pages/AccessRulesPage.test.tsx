import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { mockApi } from '../test/mockApi';
import { AccessRulesPage } from './AccessRulesPage';

const gate = (gateKey: number, name: string, floor: number, openToAll = false) => ({
  gateKey,
  name,
  floor,
  openToAll,
  adapter: { type: 'MOCK' },
  terminals: [],
});
const gates = [gate(1, '로비', 1, true), gate(2, '동측', 3), gate(3, '서측', 3)];
const WORKDAY = { start: '09:00', end: '18:00' };
const schedules = [
  {
    scheduleKey: 1,
    name: '24시간',
    days: Array(8).fill({ start: '00:00', end: '24:00' }),
    groupCount: 0,
  },
];
const base = {
  'GET /api/admin/gates': gates,
  'GET /api/admin/schedules': schedules,
  'GET /api/admin/orgs': [{ orgKey: 5, name: '입주사 A', kind: 'TENANT', employeeCount: 2 }],
  'GET /api/admin/employees': [
    {
      employeeKey: 7,
      employeeNo: 'E7',
      name: '홍길동',
      department: '',
      status: 'ACTIVE',
      faceCount: 1,
    },
  ],
  'GET /api/admin/access-groups': [],
  'GET /api/admin/holidays': [],
};
const page = () =>
  render(
    <MemoryRouter>
      <AccessRulesPage />
    </MemoryRouter>,
  );

describe('AccessRulesPage', () => {
  it('makes a group with a whole floor, an org and a person', async () => {
    let created: unknown;
    mockApi({
      ...base,
      'POST /api/admin/access-groups': (body) => {
        created = body;
        return { status: 201, json: { groupKey: 9, ...(body as object), scheduleName: '24시간' } };
      },
    });
    page();
    await userEvent.click(await screen.findByRole('button', { name: '새 그룹' }));
    const form = within(await screen.findByRole('form', { name: '새 그룹' }));
    await userEvent.type(form.getByLabelText('이름'), '입주사 A 출입');
    // 모든 사람 통과 게이트는 체크된 채 잠겨 있다
    expect(form.getByLabelText(/로비/)).toBeChecked();
    expect(form.getByLabelText(/로비/)).toBeDisabled();
    await userEvent.click(form.getByLabelText('3층 전체'));
    await userEvent.click(form.getByLabelText(/입주사 A/));
    await userEvent.type(form.getByLabelText('직원 더하기'), '홍');
    await userEvent.click(form.getByRole('button', { name: /홍길동 E7/ }));
    expect(form.getByRole('button', { name: '홍길동 빼기' })).toBeInTheDocument();
    await userEvent.click(form.getByRole('button', { name: '저장' }));
    expect(created).toEqual({
      name: '입주사 A 출입',
      scheduleKey: 1,
      gateKeys: [2, 3],
      orgKeys: [5],
      employeeKeys: [7],
    });
  });

  it('makes a weekday schedule and refuses to delete one in use', async () => {
    let created: unknown;
    mockApi({
      ...base,
      'GET /api/admin/schedules': [{ ...schedules[0], groupCount: 2 }],
      'POST /api/admin/schedules': (body) => {
        created = body;
        return { status: 201, json: { scheduleKey: 2, groupCount: 0, ...(body as object) } };
      },
      'DELETE /api/admin/schedules/1': () => ({
        status: 409,
        json: { error: 'schedule is used by groups' },
      }),
    });
    page();
    await userEvent.click(await screen.findByRole('tab', { name: '시간표' }));
    await userEvent.click(await screen.findByRole('button', { name: '새 시간표' }));
    const form = within(await screen.findByRole('form', { name: '새 시간표' }));
    await userEvent.type(form.getByLabelText('이름'), '근무시간');
    // 토요일도 오전만
    await userEvent.click(form.getByRole('row', { name: /토/ }).querySelector('input')!);
    const end = form.getByLabelText('토 끝');
    await userEvent.clear(end);
    await userEvent.type(end, '13:00');
    await userEvent.click(form.getByRole('button', { name: '저장' }));
    expect(created).toEqual({
      name: '근무시간',
      days: [
        null,
        WORKDAY,
        WORKDAY,
        WORKDAY,
        WORKDAY,
        WORKDAY,
        { start: '09:00', end: '13:00' },
        null,
      ],
    });

    await userEvent.click(screen.getByRole('button', { name: /24시간/ }));
    window.confirm = () => true;
    await userEvent.click(await screen.findByRole('button', { name: '시간표 삭제' }));
    expect(
      await screen.findByText('이 시간표를 쓰는 그룹이 있어 지울 수 없습니다.'),
    ).toBeInTheDocument();
  });

  it('adds and removes holidays', async () => {
    const calls = mockApi({
      ...base,
      'POST /api/admin/holidays': { status: 201, json: [] },
      'GET /api/admin/holidays': [{ date: '2027-02-08', name: '설날' }],
      'DELETE /api/admin/holidays/2027-02-08': [],
    });
    page();
    await userEvent.click(await screen.findByRole('tab', { name: '휴일' }));
    const add = within(await screen.findByRole('form', { name: '휴일 추가' }));
    await userEvent.type(add.getByLabelText('날짜'), '2027-09-14');
    await userEvent.type(add.getByLabelText('이름'), '추석');
    await userEvent.click(add.getByRole('button', { name: '추가' }));
    await userEvent.click(await screen.findByRole('button', { name: '2027-02-08 설날 지우기' }));
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([
      { method: 'POST', path: '/api/admin/holidays', body: { date: '2027-09-14', name: '추석' } },
      { method: 'DELETE', path: '/api/admin/holidays/2027-02-08', body: undefined },
    ]);
  });

  it('adds an org on the org tab', async () => {
    let created: unknown;
    mockApi({
      ...base,
      'GET /api/admin/orgs': [],
      'POST /api/admin/orgs': (body) => {
        created = body;
        return {
          status: 201,
          json: { orgKey: 6, name: '개발팀', kind: 'DEPARTMENT', employeeCount: 0 },
        };
      },
    });
    page();
    await userEvent.click(await screen.findByRole('tab', { name: '소속' }));
    const add = within(await screen.findByRole('form', { name: '소속 추가' }));
    await userEvent.type(add.getByLabelText('이름'), '개발팀');
    await userEvent.click(add.getByRole('button', { name: '추가' }));
    expect(created).toEqual({ name: '개발팀', kind: 'DEPARTMENT' });
  });
});
