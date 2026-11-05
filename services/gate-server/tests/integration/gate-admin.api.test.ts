import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './harness.ts';

type GateView = {
  gateKey: number;
  name: string;
  adapter: { type: string };
  terminals: { terminalKey: number; name: string; connected: boolean; ip: string }[];
};

test('lists gates with their terminals and connection state, without secrets', async (t) => {
  const { server, call, connected } = await startServer();
  t.after(() => server.close());
  connected.add(101);
  const gates = (await (await call('GET', '/api/admin/gates')).json()) as GateView[];
  assert.deepEqual(
    gates.map((g) => [
      g.gateKey,
      g.name,
      g.adapter.type,
      g.terminals.map((x) => [x.terminalKey, x.connected, x.ip]),
    ]),
    [
      [1, '정문 1', 'MOCK', [[101, true, '10.0.0.5']]],
      [2, '정문 2', 'MOCK', [[102, false, '10.0.0.6']]],
    ],
  );
  const text = JSON.stringify(gates);
  assert.equal(/rtsp|token|password|hash/i.test(text), false);
});

test('creates, updates and deletes a gate with validation and audit', async (t) => {
  const { server, call, repos } = await startServer();
  t.after(() => server.close());
  const created = await call('POST', '/api/admin/gates', {
    name: ' 후문 ',
    adapter: { type: 'DRY_CONTACT', host: '10.0.0.50' },
  });
  assert.equal(created.status, 201);
  const gate = (await created.json()) as GateView & { adapter: unknown };
  assert.equal(gate.name, '후문');
  assert.deepEqual(gate.adapter, {
    type: 'DRY_CONTACT',
    host: '10.0.0.50',
    port: 502,
    unitId: 1,
    coil: 0,
    pulseMs: 500,
  });
  for (const bad of [
    { name: '', adapter: { type: 'MOCK' } },
    { name: 'x'.repeat(41), adapter: { type: 'MOCK' } },
    { name: 'x', adapter: { type: 'DRY_CONTACT', host: '999.0.0.1' } },
    { name: 'x', adapter: { type: 'DRY_CONTACT', host: '10.0.0.1', pulseMs: 50 } },
    { name: 'x', adapter: { type: 'DRY_CONTACT', host: '10.0.0.1', port: '502' } },
    { name: 'x', adapter: { type: 'RS485' } },
  ])
    assert.equal((await call('POST', '/api/admin/gates', bad)).status, 400, JSON.stringify(bad));
  const updated = await call('PATCH', `/api/admin/gates/${gate.gateKey}`, {
    name: '후문 1',
    adapter: { type: 'MOCK' },
  });
  assert.equal(((await updated.json()) as GateView).name, '후문 1');
  assert.equal(
    (await call('PATCH', '/api/admin/gates/999', { name: 'x', adapter: { type: 'MOCK' } })).status,
    404,
  );
  assert.equal((await call('PATCH', '/api/admin/gates/1', { name: '' })).status, 400);
  assert.equal((await call('DELETE', '/api/admin/gates/1')).status, 409); // 단말 101이 붙어 있음
  assert.equal((await call('DELETE', `/api/admin/gates/${gate.gateKey}`)).status, 200);
  assert.equal((await call('DELETE', `/api/admin/gates/${gate.gateKey}`)).status, 404);
  assert.deepEqual(
    repos.audits
      .list(10)
      .map((l) => l.action)
      .slice(0, 3),
    ['GATE_DELETE', 'GATE_UPDATE', 'GATE_CREATE'],
  );
});

test('a new gate can be opened right away (registry reloaded)', async (t) => {
  const { server, call, opened } = await startServer();
  t.after(() => server.close());
  const gate = (await (
    await call('POST', '/api/admin/gates', { name: '옆문', adapter: { type: 'MOCK' } })
  ).json()) as GateView;
  const res = await call('POST', `/api/admin/gates/${gate.gateKey}/open`, {
    reason: 'OTHER',
    note: '개방 시험',
  });
  assert.equal(res.status, 200);
  assert.deepEqual(opened, [gate.gateKey]);
});

test('renames, moves and unpairs a terminal; unpair disconnects it', async (t) => {
  const { server, call, disconnected, repos } = await startServer();
  t.after(() => server.close());
  assert.equal(
    (await call('PATCH', '/api/admin/terminals/101', { name: '로비 단말' })).status,
    200,
  );
  assert.equal((await call('PATCH', '/api/admin/terminals/101', { gateKey: 2 })).status, 200);
  assert.equal((await call('PATCH', '/api/admin/terminals/101', { gateKey: 99 })).status, 409);
  assert.equal((await call('PATCH', '/api/admin/terminals/101', {})).status, 400);
  assert.equal((await call('PATCH', '/api/admin/terminals/999', { name: 'x' })).status, 404);
  const gates = (await (await call('GET', '/api/admin/gates')).json()) as GateView[];
  assert.deepEqual(
    gates[1].terminals.map((x) => [x.terminalKey, x.name]),
    [
      [101, '로비 단말'],
      [102, '단말 102'],
    ],
  );
  assert.equal((await call('DELETE', '/api/admin/terminals/101')).status, 200);
  assert.deepEqual(disconnected, [101]);
  assert.equal(repos.gates.getTerminal(101), undefined);
  assert.equal((await call('DELETE', '/api/admin/terminals/101')).status, 404);
  assert.deepEqual(repos.audits.list(1)[0].detail, { gateKey: 2 });
});

test('gates carry a floor and an open-to-all flag, listed by floor', async (t) => {
  const { server, call } = await startServer();
  t.after(() => server.close());
  const make = (body: unknown) => call('POST', '/api/admin/gates', body);
  assert.equal((await make({ name: 'x', adapter: { type: 'MOCK' }, floor: 1.5 })).status, 400);
  assert.equal((await make({ name: 'x', adapter: { type: 'MOCK' }, openToAll: 'y' })).status, 400);
  const b1 = (await (
    await make({ name: '주차', adapter: { type: 'MOCK' }, floor: -1 })
  ).json()) as {
    floor: number;
    openToAll: boolean;
  };
  assert.deepEqual([b1.floor, b1.openToAll], [-1, false]);
  const lobby = (await (
    await make({ name: '로비', adapter: { type: 'MOCK' }, floor: 1, openToAll: true })
  ).json()) as { openToAll: boolean };
  assert.equal(lobby.openToAll, true);
  const list = (await (await call('GET', '/api/admin/gates')).json()) as { name: string }[];
  // 층 순(지하 먼저), 층 없는 게이트(시험용 정문 1, 2)는 뒤
  assert.deepEqual(
    list.map((g) => g.name),
    ['주차', '로비', '정문 1', '정문 2'],
  );
  const status = (await (await call('GET', '/api/admin/status')).json()) as {
    gates: { name: string; floor: number | null }[];
  };
  assert.equal(status.gates.find((g) => g.name === '주차')?.floor, -1);
});
