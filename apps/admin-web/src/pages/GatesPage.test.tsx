import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { mockApi } from '../test/mockApi';
import { GatesPage } from './GatesPage';

const gates = [
  {
    gateKey: 1,
    name: '정문',
    adapter: {
      type: 'DRY_CONTACT',
      host: '10.0.0.50',
      port: 502,
      unitId: 1,
      coil: 0,
      pulseMs: 500,
    },
    terminals: [
      {
        terminalKey: 101,
        name: 'WF1589T',
        model: 'WF1589T',
        appVersion: '0.1.0',
        ip: '192.168.0.21',
        connected: true,
        lastSeenAt: '2026-11-03 09:00:00',
      },
      {
        terminalKey: 102,
        name: '보조',
        model: null,
        appVersion: null,
        ip: '192.168.0.22',
        connected: false,
        lastSeenAt: null,
      },
    ],
  },
  { gateKey: 2, name: '후문', adapter: { type: 'MOCK' }, terminals: [] },
];
const renderPage = () =>
  render(
    <MemoryRouter>
      <GatesPage />
    </MemoryRouter>,
  );
const rowOf = async (name: string) => within((await screen.findByText(name)).closest('tr')!);

describe('GatesPage', () => {
  it('lists gates, adapters and terminals with only problems emphasised', async () => {
    mockApi({ 'GET /api/admin/gates': gates });
    renderPage();
    const row = await rowOf('정문');
    expect(row.getByText('릴레이 10.0.0.50')).toBeInTheDocument();
    expect(row.getByText('연결')).not.toHaveClass('problem');
    expect(row.getByText('끊김')).toHaveClass('problem');
    expect((await rowOf('후문')).getByText('가짜')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/·/);
  });

  it('adds a relay gate with defaults filled in', async () => {
    const calls = mockApi({
      'GET /api/admin/gates': gates,
      'POST /api/admin/gates': () => ({
        status: 201,
        json: { gateKey: 3, name: '옆문', adapter: { type: 'MOCK' }, terminals: [] },
      }),
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '게이트 추가' }));
    await userEvent.type(screen.getByLabelText('이름'), '옆문');
    await userEvent.click(screen.getByLabelText('릴레이'));
    await userEvent.type(screen.getByLabelText('릴레이 IP'), '10.0.0.51');
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: '옆문',
      floor: null,
      openToAll: false,
      adapter: {
        type: 'DRY_CONTACT',
        host: '10.0.0.51',
        port: 502,
        unitId: 1,
        coil: 0,
        pulseMs: 500,
      },
    });
    expect(await screen.findByText('게이트를 추가했습니다.')).toBeInTheDocument();
  });

  it('sends floor and open-to-all, and lists the floor', async () => {
    const calls = mockApi({
      'GET /api/admin/gates': [
        {
          gateKey: 9,
          name: '로비',
          adapter: { type: 'MOCK' },
          floor: 1,
          openToAll: true,
          terminals: [],
        },
      ],
      'POST /api/admin/gates': () => ({
        status: 201,
        json: {
          gateKey: 3,
          name: '주차',
          adapter: { type: 'MOCK' },
          floor: -1,
          openToAll: false,
          terminals: [],
        },
      }),
    });
    renderPage();
    const lobby = await rowOf('로비');
    expect(lobby.getByText('1층')).toBeInTheDocument();
    expect(lobby.getByText('모든 사람')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '게이트 추가' }));
    await userEvent.type(screen.getByLabelText('이름'), '주차');
    await userEvent.type(screen.getByLabelText('층 (지하는 -1)'), '-1');
    await userEvent.click(screen.getByLabelText('모든 사람 통과 (로비 등 공용)'));
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      name: '주차',
      floor: -1,
      openToAll: true,
    });
  });

  it('explains why a gate with terminals cannot be deleted', async () => {
    mockApi({
      'GET /api/admin/gates': gates,
      'DELETE /api/admin/gates/1': () => ({ status: 409, json: { error: 'gate has terminals' } }),
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '정문 수정' }));
    await userEvent.click(screen.getByRole('button', { name: '삭제' }));
    expect(await screen.findByText('단말을 먼저 옮기거나 연결 해제하세요.')).toBeInTheDocument();
  });

  it('unpairs a terminal after confirming', async () => {
    const calls = mockApi({ 'GET /api/admin/gates': gates, 'DELETE /api/admin/terminals/101': {} });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'WF1589T 연결 해제' }));
    expect(screen.getByText(/연결 대기 화면으로 돌아가고/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '연결 해제' }));
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/admin/terminals/101')).toBe(
      true,
    );
    expect(await screen.findByText('WF1589T 연결을 해제했습니다.')).toBeInTheDocument();
  });

  it('moves a terminal to another gate', async () => {
    const calls = mockApi({ 'GET /api/admin/gates': gates, 'PATCH /api/admin/terminals/102': {} });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '보조 옮기기' }));
    await userEvent.selectOptions(screen.getByLabelText('옮길 게이트'), '2');
    await userEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ gateKey: 2 });
  });

  it('test-opens a gate with reason OTHER', async () => {
    const calls = mockApi({
      'GET /api/admin/gates': gates,
      'POST /api/admin/gates/2/open': { eventKey: 9, result: 'GRANTED' },
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: '후문 개방 시험' }));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      reason: 'OTHER',
      note: '개방 시험',
    });
    expect(await screen.findByText('후문에 개방 신호를 보냈습니다')).toBeInTheDocument();
  });
});
