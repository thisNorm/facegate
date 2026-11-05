import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/mockApi';
import { StatusPage } from './StatusPage';

const status = {
  checkedAt: '2026-11-03 09:42:10',
  ai: { online: true, powerOnAt: '2026-11-03 08:00:00', lastStatusAt: '2026-11-03 09:42:00' },
  ingestKeyIssued: true,
  gates: [
    {
      gateKey: 1,
      name: '정문 1',
      adapterType: 'DRY_CONTACT',
      terminals: [{ terminalKey: 101, connected: true, aiRtspOk: true }],
    },
    {
      gateKey: 2,
      name: '정문 2',
      adapterType: 'DRY_CONTACT',
      terminals: [{ terminalKey: 102, connected: false, aiRtspOk: true }],
    },
  ],
};
const log = (eventKey: number, result: string, extra = {}) => ({
  eventKey,
  gateKey: 1,
  method: 'FACE',
  result,
  receivedAt: '2026-11-03 09:40:00.000',
  employeeName: null,
  visitorName: null,
  ...extra,
});

const frame = () =>
  new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
    headers: { 'Content-Type': 'image/jpeg', 'X-Frame-Age-Ms': '0' },
  });

function renderPage() {
  return render(
    <MemoryRouter>
      <StatusPage />
    </MemoryRouter>,
  );
}

describe('StatusPage', () => {
  it('shows one floor at a time, streams only that floor and keeps drafts across floors', async () => {
    const gate = (gateKey: number, floor: number, connected = true) => ({
      ...status.gates[0],
      gateKey,
      name: `출입구 ${gateKey}`,
      floor,
      terminals: [{ terminalKey: 100 + gateKey, connected, aiRtspOk: true }],
    });
    const gates = [
      gate(4, 1),
      gate(9, 3),
      gate(15, 3),
      gate(23, 3),
      gate(42, 3),
      gate(88, 7, false),
    ];
    const calls = mockApi({
      'GET /api/admin/status': { ...status, gates },
      'GET /api/admin/access-logs': { items: [], nextBeforeEventKey: null },
      ...Object.fromEntries(
        gates.map((g) => [`GET /api/admin/terminals/${100 + g.gateKey}/frame`, frame]),
      ),
    });
    localStorage.removeItem('status.floor');
    renderPage();
    const floors = within(await screen.findByRole('group', { name: '층' }));
    // 처음엔 가장 낮은 층, 다른 층의 끊김은 숫자로
    expect(floors.getByRole('button', { name: '1층' })).toHaveAttribute('aria-pressed', 'true');
    expect(floors.getByRole('button', { name: '7층 문제 1' })).toBeInTheDocument();
    const first = within(screen.getByRole('region', { name: '출입구 4' }));
    await first.findByRole('img');
    expect(screen.queryByRole('region', { name: '출입구 9' })).not.toBeInTheDocument();
    await userEvent.type(first.getByLabelText('방문객 이름'), '4번 방문객');
    await userEvent.click(floors.getByRole('button', { name: '3층' }));
    // 3층 4대가 보이고(한 줄 3장, 넘치면 다음 줄), 영상은 보이는 층만
    expect(screen.getAllByRole('form', { name: /^출입구 .* 개방$/ })).toHaveLength(4);
    expect(
      await within(screen.getByRole('region', { name: '출입구 42' })).findByRole('img'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/api/admin/terminals/188/frame')).toBe(false);
    await userEvent.click(floors.getByRole('button', { name: '1층' }));
    expect(first.getByLabelText('방문객 이름')).toHaveValue('4번 방문객');
    expect(localStorage.getItem('status.floor')).toBe('1');
  });

  it('keeps both terminal videos and their own open controls visible without a gate selector', async () => {
    const calls = mockApi({
      'GET /api/admin/status': status,
      'GET /api/admin/access-logs': { items: [], nextBeforeEventKey: null },
      'GET /api/admin/terminals/101/frame': frame,
      'GET /api/admin/terminals/102/frame': frame,
    });
    renderPage();
    const first = await screen.findByRole('region', { name: '정문 1' });
    const second = screen.getByRole('region', { name: '정문 2' });
    expect(
      await within(first).findByRole('img', { name: '단말 101 실시간 영상' }),
    ).toBeInTheDocument();
    expect(
      await within(second).findByRole('img', { name: '단말 102 실시간 영상' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('영상 게이트')).not.toBeInTheDocument();
    expect(within(first).getByRole('button', { name: '정문 1 1회 개방' })).toBeInTheDocument();
    expect(within(second).getByRole('button', { name: '정문 2 1회 개방' })).toBeInTheDocument();
    expect(within(first).getByLabelText('방문객')).toBeChecked();
    expect(within(first).getByRole('button', { name: '정문 1 1회 개방' })).toBeDisabled();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('keeps visitor inputs in their gate while opening the other gate', async () => {
    const calls = mockApi({
      'GET /api/admin/status': status,
      'GET /api/admin/access-logs': { items: [], nextBeforeEventKey: null },
      'GET /api/admin/terminals/101/frame': frame,
      'GET /api/admin/terminals/102/frame': frame,
      'POST /api/admin/gates/2/open': { eventKey: 9, result: 'GRANTED' },
    });
    renderPage();
    const first = within(await screen.findByRole('region', { name: '정문 1' }));
    const second = within(screen.getByRole('region', { name: '정문 2' }));
    await userEvent.click(first.getByLabelText('방문객'));
    await userEvent.type(first.getByLabelText('방문객 이름'), '정문 1 방문객');
    expect(await screen.findByRole('img', { name: '단말 102 실시간 영상' })).toBeInTheDocument();
    expect(second.getByLabelText('방문객 이름')).toHaveValue('');
    await userEvent.type(second.getByLabelText('방문객 이름'), '정문 2 방문객');
    await userEvent.click(second.getByRole('button', { name: '정문 2 1회 개방' }));
    expect(await second.findByText('정문 2 개방 신호를 보냈습니다.')).toBeInTheDocument();
    expect(first.getByLabelText('방문객 이름')).toHaveValue('정문 1 방문객');
    expect(first.getByLabelText('방문객')).toBeChecked();
    expect(first.queryByText('정문 2 개방 신호를 보냈습니다.')).not.toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.path)).toEqual([
      '/api/admin/gates/2/open',
    ]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows whether each remote-open attempt succeeded or failed', async () => {
    mockApi({
      'GET /api/admin/status': status,
      'GET /api/admin/access-logs': (_body, url) => ({
        json: {
          items:
            url.searchParams.get('method') === 'REMOTE'
              ? [
                  log(9, 'GATE_ERROR', { method: 'REMOTE', remoteReason: 'OTHER' }),
                  log(8, 'GRANTED', { method: 'REMOTE', remoteReason: 'VISITOR' }),
                ]
              : [],
        },
      }),
    });
    renderPage();
    const failed = await screen.findByRole('row', { name: /정문 1.*기타/ });
    expect(within(failed).getByText('게이트 오류', { selector: 'td.problem' })).toBeInTheDocument();
    const succeeded = screen.getByRole('row', { name: /정문 1.*방문객/ });
    expect(within(succeeded).getByText('허가', { selector: 'td.ok' })).toBeInTheDocument();
  });

  it('keeps a pending open result in its gate without resetting the other visitor form', async () => {
    let finish!: (reply: { json: { eventKey: number; result: string } }) => void;
    const pending = new Promise<{ json: { eventKey: number; result: string } }>((resolve) => {
      finish = resolve;
    });
    mockApi({
      'GET /api/admin/status': status,
      'GET /api/admin/access-logs': { items: [], nextBeforeEventKey: null },
      'POST /api/admin/gates/1/open': () => pending,
    });
    renderPage();
    const first = within(await screen.findByRole('region', { name: '정문 1' }));
    const second = within(screen.getByRole('region', { name: '정문 2' }));
    await userEvent.click(first.getByLabelText('직원 인증 불가'));
    await userEvent.click(first.getByRole('button', { name: '정문 1 1회 개방' }));
    expect(first.getByRole('button', { name: '정문 1 1회 개방' })).toBeDisabled();
    await userEvent.click(second.getByLabelText('방문객'));
    await userEvent.type(second.getByLabelText('방문객 이름'), '정문 2 방문객');
    await act(async () => {
      finish({ json: { eventKey: 9, result: 'GRANTED' } });
    });
    expect(await first.findByText('정문 1 개방 신호를 보냈습니다.')).toBeInTheDocument();
    expect(second.queryByText('정문 1 개방 신호를 보냈습니다.')).not.toBeInTheDocument();
    expect(second.getByLabelText('방문객 이름')).toHaveValue('정문 2 방문객');
    expect(second.getByRole('button', { name: '정문 2 1회 개방' })).toBeEnabled();
  });

  it('uses the total terminal count when some terminals are disconnected', async () => {
    mockApi({
      'GET /api/admin/status': {
        ...status,
        gates: [
          {
            ...status.gates[0],
            terminals: [101, 103, 105].map((terminalKey) => ({
              terminalKey,
              connected: terminalKey === 101,
              aiRtspOk: true,
            })),
          },
        ],
      },
      'GET /api/admin/access-logs': { items: [], nextBeforeEventKey: null },
    });
    renderPage();
    expect(await screen.findByText('3대 중 2대 끊김')).toBeInTheDocument();
  });

  it('submits a pending remote open only once', async () => {
    let finish!: (reply: { json: { eventKey: number; result: string } }) => void;
    const pending = new Promise<{ json: { eventKey: number; result: string } }>((resolve) => {
      finish = resolve;
    });
    const calls = mockApi({
      'GET /api/admin/status': status,
      'GET /api/admin/access-logs': { items: [], nextBeforeEventKey: null },
      'POST /api/admin/gates/1/open': () => pending,
    });
    renderPage();
    const first = within(await screen.findByRole('region', { name: '정문 1' }));
    await userEvent.click(first.getByLabelText('직원 인증 불가'));
    expect(first.getByText('얼굴과 NFC로 출입할 수 없는 경우에 사용합니다.')).toBeInTheDocument();
    const submit = first.getByRole('button', { name: '정문 1 1회 개방' });
    try {
      await userEvent.dblClick(submit);
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
      expect(submit).toBeDisabled();
    } finally {
      await act(async () => {
        finish({ json: { eventKey: 9, result: 'GRANTED' } });
      });
    }
    expect(await screen.findByText('정문 1 개방 신호를 보냈습니다.')).toBeInTheDocument();
  });

  it('refreshes the remote-open history together with status every ten seconds', async () => {
    vi.useFakeTimers();
    try {
      const calls = mockApi({
        'GET /api/admin/status': status,
        'GET /api/admin/access-logs': { items: [], nextBeforeEventKey: null },
      });
      await act(async () => {
        renderPage();
      });
      expect(calls.filter((call) => call.path.includes('method=REMOTE'))).toHaveLength(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(calls.filter((call) => call.path.includes('method=REMOTE'))).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows each gate connection status with only problems emphasised', async () => {
    mockApi({
      'GET /api/admin/status': status,
      'GET /api/admin/access-logs': { items: [], nextBeforeEventKey: null },
      'GET /api/admin/terminals/101/frame': frame,
      'GET /api/admin/terminals/102/frame': { status: 503 },
    });
    renderPage();
    expect(await screen.findByText('얼굴인식 서버 정상, 마지막 응답 09:42:00')).toBeInTheDocument();
    const second = within(screen.getByRole('region', { name: '정문 2' }));
    const row = (region: typeof second, label: string) =>
      region.getByText(label, { selector: 'dt' }).nextElementSibling;
    // 단말은 서버 접속, 영상은 서버가 받는 단말 영상, 얼굴인식은 AI 보고
    await waitFor(() => expect(row(second, '영상')).toHaveTextContent('끊김'));
    expect(row(second, '영상')).toHaveClass('problem');
    expect(row(second, '단말')).toHaveTextContent('끊김');
    const first = within(screen.getByRole('region', { name: '정문 1' }));
    await waitFor(() => expect(row(first, '영상')).toHaveTextContent('연결'));
    expect(row(first, '영상')).not.toHaveClass('problem');
    expect(row(first, '단말')).toHaveTextContent('연결');
    expect(row(first, '얼굴인식')).toHaveTextContent('정상');
    expect(first.queryByText(/열림|닫힘/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/·|대시보드/);
  });

  it('shows no terminal rather than a normal status when none is configured', async () => {
    mockApi({
      'GET /api/admin/status': { ...status, gates: [{ ...status.gates[0], terminals: [] }] },
      'GET /api/admin/access-logs': { items: [], nextBeforeEventKey: null },
    });
    renderPage();
    const first = within(await screen.findByRole('region', { name: '정문 1' }));
    // 단말, 영상, 얼굴인식 모두
    expect(first.getAllByText('없음', { selector: 'dd' })).toHaveLength(3);
    expect(first.getByText('연결된 단말이 없습니다.')).toBeInTheDocument();
  });

  it('says when the AI is not answering', async () => {
    mockApi({
      'GET /api/admin/status': { ...status, ai: { ...status.ai, online: false } },
      'GET /api/admin/access-logs': { items: [], nextBeforeEventKey: null },
    });
    renderPage();
    expect(
      await screen.findByText('얼굴인식 서버 응답 없음, 마지막 응답 09:42:00'),
    ).toBeInTheDocument();
    const first = within(screen.getByRole('region', { name: '정문 1' }));
    expect(first.getByText('얼굴인식', { selector: 'dt' }).nextElementSibling).toHaveTextContent(
      '응답 없음',
    );
  });

  it('recent access shows unregistered and errors emphasised', async () => {
    mockApi({
      'GET /api/admin/status': status,
      'GET /api/admin/access-logs': (_b, url) =>
        url.searchParams.get('method') === 'REMOTE'
          ? { json: { items: [], nextBeforeEventKey: null } }
          : {
              json: {
                items: [log(2, 'UNREGISTERED'), log(1, 'GRANTED', { employeeName: '홍길동' })],
                nextBeforeEventKey: null,
              },
            },
    });
    renderPage();
    expect(await screen.findByText('홍길동')).toBeInTheDocument();
    expect(screen.getByText('미등록', { selector: 'td.problem' })).toBeInTheDocument();
    expect(screen.getByText('허가', { selector: 'td.ok' })).toBeInTheDocument();
  });

  it('opens a gate for a visitor through the permanent panel', async () => {
    const calls = mockApi({
      'GET /api/admin/status': status,
      'GET /api/admin/access-logs': { items: [], nextBeforeEventKey: null },
      'POST /api/admin/gates/1/open': { eventKey: 9, result: 'GRANTED' },
    });
    renderPage();
    const first = within(await screen.findByRole('region', { name: '정문 1' }));
    await userEvent.click(first.getByLabelText('방문객'));
    await userEvent.type(first.getByLabelText('방문객 이름'), '방문자');
    await userEvent.type(first.getByLabelText('회사'), '협력사');
    await userEvent.click(first.getByRole('button', { name: '정문 1 1회 개방' }));
    expect(await first.findByText('정문 1 개방 신호를 보냈습니다.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      reason: 'VISITOR',
      visitor: { name: '방문자', company: '협력사' },
    });
  });

  it('asks for a note when the reason is other, and shows a relay failure', async () => {
    mockApi({
      'GET /api/admin/status': status,
      'GET /api/admin/access-logs': { items: [], nextBeforeEventKey: null },
      'POST /api/admin/gates/1/open': () => ({
        status: 502,
        json: { eventKey: 9, result: 'GATE_ERROR' },
      }),
    });
    renderPage();
    const first = within(await screen.findByRole('region', { name: '정문 1' }));
    await userEvent.click(first.getByLabelText('기타'));
    expect(first.getByRole('button', { name: '정문 1 1회 개방' })).toBeDisabled();
    await userEvent.type(first.getByLabelText('메모'), '택배');
    await userEvent.click(first.getByRole('button', { name: '정문 1 1회 개방' }));
    expect(
      await screen.findByText('게이트가 응답하지 않습니다. 릴레이 연결을 확인해 주세요.'),
    ).toBeInTheDocument();
  });

  it('clears the visitor and note after a successful open', async () => {
    mockApi({
      'GET /api/admin/status': status,
      'GET /api/admin/access-logs': { items: [], nextBeforeEventKey: null },
      'POST /api/admin/gates/1/open': { eventKey: 9, result: 'GRANTED' },
    });
    renderPage();
    const first = within(await screen.findByRole('region', { name: '정문 1' }));
    await userEvent.type(first.getByLabelText('방문객 이름'), '방문자');
    await userEvent.type(first.getByLabelText('회사'), '협력사');
    await userEvent.type(first.getByLabelText('메모'), '회의');
    await userEvent.click(first.getByRole('button', { name: '정문 1 1회 개방' }));
    await first.findByText('정문 1 개방 신호를 보냈습니다.');
    expect(first.getByLabelText('방문객 이름')).toHaveValue('');
    expect(first.getByLabelText('회사')).toHaveValue('');
    expect(first.getByLabelText('메모')).toHaveValue('');
  });

  it.each([
    [400, '열지 못했습니다. 입력을 확인해 주세요.', false],
    [500, '결과를 확인하지 못했습니다. 오늘 원격 개방 이력을 확인해 주세요.', true],
    [401, '결과를 확인하지 못했습니다. 오늘 원격 개방 이력을 확인해 주세요.', true],
    [0, '결과를 확인하지 못했습니다. 오늘 원격 개방 이력을 확인해 주세요.', true],
  ])(
    'open failure %i keeps the input and reloads history only when unsure',
    async (code, text, reload) => {
      const calls = mockApi({
        'GET /api/admin/status': status,
        'GET /api/admin/access-logs': { items: [], nextBeforeEventKey: null },
        'POST /api/admin/gates/1/open': () => {
          if (code === 0) throw new TypeError('network down');
          return { status: code, json: { error: 'failed' } };
        },
      });
      renderPage();
      const first = within(await screen.findByRole('region', { name: '정문 1' }));
      await userEvent.type(first.getByLabelText('방문객 이름'), '방문자');
      await waitFor(() =>
        expect(calls.filter((c) => c.path.includes('method=REMOTE'))).toHaveLength(1),
      );
      await userEvent.click(first.getByRole('button', { name: '정문 1 1회 개방' }));
      expect(await first.findByText(text)).toBeInTheDocument();
      expect(first.getByLabelText('방문객 이름')).toHaveValue('방문자');
      expect(calls.filter((c) => c.path.includes('method=REMOTE'))).toHaveLength(reload ? 2 : 1);
    },
  );
});
