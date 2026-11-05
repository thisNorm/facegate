import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi } from '../test/mockApi';
import { VisitorCalls } from './VisitorCalls';

const call = {
  callKey: 7,
  gateKey: 1,
  terminalKey: 101,
  hasPhoto: true,
  createdAt: '2026-11-03 09:30:00',
};

describe('VisitorCalls', () => {
  it('shows a pending call with its photo and acknowledges it', async () => {
    const calls = mockApi({
      'GET /api/admin/visitor-calls': [call],
      'POST /api/admin/visitor-calls/7/ack': { ok: true },
    });
    render(<VisitorCalls gateName={() => '정문'} />);
    expect(await screen.findByText('정문 방문객 호출')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '정문 방문객 사진' })).toHaveAttribute(
      'src',
      '/api/admin/visitor-calls/7/photo',
    );
    await userEvent.click(screen.getByRole('button', { name: '확인' }));
    expect(screen.queryByText('정문 방문객 호출')).not.toBeInTheDocument();
    expect(
      calls.some((c) => c.method === 'POST' && c.path === '/api/admin/visitor-calls/7/ack'),
    ).toBe(true);
  });

  it('shows nothing when no one is calling', async () => {
    const calls = mockApi({ 'GET /api/admin/visitor-calls': [] });
    const { container } = render(<VisitorCalls gateName={() => '정문'} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(1);
    expect(container).toBeEmptyDOMElement();
  });
});
