import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/mockApi';
import { EmployeePhones } from './EmployeePhones';

const phone = { phoneKey: 3, label: '아이폰', createdAt: '2026-11-04 10:00:00', lastUsedAt: null };

describe('EmployeePhones', () => {
  it('makes a one-time registration QR and revokes a phone', async () => {
    let list = [phone];
    const calls = mockApi({
      'GET /api/admin/employees/7/phones': () => ({ json: { enabled: true, phones: list } }),
      'POST /api/admin/employees/7/phone-invite': {
        url: 'https://gate.example.co.kr:8443/m/register?t=abc',
        expiresAt: '2026-11-05 10:00:00',
      },
      'DELETE /api/admin/phones/3': () => {
        list = [];
        return { json: { ok: true } };
      },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<EmployeePhones employeeKey={7} />);
    expect(await screen.findByText('아이폰')).toBeInTheDocument();
    expect(screen.getByText('없음')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '등록 링크 만들기' }));
    expect(await screen.findByAltText('핸드폰 등록 QR')).toBeInTheDocument();
    expect(screen.getByLabelText('등록 주소')).toHaveValue(
      'https://gate.example.co.kr:8443/m/register?t=abc',
    );

    await userEvent.click(screen.getByRole('button', { name: '해제' }));
    expect(await screen.findByText('등록된 핸드폰이 없습니다.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/admin/phones/3')).toBe(true);
  });

  it('says how to turn the feature on when the server has no phone address', async () => {
    mockApi({ 'GET /api/admin/employees/7/phones': { enabled: false, phones: [] } });
    render(<EmployeePhones employeeKey={7} />);
    expect(await screen.findByText(/PHONE_BASE_URL/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '등록 링크 만들기' })).toBeNull();
  });
});
