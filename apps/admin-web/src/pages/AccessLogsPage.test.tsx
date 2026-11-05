import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { mockApi } from '../test/mockApi';
import { AccessLogsPage } from './AccessLogsPage';

const item = (eventKey: number, extra = {}) => ({
  eventKey,
  gateKey: 1,
  method: 'FACE',
  result: 'GRANTED',
  receivedAt: '2026-11-03 09:00:00.000',
  employeeNo: 'E1',
  employeeName: '홍길동',
  visitorName: null,
  remoteReason: null,
  hasFullImage: true,
  hasCropImage: true,
  ...extra,
});

const page = () =>
  render(
    <MemoryRouter>
      <AccessLogsPage />
    </MemoryRouter>,
  );

type Reply = {
  status?: number;
  json: { items: ReturnType<typeof item>[]; nextBeforeEventKey: number | null } | { error: string };
};
const deferred = () => {
  let resolve!: (reply: Reply) => void;
  const promise = new Promise<Reply>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('AccessLogsPage', () => {
  it('lists logs with gate names, labels and thumbnails', async () => {
    mockApi({
      'GET /api/admin/gates': [{ gateKey: 1, name: '정문 1' }],
      'GET /api/admin/access-logs': {
        items: [item(2, { result: 'UNREGISTERED', employeeName: null, employeeNo: null }), item(1)],
        nextBeforeEventKey: null,
      },
    });
    page();
    const row = await screen.findByRole('row', { name: /홍길동/ });
    expect(within(row).getByText('정문 1')).toBeInTheDocument();
    expect(within(row).getByRole('img', { name: '출입 사진 1' })).toHaveAttribute(
      'src',
      '/api/admin/access-logs/1/images/crop',
    );
    expect(screen.getByText('미등록', { selector: 'td.problem' })).toBeInTheDocument();
  });

  it('applies filters as they change, including the result, and a CSV link with the same filter', async () => {
    const calls = mockApi({
      'GET /api/admin/gates': [{ gateKey: 1, name: '정문 1' }],
      'GET /api/admin/access-logs': { items: [], nextBeforeEventKey: null },
    });
    page();
    await screen.findByText('조건에 맞는 기록이 없습니다.');
    fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-11-01' } }); // jsdom은 날짜 칸 타이핑을 못 받음
    await userEvent.selectOptions(screen.getByLabelText('게이트'), '1');
    const last = calls.filter((c) => c.path.startsWith('/api/admin/access-logs?')).at(-1)!.path;
    expect(last).toContain('from=2026-11-01');
    expect(last).toContain('gateKey=1');
    expect(screen.getByRole('link', { name: 'CSV 내려받기' }).getAttribute('href')).toContain(
      '/api/admin/access-logs.csv?',
    );
    expect(screen.getByRole('link', { name: 'CSV 내려받기' }).getAttribute('href')).toContain(
      'gateKey=1',
    );
    await userEvent.selectOptions(screen.getByLabelText('결과'), 'UNREGISTERED');
    expect(
      calls.filter((c) => c.path.startsWith('/api/admin/access-logs?')).at(-1)!.path,
    ).toContain('result=UNREGISTERED');
  });

  it('loads more with beforeEventKey', async () => {
    const calls = mockApi({
      'GET /api/admin/gates': [],
      'GET /api/admin/access-logs': (_b, url) =>
        url.searchParams.get('beforeEventKey')
          ? { json: { items: [item(1)], nextBeforeEventKey: null } }
          : { json: { items: [item(3, { employeeName: '김철수' })], nextBeforeEventKey: 3 } },
    });
    page();
    await screen.findByText('김철수');
    await userEvent.click(screen.getByRole('button', { name: '더 보기' }));
    expect(await screen.findByText('홍길동')).toBeInTheDocument();
    expect(screen.getByText('김철수')).toBeInTheDocument();
    expect(calls.at(-1)?.path).toContain('beforeEventKey=3');
    expect(screen.queryByRole('button', { name: '더 보기' })).not.toBeInTheDocument();
  });

  it('applies every filter as it changes and uses the same filter for CSV', async () => {
    mockApi({
      'GET /api/admin/gates': [{ gateKey: 1, name: '정문 1' }],
      'GET /api/admin/access-logs': (_body, url) => ({
        json: {
          items: url.searchParams.get('q')
            ? [item(1, { method: 'REMOTE', result: 'GATE_ERROR' })]
            : [],
          nextBeforeEventKey: null,
        },
      }),
    });
    page();
    await screen.findByText('조건에 맞는 기록이 없습니다.');
    fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-11-30' } });
    await userEvent.selectOptions(screen.getByLabelText('게이트'), '1');
    await userEvent.selectOptions(screen.getByLabelText('결과'), 'GATE_ERROR');
    await userEvent.selectOptions(screen.getByLabelText('인증 수단'), 'REMOTE');
    await userEvent.type(screen.getByLabelText('이름'), '  홍길동  ');
    await screen.findByRole('row', { name: /홍길동/ });
    const href = screen.getByRole('link', { name: 'CSV 내려받기' }).getAttribute('href')!;
    const query = new URL(href, 'http://localhost').searchParams;
    expect(Object.fromEntries(query)).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
      gateKey: '1',
      result: 'GATE_ERROR',
      method: 'REMOTE',
      q: '홍길동',
    });
  });

  it('shows loading before empty and retries a failed initial request', async () => {
    const pending = deferred();
    let attempts = 0;
    mockApi({
      'GET /api/admin/gates': [],
      'GET /api/admin/access-logs': () =>
        ++attempts === 1
          ? pending.promise
          : { json: { items: [item(1)], nextBeforeEventKey: null } },
    });
    page();
    expect(screen.getByRole('status')).toHaveTextContent('기록을 불러오는 중입니다.');
    expect(screen.queryByText('조건에 맞는 기록이 없습니다.')).not.toBeInTheDocument();
    await act(async () => pending.resolve({ status: 503, json: { error: 'unavailable' } }));
    expect(await screen.findByRole('alert')).toHaveTextContent('기록을 불러오지 못했습니다.');
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('row', { name: /홍길동/ })).toBeInTheDocument();
  });

  it('prevents duplicate page requests while keeping the current rows', async () => {
    const pending = deferred();
    const calls = mockApi({
      'GET /api/admin/gates': [],
      'GET /api/admin/access-logs': (_body, url) =>
        url.searchParams.has('beforeEventKey')
          ? pending.promise
          : { json: { items: [item(3, { employeeName: '김철수' })], nextBeforeEventKey: 3 } },
    });
    page();
    await screen.findByText('김철수');
    const more = screen.getByRole('button', { name: '더 보기' });
    fireEvent.click(more);
    fireEvent.click(more);
    expect(more).toBeDisabled();
    expect(calls.filter((call) => call.path.includes('beforeEventKey='))).toHaveLength(1);
    expect(screen.getByText('김철수')).toBeInTheDocument();
    await act(async () =>
      pending.resolve({ json: { items: [item(1)], nextBeforeEventKey: null } }),
    );
    expect(await screen.findByText('홍길동')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '더 보기' })).not.toBeInTheDocument();
  });

  it('does not replace a newer search with an older response', async () => {
    const pending = deferred();
    mockApi({
      'GET /api/admin/gates': [],
      'GET /api/admin/access-logs': (_body, url) =>
        url.searchParams.get('q') === '이전'
          ? pending.promise
          : {
              json: {
                items: url.searchParams.get('q') ? [item(9, { employeeName: '새 검색' })] : [],
                nextBeforeEventKey: null,
              },
            },
    });
    page();
    await screen.findByText('조건에 맞는 기록이 없습니다.');
    await userEvent.type(screen.getByLabelText('이름'), '이전');
    await userEvent.clear(screen.getByLabelText('이름'));
    await userEvent.type(screen.getByLabelText('이름'), '새 검색');
    await screen.findByRole('row', { name: /새 검색/ });
    await act(async () =>
      pending.resolve({
        json: { items: [item(1, { employeeName: '이전 검색' })], nextBeforeEventKey: 1 },
      }),
    );
    expect(screen.getByRole('row', { name: /새 검색/ })).toBeInTheDocument();
    expect(screen.queryByText('이전 검색')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '더 보기' })).not.toBeInTheDocument();
  });

  it('does not append a pending old page after applying a different search', async () => {
    const pending = deferred();
    mockApi({
      'GET /api/admin/gates': [],
      'GET /api/admin/access-logs': (_body, url) =>
        url.searchParams.has('beforeEventKey')
          ? pending.promise
          : {
              json: {
                items: url.searchParams.get('q')
                  ? [item(9, { employeeName: '새 검색' })]
                  : [item(3, { employeeName: '김철수' })],
                nextBeforeEventKey: url.searchParams.get('q') ? null : 3,
              },
            },
    });
    page();
    await screen.findByText('김철수');
    await userEvent.click(screen.getByRole('button', { name: '더 보기' }));
    await userEvent.type(screen.getByLabelText('이름'), '새 검색');
    await screen.findByRole('row', { name: /새 검색/ });
    await act(async () =>
      pending.resolve({ json: { items: [item(1)], nextBeforeEventKey: null } }),
    );
    expect(screen.queryByText('홍길동')).not.toBeInTheDocument();
    expect(screen.queryByText('김철수')).not.toBeInTheDocument();
    expect(screen.getByRole('row', { name: /새 검색/ })).toBeInTheDocument();
  });

  it('clears old rows and cursor when a replacement search fails and retries the new filter', async () => {
    let attempts = 0;
    const calls = mockApi({
      'GET /api/admin/gates': [],
      'GET /api/admin/access-logs': (_body, url) =>
        !url.searchParams.get('q')
          ? { json: { items: [item(3, { employeeName: '김철수' })], nextBeforeEventKey: 3 } }
          : url.searchParams.get('q') === '새 검색' && ++attempts === 1 // 입력하는 대로 조회하므로 마지막 글자에서 실패
            ? { status: 503, json: { error: 'unavailable' } }
            : { json: { items: [item(9, { employeeName: '새 검색' })], nextBeforeEventKey: null } },
    });
    page();
    await screen.findByText('김철수');
    await userEvent.type(screen.getByLabelText('이름'), '새 검색');
    await screen.findByRole('alert');
    expect(screen.queryByText('김철수')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '더 보기' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('row', { name: /새 검색/ })).toBeInTheDocument();
    const last = calls.filter((call) => call.path.startsWith('/api/admin/access-logs?')).at(-1)!;
    expect(new URL(last.path, 'http://localhost').searchParams.get('q')).toBe('새 검색');
    expect(last.path).not.toContain('beforeEventKey');
  });

  it('reports a gate-list failure and can restore the gate names', async () => {
    let attempts = 0;
    mockApi({
      'GET /api/admin/gates': () =>
        ++attempts === 1
          ? { status: 503, json: { error: 'unavailable' } }
          : { json: [{ gateKey: 1, name: '정문 1' }] },
      'GET /api/admin/access-logs': { items: [item(1)], nextBeforeEventKey: null },
    });
    page();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '게이트 목록을 불러오지 못했습니다.',
    );
    await userEvent.click(screen.getByRole('button', { name: '게이트 다시 불러오기' }));
    expect(await screen.findByRole('row', { name: /정문 1.*홍길동/ })).toBeInTheDocument();
  });
});
