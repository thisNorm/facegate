import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../test/mockApi';
import { TerminalVideo } from './TerminalVideo';

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

const frame =
  (ageMs = 0) =>
  () =>
    new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
      headers: { 'Content-Type': 'image/jpeg', 'X-Frame-Age-Ms': String(ageMs) },
    });

const frameCalls = (calls: { path: string }[], path: string) =>
  calls.filter((call) => call.path === path).length;

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('TerminalVideo', () => {
  it('shows the latest frame and polls every 0.15 s with one request at a time', async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const calls = mockApi({
      'GET /api/admin/terminals/101/frame': () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(frame(100)());
        }),
    });
    render(<TerminalVideo terminalKeys={[101]} />);
    await advance(0);
    const path = '/api/admin/terminals/101/frame';
    expect(frameCalls(calls, path)).toBe(1);
    expect(screen.getByText('영상 확인 중')).toBeInTheDocument();
    await advance(1000);
    expect(frameCalls(calls, path)).toBe(1);
    await act(async () => release!());
    expect(screen.getByRole('img', { name: '단말 101 실시간 영상' })).toHaveAttribute(
      'src',
      expect.stringMatching(/^blob:/),
    );
    expect(screen.getByText('실시간 영상')).toBeInTheDocument();
    await advance(149);
    expect(frameCalls(calls, path)).toBe(1);
    await advance(1);
    expect(frameCalls(calls, path)).toBe(2);
  });

  it('hides a frame older than 2 s', async () => {
    vi.useFakeTimers();
    mockApi({
      'GET /api/admin/terminals/101/frame': frame(2001),
    });
    render(<TerminalVideo terminalKeys={[101]} />);
    await advance(0);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('영상 끊김')).toBeInTheDocument();
  });

  it('hides the last frame when the next one does not arrive in time', async () => {
    vi.useFakeTimers();
    let replies = 0;
    mockApi({
      'GET /api/admin/terminals/101/frame': () =>
        replies++ === 0 ? frame(500)() : new Promise<Response>(() => {}),
    });
    render(<TerminalVideo terminalKeys={[101]} />);
    await advance(0);
    expect(screen.getByRole('img')).toBeInTheDocument();
    await advance(1499);
    expect(screen.getByRole('img')).toBeInTheDocument();
    await advance(1);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('영상 끊김')).toBeInTheDocument();
  });

  it('shows a plain status on failure and recovers on its own', async () => {
    vi.useFakeTimers();
    let fail = true;
    mockApi({
      'GET /api/admin/terminals/101/frame': () =>
        fail ? { status: 503, json: { error: 'terminal video unavailable' } } : frame()(),
    });
    render(<TerminalVideo terminalKeys={[101]} />);
    await advance(0);
    expect(screen.getByText('영상 끊김')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    fail = false;
    await advance(500);
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('stops polling while the page is hidden and after unmount', async () => {
    vi.useFakeTimers();
    const calls = mockApi({
      'GET /api/admin/terminals/101/frame': frame(),
    });
    const path = '/api/admin/terminals/101/frame';
    const { unmount } = render(<TerminalVideo terminalKeys={[101]} />);
    await advance(0);
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    await advance(5000);
    const hidden = frameCalls(calls, path);
    expect(hidden).toBeLessThanOrEqual(2);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(frameCalls(calls, path)).toBe(hidden + 1);
    unmount();
    await advance(5000);
    expect(frameCalls(calls, path)).toBe(hidden + 1);
  });

  it('does not request frames while inactive', async () => {
    const calls = mockApi({ 'GET /api/admin/terminals/109/frame': frame() });
    render(<TerminalVideo terminalKeys={[109]} active={false} />);
    expect(screen.getByText('영상 대기')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('switches terminals and falls back when a remembered terminal is gone', async () => {
    const calls = mockApi({
      'GET /api/admin/terminals/109/frame': frame(),
      'GET /api/admin/terminals/209/frame': frame(),
    });
    const { rerender } = render(<TerminalVideo terminalKeys={[109, 209]} />);
    await screen.findByRole('img', { name: '단말 109 실시간 영상' });
    await userEvent.selectOptions(screen.getByLabelText('단말'), '209');
    await screen.findByRole('img', { name: '단말 209 실시간 영상' });
    expect(calls.every((call) => !call.path.includes('rtsp'))).toBe(true);
    rerender(<TerminalVideo terminalKeys={[109]} />);
    await screen.findByRole('img', { name: '단말 109 실시간 영상' });
    expect(screen.queryByLabelText('단말')).not.toBeInTheDocument();
  });

  it('says so when the gate has no terminal', () => {
    const calls = mockApi({});
    render(<TerminalVideo terminalKeys={[]} />);
    expect(screen.getByText('연결된 단말이 없습니다.')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});
