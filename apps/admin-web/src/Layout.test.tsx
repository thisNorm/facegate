import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { mockApi } from './test/mockApi';

beforeEach(() => {
  window.history.replaceState(null, '', '/employees/7');
  mockApi({
    'GET /api/admin/auth/me': {
      admin: { adminKey: 1, loginId: 'boot.admin', name: '김인사' },
      mustChangeCredentials: false,
      appEnv: 'production',
    },
    'GET /api/admin/employees/7': {
      employeeKey: 7,
      employeeNo: 'E7',
      name: '홍길동',
      department: '개발팀',
      status: 'ACTIVE',
      createdAt: '2026-10-29 09:00:00',
      consentAt: '2026-10-29 09:00:00',
      faces: [],
    },
    'GET /api/admin/employees': [],
    'POST /api/admin/auth/logout': () => ({ status: 500, json: { error: 'internal error' } }),
  });
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('layout', () => {
  it('keeps employees active on a detail route and opens the list from the keyboard', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '홍길동' });

    const sidebar = screen.getByRole('complementary', { name: '주 메뉴' });
    const menu = within(sidebar).getByRole('navigation', { name: '관리 메뉴' });
    const home = within(menu).getByRole('link', { name: '현황' });
    const employees = within(menu).getByRole('link', { name: '직원', current: 'page' });
    expect(home).not.toHaveAttribute('aria-current');

    await user.tab();
    expect(home).toHaveFocus();
    await user.tab();
    expect(employees).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: '직원' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/employees');
  });

  it('keeps the current page and administrator visible when logout fails', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '홍길동' });

    const header = screen.getByRole('banner');
    expect(within(header).queryByText('FaceGate')).not.toBeInTheDocument();
    expect(screen.getAllByText('FaceGate')).toHaveLength(1);
    expect(
      within(screen.getByRole('complementary', { name: '주 메뉴' })).getByText('FaceGate'),
    ).toBeInTheDocument();
    expect(within(header).getByText('김인사')).toBeInTheDocument();
    await user.click(within(header).getByRole('button', { name: '로그아웃' }));

    const main = within(screen.getByRole('main'));
    expect(await main.findByRole('alert')).toHaveTextContent(
      '로그아웃하지 못했습니다. 다시 시도해 주세요.',
    );
    expect(main.getByRole('heading', { name: '홍길동' })).toBeInTheDocument();
    expect(within(header).getByText('김인사')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/employees/7');
  });
});
