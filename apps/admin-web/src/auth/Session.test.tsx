import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { mockApi } from '../test/mockApi';

const ADMIN = { adminKey: 1, loginId: 'boot.admin', name: '김인사' };
const production = { admin: ADMIN, mustChangeCredentials: false, appEnv: 'production' as const };
const firstLogin = { ...production, mustChangeCredentials: true };
const business = {
  'GET /api/admin/status': {
    checkedAt: '',
    ai: { online: false, powerOnAt: null, lastStatusAt: null },
    ingestKeyIssued: false,
    gates: [],
  },
  'GET /api/admin/access-logs': { items: [], nextBeforeEventKey: null },
};
const absent = () => ({ status: 401, json: { error: 'login required' } });
const credentialPosts = (calls: ReturnType<typeof mockApi>) =>
  calls.filter((c) => c.path === '/api/admin/auth/credentials');

describe('session flow', () => {
  it('returns to login when logout reports an expired session', async () => {
    mockApi({
      ...business,
      'GET /api/admin/auth/me': production,
      'POST /api/admin/auth/logout': () => ({ status: 401, json: { error: 'login required' } }),
    });
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: '로그아웃' }));
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '현황' })).not.toBeInTheDocument();
  });

  it('restores the session after retrying a failed me request', async () => {
    let attempts = 0;
    mockApi({
      ...business,
      'GET /api/admin/auth/me': () =>
        ++attempts === 1
          ? { status: 500, json: { error: 'internal error' } }
          : { json: production },
    });
    render(<App />);
    await screen.findByText('로그인 상태를 확인하지 못했습니다. 다시 시도해 주세요.');
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('link', { name: '현황' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument();
  });

  it('shows a retry message and masks the password after a login network error', async () => {
    mockApi({
      'GET /api/admin/auth/me': absent,
      'POST /api/admin/auth/login': () => {
        throw new TypeError('network unavailable');
      },
    });
    render(<App />);
    await screen.findByRole('heading', { name: '로그인' });
    await userEvent.type(screen.getByLabelText('아이디'), 'test.admin');
    await userEvent.type(screen.getByLabelText('비밀번호'), 'fake');
    await userEvent.click(screen.getByRole('button', { name: '비밀번호 보기' }));
    await userEvent.click(screen.getByRole('button', { name: '로그인' }));
    expect(
      await screen.findByText('로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('비밀번호')).toHaveAttribute('type', 'password');
  });

  it('keeps credential confirmation visible after a network error', async () => {
    mockApi({
      'GET /api/admin/auth/me': firstLogin,
      'POST /api/admin/auth/credentials': () => {
        throw new TypeError('network unavailable');
      },
    });
    render(<App />);
    await screen.findByRole('heading', { name: '계정 정보 확인' });
    await userEvent.type(screen.getByLabelText('현재 비밀번호'), 'fake');
    await userEvent.click(screen.getByRole('button', { name: '그대로 쓰기' }));
    expect(
      await screen.findByText('확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '계정 정보 확인' })).toBeInTheDocument();
  });

  it('returns to login after the server confirms logout', async () => {
    mockApi({
      ...business,
      'GET /api/admin/auth/me': production,
      'POST /api/admin/auth/logout': {},
    });
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: '로그아웃' }));
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument();
  });

  it('reports a failed logout without claiming that the active session ended', async () => {
    mockApi({
      ...business,
      'GET /api/admin/auth/me': production,
      'POST /api/admin/auth/logout': () => ({ status: 500, json: { error: 'internal error' } }),
    });
    render(<App />);
    await userEvent.click(await screen.findByRole('button', { name: '로그아웃' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '로그아웃하지 못했습니다. 다시 시도해 주세요.',
    );
    expect(screen.getByRole('link', { name: '현황' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '로그인' })).not.toBeInTheDocument();
  });

  it('checks me, logs in, confirms first credentials, and only then enters the app', async () => {
    const changed = { ...ADMIN, loginId: 'hr.new' };
    const calls = mockApi({
      ...business,
      'GET /api/admin/auth/me': absent,
      'POST /api/admin/auth/login': { ...firstLogin, expiresAt: '2026-10-29 17:00:00' },
      'POST /api/admin/auth/credentials': { admin: changed },
    });
    render(<App />);
    await screen.findByRole('heading', { name: '로그인' });
    expect(calls[0].path).toBe('/api/admin/auth/me');
    await userEvent.type(screen.getByLabelText('아이디'), 'boot.admin');
    await userEvent.type(screen.getByLabelText('비밀번호'), 'boot password');
    await userEvent.click(screen.getByRole('button', { name: '로그인' }));
    await screen.findByRole('heading', { name: '계정 정보 확인' });
    expect(screen.queryByRole('link', { name: '현황' })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('아이디'));
    await userEvent.type(screen.getByLabelText('아이디'), 'hr.new');
    await userEvent.type(screen.getByLabelText('현재 비밀번호'), 'boot password');
    await userEvent.type(screen.getByLabelText('새 비밀번호'), 'x');
    await userEvent.type(screen.getByLabelText('새 비밀번호 확인'), 'x');
    await userEvent.click(screen.getByRole('button', { name: '변경하고 계속' }));
    expect(await screen.findByRole('link', { name: '현황' })).toBeInTheDocument();
    expect(credentialPosts(calls).map((c) => c.body)).toEqual([
      { loginId: 'hr.new', currentPassword: 'boot password', newPassword: 'x' },
    ]);
    expect(screen.queryByRole('heading', { name: '계정 정보 확인' })).not.toBeInTheDocument();
  });

  it('me can resume the first-login screen and keep sends only the current password', async () => {
    const calls = mockApi({
      ...business,
      'GET /api/admin/auth/me': firstLogin,
      'POST /api/admin/auth/credentials': { admin: ADMIN },
    });
    render(<App />);
    await screen.findByRole('heading', { name: '계정 정보 확인' });
    await userEvent.clear(screen.getByLabelText('아이디'));
    await userEvent.type(screen.getByLabelText('아이디'), 'ignored.admin');
    await userEvent.type(screen.getByLabelText('새 비밀번호'), 'ignored fake');
    await userEvent.type(screen.getByLabelText('현재 비밀번호'), 'boot password');
    await userEvent.click(screen.getByRole('button', { name: '그대로 쓰기' }));
    expect(await screen.findByRole('link', { name: '현황' })).toBeInTheDocument();
    expect(credentialPosts(calls).map((c) => c.body)).toEqual([
      { currentPassword: 'boot password' },
    ]);
  });

  it('changing only the id omits newPassword instead of sending an empty string', async () => {
    const calls = mockApi({
      ...business,
      'GET /api/admin/auth/me': firstLogin,
      'POST /api/admin/auth/credentials': { admin: { ...ADMIN, loginId: 'hr.changed' } },
    });
    render(<App />);
    await screen.findByRole('heading', { name: '계정 정보 확인' });
    await userEvent.clear(screen.getByLabelText('아이디'));
    await userEvent.type(screen.getByLabelText('아이디'), 'hr.changed');
    await userEvent.type(screen.getByLabelText('현재 비밀번호'), 'boot password');
    await userEvent.click(screen.getByRole('button', { name: '변경하고 계속' }));
    await screen.findByRole('link', { name: '현황' });
    expect(credentialPosts(calls)[0].body).toEqual({
      loginId: 'hr.changed',
      currentPassword: 'boot password',
    });
  });

  for (const button of ['변경하고 계속', '그대로 쓰기']) {
    it(`${button} requires the current password locally`, async () => {
      const calls = mockApi({ 'GET /api/admin/auth/me': firstLogin });
      render(<App />);
      await screen.findByRole('heading', { name: '계정 정보 확인' });
      await userEvent.click(screen.getByRole('button', { name: button }));
      expect(await screen.findByText('현재 비밀번호를 입력해 주세요.')).toBeInTheDocument();
      expect(credentialPosts(calls)).toHaveLength(0);
    });
  }

  it('mismatched new passwords do not call the server', async () => {
    const calls = mockApi({ 'GET /api/admin/auth/me': firstLogin });
    render(<App />);
    await screen.findByRole('heading', { name: '계정 정보 확인' });
    await userEvent.type(screen.getByLabelText('현재 비밀번호'), 'boot password');
    await userEvent.type(screen.getByLabelText('새 비밀번호'), 'x');
    await userEvent.type(screen.getByLabelText('새 비밀번호 확인'), 'y');
    await userEvent.click(screen.getByRole('button', { name: '변경하고 계속' }));
    expect(await screen.findByText('새 비밀번호가 서로 다릅니다.')).toBeInTheDocument();
    expect(credentialPosts(calls)).toHaveLength(0);
  });

  for (const [status, message] of [
    [400, '아이디 형식과 비밀번호 입력을 확인해 주세요.'],
    [401, '현재 비밀번호가 맞지 않습니다. 다시 입력해 주세요.'],
    [409, '이미 있는 아이디입니다. 다른 아이디를 입력해 주세요.'],
  ] as const) {
    it(`credentials ${status} keeps the first-login screen and masks passwords again`, async () => {
      mockApi({
        'GET /api/admin/auth/me': firstLogin,
        'POST /api/admin/auth/credentials': () => ({ status, json: { error: 'test error' } }),
      });
      render(<App />);
      await screen.findByRole('heading', { name: '계정 정보 확인' });
      await userEvent.type(screen.getByLabelText('현재 비밀번호'), 'wrong fake');
      const field = screen.getByLabelText('현재 비밀번호').closest('label')!;
      await userEvent.click(within(field).getByRole('button', { name: '비밀번호 보기' }));
      await userEvent.click(screen.getByRole('button', { name: '변경하고 계속' }));
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(screen.getByLabelText('현재 비밀번호')).toHaveAttribute('type', 'password');
      expect(screen.queryByRole('link', { name: '현황' })).not.toBeInTheDocument();
    });
  }

  it('non-first login enters directly and carries appEnv from the login response', async () => {
    mockApi({
      ...business,
      'GET /api/admin/auth/me': absent,
      'POST /api/admin/auth/login': {
        ...production,
        appEnv: 'development',
        expiresAt: '2026-10-29 17:00:00',
      },
    });
    render(<App />);
    await screen.findByRole('heading', { name: '로그인' });
    await userEvent.type(screen.getByLabelText('아이디'), 'dev');
    await userEvent.type(screen.getByLabelText('비밀번호'), '1234');
    await userEvent.click(screen.getByRole('button', { name: '로그인' }));
    expect(await screen.findByRole('link', { name: '현황' })).toBeInTheDocument();
    expect(screen.queryByText('개발 모드')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '계정 정보 확인' })).not.toBeInTheDocument();
  });

  it('shows the 423 lock message on the login page', async () => {
    mockApi({
      'GET /api/admin/auth/me': absent,
      'POST /api/admin/auth/login': () => ({
        status: 423,
        json: { error: 'account locked, try again later' },
      }),
    });
    render(<App />);
    await screen.findByRole('heading', { name: '로그인' });
    await userEvent.type(screen.getByLabelText('아이디'), 'boot.admin');
    await userEvent.type(screen.getByLabelText('비밀번호'), 'wrong fake');
    await userEvent.click(screen.getByRole('button', { name: '로그인' }));
    expect(
      await screen.findByText('비밀번호를 5번 틀려 잠겼습니다. 10분 뒤 다시 시도해 주세요.'),
    ).toBeInTheDocument();
  });

  for (const appEnv of ['production', 'development'] as const) {
    it(`me restores ${appEnv} mode without a development marker`, async () => {
      mockApi({ ...business, 'GET /api/admin/auth/me': { ...production, appEnv } });
      render(<App />);
      for (const name of ['현황', '직원', '출입 기록', '설정', '작업 이력'])
        expect(await screen.findByRole('link', { name })).toBeInTheDocument();
      expect(screen.queryByText('개발 모드')).not.toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/대시보드|·/);
    });
  }

  it('a server error checking me is not mistaken for an expired login', async () => {
    mockApi({
      'GET /api/admin/auth/me': () => ({ status: 500, json: { error: 'internal error' } }),
    });
    render(<App />);
    expect(
      await screen.findByText('로그인 상태를 확인하지 못했습니다. 다시 시도해 주세요.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '로그인' })).not.toBeInTheDocument();
  });
});
