import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/mockApi';
import { AddTerminalDialog, pairUri } from './AddTerminalDialog';

const gate = { gateKey: 1, name: '정문', terminals: [{ terminalKey: 101 }] };
const later = (minutes: number) =>
  new Date(Date.now() + 9 * 3600_000 + minutes * 60_000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
const code = () => ({
  code: '482913',
  expiresAt: later(10),
  serverUrls: ['http://192.168.0.191:8080', 'http://127.0.0.1:8080'],
});
afterEach(() => vi.useRealTimers());

describe('AddTerminalDialog', () => {
  it('builds the QR content with every server candidate', () => {
    expect(pairUri('482913', ['http://192.168.0.191:18080', 'http://127.0.0.1:18080'])).toBe(
      'IGP1:482913:18080:192.168.0.191/127.0.0.1',
    );
  });

  it('shows a QR for a fresh code with the time left', async () => {
    mockApi({
      'POST /api/admin/gates/1/pair-codes': () => ({ status: 201, json: code() }),
      'GET /api/admin/gates': [gate],
    });
    render(<AddTerminalDialog gate={gate} onClose={() => {}} onPaired={() => {}} />);
    expect(await screen.findByRole('img', { name: '단말 연결 QR' })).toHaveAttribute(
      'src',
      expect.stringMatching(/^data:image\/png/),
    );
    expect(screen.getByText(/30~50cm/)).toBeInTheDocument();
    expect(screen.getByText(/남은 시간 (10:00|9:5\d)/)).toBeInTheDocument();
  });

  it('offers a new code when the current one has expired', async () => {
    mockApi({
      'POST /api/admin/gates/1/pair-codes': () => ({
        status: 201,
        json: { ...code(), expiresAt: later(-1) },
      }),
      'GET /api/admin/gates': [gate],
    });
    render(<AddTerminalDialog gate={gate} onClose={() => {}} onPaired={() => {}} />);
    expect(await screen.findByText(/코드가 만료되었습니다/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '새 코드' })).toBeInTheDocument();
  });

  it('pairs by number and explains failures', async () => {
    let reply: { status: number; json: unknown } = { status: 400, json: { error: 'WRONG_PIN' } };
    const calls = mockApi({
      'POST /api/admin/gates/1/pair-codes': () => ({ status: 201, json: code() }),
      'GET /api/admin/gates': [gate],
      'POST /api/admin/gates/1/terminals': () => reply,
    });
    const onPaired = vi.fn();
    render(<AddTerminalDialog gate={gate} onClose={() => {}} onPaired={onPaired} />);
    await userEvent.type(await screen.findByLabelText('단말 주소'), '192.168.0.59');
    await userEvent.type(screen.getByLabelText('연결 번호'), '482 913');
    await userEvent.click(screen.getByRole('button', { name: '연결' }));
    expect(await screen.findByText('연결 번호가 맞지 않습니다')).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/api/admin/gates/1/terminals')?.body).toEqual({
      address: '192.168.0.59',
      pin: '482913',
    });
    reply = { status: 502, json: { error: 'UNREACHABLE' } };
    await userEvent.click(screen.getByRole('button', { name: '연결' }));
    expect(await screen.findByText(/단말에 연결할 수 없습니다/)).toBeInTheDocument();
    reply = { status: 201, json: { terminalKey: 103 } };
    await userEvent.click(screen.getByRole('button', { name: '연결' }));
    await vi.waitFor(() => expect(onPaired).toHaveBeenCalledWith(103));
  });

  it('closes by itself once a new terminal shows up on the gate (QR path)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let terminals = [{ terminalKey: 101 }];
    mockApi({
      'POST /api/admin/gates/1/pair-codes': () => ({ status: 201, json: code() }),
      'GET /api/admin/gates': () => ({ json: [{ ...gate, terminals }] }),
    });
    const onPaired = vi.fn();
    render(<AddTerminalDialog gate={gate} onClose={() => {}} onPaired={onPaired} />);
    await screen.findByRole('img', { name: '단말 연결 QR' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(onPaired).not.toHaveBeenCalled();
    terminals = [{ terminalKey: 101 }, { terminalKey: 103 }];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(onPaired).toHaveBeenCalledWith(103);
  });
});
