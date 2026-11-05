import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/mockApi';
import { SettingsPage } from './SettingsPage';

vi.mock('../auth/Session', () => ({
  useAdmin: () => ({
    admin: { adminKey: 1, loginId: 'hr.kim', name: '김인사' },
    appEnv: 'production',
    logout: vi.fn(),
  }),
}));

const base = {
  'GET /api/admin/settings': { duplicateWindowSec: 5, photoRetentionDays: 90 },
  'GET /api/admin/settings/face-engine': { engine: 'AI_SERVER' },
  'GET /api/admin/settings/terminal-light': { idle: 'WHITE', granted: 'GREEN', denied: 'RED' },
  'GET /api/admin/settings/terminal-voice': {
    granted: '인증되었습니다',
    denied: '출입 권한이 없습니다',
    unregistered: '',
  },
  'GET /api/admin/settings/ingest-key': {
    issued: true,
    hint: 'a1b2',
    issuedAt: '2026-11-03 09:00:00',
  },
  'GET /api/admin/admins': [
    {
      adminKey: 1,
      loginId: 'hr.kim',
      name: '김인사',
      enabled: true,
      createdAt: '2026-11-03 09:00:00',
    },
    {
      adminKey: 2,
      loginId: 'hr.lee',
      name: '이인사',
      enabled: true,
      createdAt: '2026-11-03 09:00:00',
    },
  ],
};
const settings = () =>
  render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  );
const deferred = () => {
  let resolve!: (reply: { status?: number; json?: unknown }) => void;
  const promise = new Promise<{ status?: number; json?: unknown }>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('SettingsPage', () => {
  it('edits the terminal voice lines and saves them', async () => {
    let saved: unknown;
    mockApi({
      ...base,
      'PUT /api/admin/settings/terminal-voice': (body) => {
        saved = body;
        return { json: body };
      },
    });
    settings();
    const section = within(await screen.findByRole('form', { name: '단말 음성 안내' }));
    const granted = section.getByLabelText('통과');
    await screen.findByDisplayValue('인증되었습니다');
    await userEvent.clear(granted);
    await userEvent.type(granted, '환영합니다');
    expect(section.getByRole('button', { name: '미등록 미리 듣기' })).toBeDisabled();
    await userEvent.click(
      within(section.getByLabelText('미등록 추천 멘트')).getByRole('button', {
        name: '등록되지 않은 사용자입니다',
      }),
    );
    await userEvent.click(section.getByRole('button', { name: '음성 안내 저장' }));
    expect(await section.findByText(/저장했습니다/)).toBeInTheDocument();
    expect(saved).toEqual({
      granted: '환영합니다',
      denied: '출입 권한이 없습니다',
      unregistered: '등록되지 않은 사용자입니다',
    });
  });

  it('picks gate light colors from the presets and saves them', async () => {
    let saved: unknown;
    mockApi({
      ...base,
      'GET /api/admin/settings/terminal-light': { idle: 'WHITE', granted: 'GREEN', denied: 'RED' },
      'PUT /api/admin/settings/terminal-light': (body) => {
        saved = body;
        return { json: body };
      },
    });
    settings();
    const section = within(await screen.findByRole('form', { name: '단말 불빛' }));
    const idle = section.getByLabelText('대기');
    await screen.findByDisplayValue('하양');
    expect(
      within(idle)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['하양', '초록', '빨강', '파랑', '노랑', '보라', '하늘', '끄기']);
    await userEvent.selectOptions(idle, 'BLUE');
    await userEvent.click(section.getByRole('button', { name: '단말 불빛 저장' }));
    expect(await section.findByText(/저장했습니다/)).toBeInTheDocument();
    expect(saved).toEqual({ idle: 'BLUE', granted: 'GREEN', denied: 'RED' });
  });

  it('asks for a pin before switching terminals to admin pin mode, then saves', async () => {
    let saved: unknown;
    mockApi({
      ...base,
      'GET /api/admin/settings/terminal-admin': { mode: 'ACCOUNT', pinSet: false },
      'PUT /api/admin/settings/terminal-admin': (body) => {
        saved = body;
        return { json: { mode: 'PIN', pinSet: true } };
      },
    });
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
    const section = within(await screen.findByRole('form', { name: '단말 관리자 확인' }));
    await userEvent.click(section.getByLabelText('관리자 번호'));
    await userEvent.click(section.getByRole('button', { name: '단말 관리자 확인 저장' }));
    expect(await section.findByText('관리자 번호를 먼저 정해 주세요.')).toBeInTheDocument();
    await userEvent.type(section.getByLabelText('관리자 번호 (숫자 4~8자리)'), '2468');
    await userEvent.click(section.getByRole('button', { name: '단말 관리자 확인 저장' }));
    expect(await section.findByText('저장했습니다.')).toBeInTheDocument();
    expect(saved).toEqual({ mode: 'PIN', pin: '2468' });
  });

  it('switches face recognition to the terminal', async () => {
    let saved: unknown;
    mockApi({
      ...base,
      'PUT /api/admin/settings/face-engine': (body) => {
        saved = body;
        return { json: { engine: 'TERMINAL' } };
      },
    });
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
    const section = within(await screen.findByRole('form', { name: '얼굴 인식 위치' }));
    expect(await section.findByLabelText('AI 서버')).toBeChecked();
    await userEvent.click(section.getByLabelText('단말'));
    await userEvent.click(section.getByRole('button', { name: '얼굴 인식 위치 저장' }));
    expect(
      await section.findByText('저장했습니다. 단말에는 1분 안에 적용됩니다.'),
    ).toBeInTheDocument();
    expect(saved).toEqual({ engine: 'TERMINAL' });
  });

  it('hides an old full key when replacement starts and checks metadata after a lost response', async () => {
    const pending = deferred();
    const oldKey = 'b'.repeat(64);
    let hint = 'a1b2';
    let issues = 0;
    const calls = mockApi({
      ...base,
      'GET /api/admin/settings/ingest-key': () => ({
        json: { ...base['GET /api/admin/settings/ingest-key'], hint },
      }),
      'POST /api/admin/settings/ingest-key': () => {
        issues += 1;
        hint = issues === 1 ? 'bbbb' : 'cccc';
        return issues === 1 ? { status: 201, json: { key: oldKey } } : pending.promise;
      },
    });
    vi.stubGlobal('confirm', () => true);
    settings();
    await screen.findByText('발급됨, 끝 4자리 a1b2, 11/03 09:00:00');
    await userEvent.click(screen.getByRole('button', { name: '새 키 발급' }));
    await screen.findByText(oldKey);
    await screen.findByText('발급됨, 끝 4자리 bbbb, 11/03 09:00:00');
    await userEvent.click(screen.getByRole('button', { name: '새 키 발급' }));
    expect(screen.queryByText(oldKey)).not.toBeInTheDocument();
    await act(async () => pending.resolve({ status: 503, json: { error: 'response lost' } }));
    expect(await screen.findByRole('alert')).toHaveTextContent('발급 결과를 확인하지 못했습니다.');
    await screen.findByText('발급됨, 끝 4자리 cccc, 11/03 09:00:00');
    expect(screen.queryByText(oldKey)).not.toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2);
  });

  it('reloads account state after a lost activation response and waits for verification', async () => {
    const verification = deferred();
    let reads = 0;
    const calls = mockApi({
      ...base,
      'GET /api/admin/admins': () =>
        ++reads === 1
          ? {
              json: base['GET /api/admin/admins'].map((a) => ({ ...a, enabled: a.adminKey === 1 })),
            }
          : verification.promise,
      'PATCH /api/admin/admins/2': () => ({ status: 503, json: { error: 'response lost' } }),
    });
    settings();
    const row = within(await screen.findByRole('row', { name: /hr\.lee/ }));
    await userEvent.click(row.getByRole('button', { name: '다시 사용' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('변경 결과를 확인하지 못했습니다.');
    expect(
      calls.filter((call) => call.method === 'GET' && call.path === '/api/admin/admins'),
    ).toHaveLength(2);
    expect(row.getByRole('button', { name: '다시 사용' })).toBeDisabled();
    await act(async () => verification.resolve({ json: base['GET /api/admin/admins'] }));
    expect(row.getByText('사용 중')).toBeInTheDocument();
    expect(row.getByRole('button', { name: '사용 중지' })).toBeEnabled();
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
  });

  it('ignores a delayed expired-session response after leaving the password form', async () => {
    const pending = deferred();
    mockApi({ ...base, 'POST /api/admin/auth/password': () => pending.promise });
    const onLogout = vi.fn();
    window.addEventListener('facegate:logout', onLogout);
    try {
      const view = settings();
      const form = within(await screen.findByRole('form', { name: '내 비밀번호 변경' }));
      await userEvent.type(form.getByLabelText('현재 비밀번호'), 'old fake');
      await userEvent.type(form.getByLabelText('새 비밀번호'), 'x');
      await userEvent.type(form.getByLabelText('새 비밀번호 확인'), 'x');
      await userEvent.click(form.getByRole('button', { name: '변경' }));
      view.unmount();
      settings();
      await screen.findByRole('form', { name: '내 비밀번호 변경' });
      await act(async () => pending.resolve({ status: 401, json: { error: 'login required' } }));
      expect(onLogout).not.toHaveBeenCalled();
      expect(screen.getByRole('form', { name: '내 비밀번호 변경' })).toBeInTheDocument();
    } finally {
      window.removeEventListener('facegate:logout', onLogout);
    }
  });

  it('explains that the development login ID is reserved when the server rejects it', async () => {
    mockApi({
      ...base,
      'POST /api/admin/admins': () => ({
        status: 400,
        json: { error: 'dev is reserved for development' },
      }),
    });
    settings();
    const form = within(await screen.findByRole('form', { name: '관리자 추가' }));
    await userEvent.type(form.getByLabelText('아이디'), 'dev');
    await userEvent.type(form.getByLabelText('이름'), '검토 계정');
    await userEvent.type(form.getByLabelText('비밀번호'), 'x');
    await userEvent.click(form.getByRole('button', { name: '추가' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '개발용 예약 아이디입니다. 다른 아이디를 입력해 주세요.',
    );
    expect(
      within(screen.getByRole('form', { name: '관리자 추가' })).getByLabelText('아이디'),
    ).toHaveValue('dev');
  });

  it('keeps a newly issued key if metadata refresh fails and clears it when leaving the page', async () => {
    let reads = 0;
    const key = 'f'.repeat(64);
    const calls = mockApi({
      ...base,
      'GET /api/admin/settings/ingest-key': () =>
        ++reads === 2
          ? { status: 503, json: { error: 'unavailable' } }
          : { json: base['GET /api/admin/settings/ingest-key'] },
      'POST /api/admin/settings/ingest-key': () => ({
        status: 201,
        json: { key, issuedAt: '2026-11-03 10:00:00' },
      }),
    });
    vi.stubGlobal('confirm', () => true);
    const view = settings();
    await screen.findByText('발급됨, 끝 4자리 a1b2, 11/03 09:00:00');
    await userEvent.click(screen.getByRole('button', { name: '새 키 발급' }));
    await screen.findByText('연동 키 정보를 불러오지 못했습니다.');
    expect(screen.getByText(key)).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    view.unmount();
    settings();
    await screen.findByText('발급됨, 끝 4자리 a1b2, 11/03 09:00:00');
    expect(screen.queryByText(key)).not.toBeInTheDocument();
  });

  it('keeps a one-space password unchanged rather than trimming it to empty', async () => {
    const calls = mockApi({ ...base, 'POST /api/admin/auth/password': {} });
    settings();
    const form = within(await screen.findByRole('form', { name: '내 비밀번호 변경' }));
    await userEvent.type(form.getByLabelText('현재 비밀번호'), 'old fake');
    await userEvent.type(form.getByLabelText('새 비밀번호'), ' ');
    await userEvent.type(form.getByLabelText('새 비밀번호 확인'), ' ');
    await userEvent.click(form.getByRole('button', { name: '변경' }));
    expect(
      await screen.findByText('비밀번호를 바꿨습니다. 다른 곳의 로그인은 끊어졌습니다.'),
    ).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      currentPassword: 'old fake',
      newPassword: ' ',
    });
  });

  it('returns to login when the password request reports an expired session', async () => {
    const onLogout = vi.fn();
    window.addEventListener('facegate:logout', onLogout);
    try {
      mockApi({
        ...base,
        'POST /api/admin/auth/password': () => ({ status: 401, json: { error: 'login required' } }),
      });
      settings();
      const form = within(await screen.findByRole('form', { name: '내 비밀번호 변경' }));
      await userEvent.type(form.getByLabelText('현재 비밀번호'), 'old fake');
      await userEvent.type(form.getByLabelText('새 비밀번호'), 'x');
      await userEvent.type(form.getByLabelText('새 비밀번호 확인'), 'x');
      await userEvent.click(form.getByRole('button', { name: '변경' }));
      expect(onLogout).toHaveBeenCalledOnce();
      expect(screen.queryByText('현재 비밀번호가 맞지 않습니다.')).not.toBeInTheDocument();
    } finally {
      window.removeEventListener('facegate:logout', onLogout);
    }
  });

  it('reports failed settings loading and restores the editable values on retry', async () => {
    let attempts = 0;
    mockApi({
      ...base,
      'GET /api/admin/settings': () =>
        ++attempts === 1
          ? { status: 503, json: { error: 'unavailable' } }
          : { json: { duplicateWindowSec: 5, photoRetentionDays: 90 } },
    });
    settings();
    expect(await screen.findByRole('alert')).toHaveTextContent('출입 설정을 불러오지 못했습니다.');
    await userEvent.click(screen.getByRole('button', { name: '출입 설정 다시 불러오기' }));
    expect(await screen.findByLabelText('중복 개방 간격 (초)')).toHaveValue(5);
  });

  it('preserves unsaved settings after a failed save and blocks concurrent writes', async () => {
    const pending = deferred();
    const calls = mockApi({ ...base, 'PUT /api/admin/settings': () => pending.promise });
    settings();
    const input = await screen.findByLabelText('중복 개방 간격 (초)');
    await userEvent.clear(input);
    await userEvent.type(input, '8');
    const save = screen.getByRole('button', { name: '출입 설정 저장' });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(save).toBeDisabled();
    expect(input).toBeDisabled();
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    await act(async () => pending.resolve({ status: 503, json: { error: 'unavailable' } }));
    expect(await screen.findByRole('alert')).toHaveTextContent('저장하지 못했습니다.');
    expect(input).toHaveValue(8);
    expect(save).toBeEnabled();
  });

  it('cannot issue an AI key while the current key information is unavailable', async () => {
    let attempts = 0;
    const calls = mockApi({
      ...base,
      'GET /api/admin/settings/ingest-key': () =>
        ++attempts === 1
          ? { status: 503, json: { error: 'unavailable' } }
          : { json: base['GET /api/admin/settings/ingest-key'] },
    });
    settings();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '연동 키 정보를 불러오지 못했습니다.',
    );
    expect(screen.getByRole('button', { name: '새 키 발급' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '연동 키 다시 불러오기' }));
    expect(await screen.findByText('발급됨, 끝 4자리 a1b2, 11/03 09:00:00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '새 키 발급' })).toBeEnabled();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('does not replace a key when the administrator cancels the warning', async () => {
    const calls = mockApi(base);
    vi.stubGlobal('confirm', () => false);
    settings();
    await screen.findByText('발급됨, 끝 4자리 a1b2, 11/03 09:00:00');
    await userEvent.click(screen.getByRole('button', { name: '새 키 발급' }));
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('blocks duplicate key issuance and reports failure without losing the existing hint', async () => {
    const pending = deferred();
    const calls = mockApi({
      ...base,
      'POST /api/admin/settings/ingest-key': () => pending.promise,
    });
    vi.stubGlobal('confirm', () => true);
    settings();
    await screen.findByText('발급됨, 끝 4자리 a1b2, 11/03 09:00:00');
    const issue = screen.getByRole('button', { name: '새 키 발급' });
    fireEvent.click(issue);
    fireEvent.click(issue);
    expect(issue).toBeDisabled();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    await act(async () => pending.resolve({ status: 503, json: { error: 'unavailable' } }));
    expect(await screen.findByRole('alert')).toHaveTextContent('발급 결과를 확인하지 못했습니다.');
    expect(screen.getByText('발급됨, 끝 4자리 a1b2, 11/03 09:00:00')).toBeInTheDocument();
    expect(issue).toBeEnabled();
  });

  it('preserves an admin draft after failure, remasks its password and blocks duplicate additions', async () => {
    const pending = deferred();
    const calls = mockApi({ ...base, 'POST /api/admin/admins': () => pending.promise });
    settings();
    const form = within(await screen.findByRole('form', { name: '관리자 추가' }));
    await userEvent.type(form.getByLabelText('아이디'), 'hr.park');
    await userEvent.type(form.getByLabelText('이름'), '박인사');
    await userEvent.type(form.getByLabelText('비밀번호'), 'x');
    await userEvent.click(form.getByRole('button', { name: '비밀번호 보기' }));
    const add = form.getByRole('button', { name: '추가' });
    fireEvent.click(add);
    fireEvent.click(add);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '추가' })).toBeDisabled();
    await act(async () => pending.resolve({ status: 409, json: { error: 'duplicate loginId' } }));
    expect(await screen.findByRole('alert')).toHaveTextContent('이미 있는 아이디입니다.');
    const after = within(screen.getByRole('form', { name: '관리자 추가' }));
    expect(after.getByLabelText('아이디')).toHaveValue('hr.park');
    expect(after.getByLabelText('비밀번호')).toHaveAttribute('type', 'password');
    expect(after.getByLabelText('비밀번호')).toHaveValue('x');
  });

  it('reports a failed account-state change and keeps that account usable for retry', async () => {
    const pending = deferred();
    const calls = mockApi({ ...base, 'PATCH /api/admin/admins/2': () => pending.promise });
    settings();
    const row = within(await screen.findByRole('row', { name: /hr\.lee/ }));
    const disable = row.getByRole('button', { name: '사용 중지' });
    fireEvent.click(disable);
    fireEvent.click(disable);
    expect(disable).toBeDisabled();
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
    await act(async () => pending.resolve({ status: 503, json: { error: 'unavailable' } }));
    expect(await screen.findByRole('alert')).toHaveTextContent('변경 결과를 확인하지 못했습니다.');
    expect(row.getByText('사용 중')).toBeInTheDocument();
    expect(disable).toBeEnabled();
  });

  it('keeps password inputs after a failed change, remasks them and blocks concurrent changes', async () => {
    const pending = deferred();
    const calls = mockApi({ ...base, 'POST /api/admin/auth/password': () => pending.promise });
    settings();
    const form = within(await screen.findByRole('form', { name: '내 비밀번호 변경' }));
    await userEvent.type(form.getByLabelText('현재 비밀번호'), 'old fake');
    await userEvent.type(form.getByLabelText('새 비밀번호'), 'x');
    await userEvent.type(form.getByLabelText('새 비밀번호 확인'), 'x');
    await userEvent.click(form.getAllByRole('button', { name: '비밀번호 보기' })[0]);
    const change = form.getByRole('button', { name: '변경' });
    fireEvent.click(change);
    fireEvent.click(change);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '변경' })).toBeDisabled();
    await act(async () => pending.resolve({ status: 503, json: { error: 'unavailable' } }));
    expect(await screen.findByRole('alert')).toHaveTextContent('변경하지 못했습니다.');
    const after = within(screen.getByRole('form', { name: '내 비밀번호 변경' }));
    expect(after.getByLabelText('현재 비밀번호')).toHaveAttribute('type', 'password');
    expect(after.getByLabelText('현재 비밀번호')).toHaveValue('old fake');
    expect(after.getByLabelText('새 비밀번호')).toHaveValue('x');
  });

  it('does not submit mismatched new passwords and clears all password inputs after success', async () => {
    const calls = mockApi({ ...base, 'POST /api/admin/auth/password': {} });
    settings();
    const form = within(await screen.findByRole('form', { name: '내 비밀번호 변경' }));
    await userEvent.type(form.getByLabelText('현재 비밀번호'), 'old fake');
    await userEvent.type(form.getByLabelText('새 비밀번호'), 'x');
    await userEvent.type(form.getByLabelText('새 비밀번호 확인'), 'y');
    await userEvent.click(form.getByRole('button', { name: '변경' }));
    expect(await screen.findByText('새 비밀번호가 서로 다릅니다.')).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    const updated = within(screen.getByRole('form', { name: '내 비밀번호 변경' }));
    await userEvent.clear(updated.getByLabelText('새 비밀번호 확인'));
    await userEvent.type(updated.getByLabelText('새 비밀번호 확인'), 'x');
    await userEvent.click(updated.getByRole('button', { name: '변경' }));
    await screen.findByText('비밀번호를 바꿨습니다. 다른 곳의 로그인은 끊어졌습니다.');
    const after = within(screen.getByRole('form', { name: '내 비밀번호 변경' }));
    expect(after.getByLabelText('현재 비밀번호')).toHaveValue('');
    expect(after.getByLabelText('새 비밀번호')).toHaveValue('');
    expect(after.getByLabelText('새 비밀번호 확인')).toHaveValue('');
  });

  it('saves access settings', async () => {
    const calls = mockApi({
      ...base,
      'PUT /api/admin/settings': { duplicateWindowSec: 8, photoRetentionDays: 90 },
    });
    settings();
    const input = await screen.findByLabelText('중복 개방 간격 (초)');
    await userEvent.clear(input);
    await userEvent.type(input, '8');
    await userEvent.click(screen.getByRole('button', { name: '출입 설정 저장' }));
    expect(await screen.findByText('저장했습니다.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
      duplicateWindowSec: 8,
      photoRetentionDays: 90,
    });
  });

  it('issues an AI key after a warning and shows it once', async () => {
    mockApi({
      ...base,
      'POST /api/admin/settings/ingest-key': () => ({
        status: 201,
        json: { key: 'f'.repeat(64), issuedAt: '2026-11-03 10:00:00' },
      }),
    });
    vi.stubGlobal('confirm', () => true);
    settings();
    expect(await screen.findByText('발급됨, 끝 4자리 a1b2, 11/03 09:00:00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '새 키 발급' }));
    expect(await screen.findByText('f'.repeat(64))).toBeInTheDocument();
    expect(
      screen.getByText(
        '이 키는 지금만 볼 수 있습니다. AI 서버 설정에 넣은 뒤 이 화면을 닫아 주세요.',
      ),
    ).toBeInTheDocument();
  });

  it('adds an admin and can disable others but not yourself', async () => {
    const calls = mockApi({
      ...base,
      'POST /api/admin/admins': () => ({ status: 201, json: { adminKey: 3 } }),
      'PATCH /api/admin/admins/2': {},
    });
    settings();
    const me = await screen.findByRole('row', { name: /hr\.kim/ });
    expect(within(me).queryByRole('button', { name: '사용 중지' })).not.toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole('row', { name: /hr\.lee/ })).getByRole('button', {
        name: '사용 중지',
      }),
    );
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ enabled: false });

    const add = screen.getByRole('form', { name: '관리자 추가' });
    await userEvent.type(within(add).getByLabelText('아이디'), 'hr.park');
    await userEvent.type(within(add).getByLabelText('이름'), '박인사');
    await userEvent.type(within(add).getByLabelText('비밀번호'), 'x');
    await userEvent.click(within(add).getByRole('button', { name: '추가' }));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      loginId: 'hr.park',
      name: '박인사',
      password: 'x',
    });
  });

  it('rejects an empty admin password without sending it', async () => {
    const calls = mockApi(base);
    settings();
    const form = await screen.findByRole('form', { name: '관리자 추가' });
    await userEvent.type(within(form).getByLabelText('아이디'), 'hr.park');
    await userEvent.type(within(form).getByLabelText('이름'), '박인사');
    await userEvent.click(within(form).getByRole('button', { name: '추가' }));
    expect(await screen.findByText('비밀번호를 입력해 주세요.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('rejects an empty new password but accepts a one-character replacement', async () => {
    const calls = mockApi({ ...base, 'POST /api/admin/auth/password': {} });
    settings();
    let form = await screen.findByRole('form', { name: '내 비밀번호 변경' });
    await userEvent.type(within(form).getByLabelText('현재 비밀번호'), 'old fake');
    await userEvent.click(within(form).getByRole('button', { name: '변경' }));
    expect(await screen.findByText('새 비밀번호를 입력해 주세요.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    form = screen.getByRole('form', { name: '내 비밀번호 변경' });
    await userEvent.type(within(form).getByLabelText('새 비밀번호'), 'x');
    await userEvent.type(within(form).getByLabelText('새 비밀번호 확인'), 'x');
    await userEvent.click(within(form).getByRole('button', { name: '변경' }));
    expect(
      await screen.findByText('비밀번호를 바꿨습니다. 다른 곳의 로그인은 끊어졌습니다.'),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      currentPassword: 'old fake',
      newPassword: 'x',
    });
  });

  it('changes my password with confirmation', async () => {
    const calls = mockApi({
      ...base,
      'POST /api/admin/auth/password': () => ({
        status: 401,
        json: { error: 'current password is wrong' },
      }),
    });
    settings();
    const form = await screen.findByRole('form', { name: '내 비밀번호 변경' });
    await userEvent.type(within(form).getByLabelText('현재 비밀번호'), 'old password!!');
    await userEvent.type(within(form).getByLabelText('새 비밀번호'), 'brand new password');
    await userEvent.type(within(form).getByLabelText('새 비밀번호 확인'), 'brand new password');
    await userEvent.click(within(form).getByRole('button', { name: '변경' }));
    expect(await screen.findByText('현재 비밀번호가 맞지 않습니다.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      currentPassword: 'old password!!',
      newPassword: 'brand new password',
    });
  });
});
