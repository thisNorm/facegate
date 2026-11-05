import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { mockApi } from '../test/mockApi';
import { AuditLogsPage } from './AuditLogsPage';

const log = (fields: Record<string, unknown>) => ({
  auditKey: 1,
  adminName: '테스트 관리자',
  action: 'LOGIN',
  target: null,
  targetName: null,
  via: 'WEB',
  viaName: null,
  detail: null,
  createdAt: '2026-11-03 09:04:05',
  ...fields,
});
const page = (items: unknown[], total = items.length) => ({ items, total });
const cells = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent);
const show = () =>
  render(
    <MemoryRouter>
      <AuditLogsPage />
    </MemoryRouter>,
  );

describe('AuditLogsPage', () => {
  it('shows loading instead of a false empty result until the first page arrives', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const calls = mockApi({
      'GET /api/admin/audit-logs': async () => {
        await pending;
        return { json: page([log({ target: 'admin:1', targetName: '김관리' })]) };
      },
    });
    show();

    expect(screen.getByText('작업 이력을 불러오는 중입니다.')).toBeInTheDocument();
    expect(screen.queryByText('작업 이력이 없습니다.')).not.toBeInTheDocument();
    expect(calls.filter((call) => call.path.startsWith('/api/admin/audit-logs'))).toEqual([
      { method: 'GET', path: '/api/admin/audit-logs?limit=30&offset=0', body: undefined },
    ]);

    await act(async () => {
      finish();
    });
    const row = await screen.findByRole('row', { name: /테스트 관리자/ });
    expect(cells(row)).toEqual([
      '11/03 09:04:05',
      '테스트 관리자',
      '관리자 웹',
      '로그인',
      '김관리',
      '',
    ]);
    expect(screen.getByText('모두 1건')).toBeInTheDocument();
  });

  it('shows an error paragraph and retries', async () => {
    let attempts = 0;
    mockApi({
      'GET /api/admin/audit-logs': () => {
        attempts += 1;
        if (attempts === 1) return { status: 503, json: { error: 'temporary outage' } };
        return { json: page([log({ adminName: '재시도 관리자', action: 'LOGOUT' })]) };
      },
    });
    show();

    const error = await screen.findByRole('alert');
    expect(error.tagName).toBe('P');
    expect(error).toHaveTextContent('작업 이력을 불러오지 못했습니다. (temporary outage)');
    expect(screen.queryByText('작업 이력이 없습니다.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('row', { name: /재시도 관리자/ })).toHaveTextContent('로그아웃');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the table headers for an empty result and shows no pager', async () => {
    mockApi({ 'GET /api/admin/audit-logs': page([]) });
    show();

    expect(await screen.findByText('작업 이력이 없습니다.')).toBeInTheDocument();
    const table = within(screen.getByRole('region', { name: '작업 이력 목록' })).getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['시각', '관리자', '어디서', '작업', '대상', '내용']);
    expect(within(table).getAllByRole('row')).toHaveLength(1);
    expect(screen.queryByRole('navigation', { name: '쪽 이동' })).not.toBeInTheDocument();
  });

  it('escapes log fields and leaves unknown ones blank', async () => {
    mockApi({
      'GET /api/admin/audit-logs': page([
        log({
          auditKey: 2,
          adminName: '<img src=x onerror="fake()">',
          action: 'FUTURE_<em>audit</em>',
          target: '<a href="/fake">target</a>',
          detail: { '<script>fake()</script>': '<b>value</b>' },
        }),
        log({ adminName: null, action: 'PHOTO_PURGE', via: null }),
      ]),
    });
    show();

    const row = await screen.findByRole('row', { name: /FUTURE_/ });
    expect(cells(row)).toEqual([
      '11/03 09:04:05',
      '<img src=x onerror="fake()">',
      '관리자 웹',
      'FUTURE_<em>audit</em>',
      '<a href="/fake">target</a>',
      '',
    ]);
    expect(row.querySelector('img, em, a, script, b')).toBeNull();
    expect(document.body.textContent).not.toMatch(/·/);
  });

  it('names people and terminals instead of numbers and lists what changed', async () => {
    mockApi({
      'GET /api/admin/gates': [{ gateKey: 1, name: '정문' }],
      'GET /api/admin/audit-logs': page([
        log({
          auditKey: 5,
          adminName: null,
          action: 'SETTINGS_UPDATE',
          via: 'TERMINAL:101',
          viaName: '1번 단말 (정문)',
          detail: { 'terminalLight.denied': ['RED', 'YELLOW'] },
        }),
        log({
          auditKey: 4,
          action: 'SETTINGS_UPDATE',
          detail: {
            photoRetentionDays: [90, 30],
            'terminalVoice.unregistered': ['', '등록되지 않은 사용자입니다'],
            terminalAdminPin: 'changed',
          },
        }),
        log({
          auditKey: 3,
          action: 'EMPLOYEE_UPDATE',
          target: 'employee:7',
          targetName: '홍길동',
          detail: { department: '개발팀' },
        }),
        log({
          auditKey: 2,
          action: 'ACCESS_RULE_UPDATE',
          target: 'org:3',
          targetName: '개발팀',
          detail: { gateKeys: [1, 9] },
        }),
        log({ auditKey: 1, action: 'GATE_DELETE', target: 'gate:9' }),
      ]),
    });
    show();

    await screen.findByRole('row', { name: /홍길동/ });
    const rows = screen.getAllByRole('row').slice(1);
    expect(cells(rows[0])).toEqual([
      '11/03 09:04:05',
      '관리자 번호',
      '1번 단말 (정문)',
      '설정 변경',
      '',
      '불통 불빛 빨강 → 노랑',
    ]);
    expect(within(rows[1]).getAllByRole('cell')[5].textContent).toBe(
      '출입 사진 보존 기간 90일 → 30일' +
        '미등록 음성 말 안 함 → "등록되지 않은 사용자입니다"' +
        '단말 관리자 번호 바꿈',
    );
    expect(cells(rows[2]).slice(4)).toEqual(['홍길동', '소속 개발팀']);
    expect(await within(rows[3]).findByText('정문, 게이트 9')).toBeInTheDocument();
    expect(cells(rows[4])[4]).toBe('게이트 9');
  });

  it('moves between pages', async () => {
    const calls = mockApi({
      'GET /api/admin/audit-logs': (_body, url) => ({
        json: page([log({ adminName: `쪽 ${url.searchParams.get('offset')}` })], 65),
      }),
    });
    show();

    expect(await screen.findByText('1 / 3쪽')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '이전' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByRole('row', { name: /쪽 30/ })).toBeInTheDocument();
    expect(screen.getByText('2 / 3쪽')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(await screen.findByText('3 / 3쪽')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다음' })).toBeDisabled();
    expect(calls.map((c) => c.path).filter((p) => p.startsWith('/api/admin/audit-logs'))).toEqual([
      '/api/admin/audit-logs?limit=30&offset=0',
      '/api/admin/audit-logs?limit=30&offset=30',
      '/api/admin/audit-logs?limit=30&offset=60',
    ]);
  });
});
