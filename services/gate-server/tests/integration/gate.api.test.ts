import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './harness.ts';

test('gate list for the quick-open screen', async () => {
  const { server, call } = await startServer();
  const gates = (await (await call('GET', '/api/admin/gates')).json()) as {
    gateKey: number;
    name: string;
  }[];
  assert.deepEqual(
    gates.map(({ gateKey, name }) => ({ gateKey, name })),
    [
      { gateKey: 1, name: '정문 1' },
      { gateKey: 2, name: '정문 2' },
    ],
  );
  assert.equal((await call('GET', '/api/admin/gates', undefined, {})).status, 401);
  server.close();
});

test('remote open for a visitor opens the gate and is logged with the admin', async () => {
  const { server, call, opened, repos } = await startServer();
  const res = await call('POST', '/api/admin/gates/2/open', {
    reason: 'VISITOR',
    visitor: { name: '방문객', company: '협력사', targetEmployeeKey: 7 },
  });
  assert.equal(res.status, 200);
  const { eventKey, result } = (await res.json()) as { eventKey: number; result: string };
  assert.equal(result, 'GRANTED');
  assert.deepEqual(opened, [2]);
  const [row] = repos.accessLogs.listAccessLogs(1);
  assert.equal(row.eventKey, eventKey);
  assert.equal(row.method, 'REMOTE');
  assert.equal(row.result, 'GRANTED');
  assert.equal(row.gateKey, 2);
  assert.equal(row.remoteReason, 'VISITOR');
  assert.equal(row.visitorName, '방문객');
  assert.equal(row.visitorCompany, '협력사');
  assert.equal(row.visitTargetKey, 7);
  assert.equal(row.adminKey, 1);
  assert.equal(row.openedAt, '2026-11-03 09:00:00.000');
  const [log] = (await (await call('GET', '/api/admin/audit-logs?limit=1')).json()).items as {
    action: string;
    target: string;
    detail: unknown;
  }[];
  assert.equal(log.action, 'REMOTE_OPEN');
  assert.equal(log.target, 'gate:2');
  assert.deepEqual(log.detail, { reason: 'VISITOR', eventKey, result: 'GRANTED' });
  server.close();
});

test('reason rules: visitor needs a name, OTHER needs a note', async () => {
  const { server, call, opened } = await startServer();
  const open = (body: unknown) => call('POST', '/api/admin/gates/1/open', body);
  assert.equal((await open({})).status, 400);
  assert.equal((await open({ reason: 'PARTY' })).status, 400);
  assert.equal((await open({ reason: 'VISITOR' })).status, 400);
  assert.equal((await open({ reason: 'VISITOR', visitor: { name: ' ' } })).status, 400);
  assert.equal((await open({ reason: 'OTHER' })).status, 400);
  assert.equal((await open({ reason: 'OTHER', note: 'x'.repeat(101) })).status, 400);
  assert.equal((await open({ reason: 'OTHER', note: '택배 기사' })).status, 200);
  assert.equal((await open({ reason: 'RECOGNITION_FAILED' })).status, 200);
  assert.deepEqual(opened, [1, 1]);
  server.close();
});

test('unknown gate is 404 and a relay failure is 502 GATE_ERROR', async () => {
  const ok = await startServer();
  assert.equal(
    (await ok.call('POST', '/api/admin/gates/9/open', { reason: 'RECOGNITION_FAILED' })).status,
    404,
  );
  assert.equal(
    (await ok.call('POST', '/api/admin/gates/x/open', { reason: 'RECOGNITION_FAILED' })).status,
    404,
  );
  ok.server.close();

  const broken = await startServer({ gateFails: true });
  const res = await broken.call('POST', '/api/admin/gates/1/open', {
    reason: 'RECOGNITION_FAILED',
  });
  assert.equal(res.status, 502);
  assert.equal(((await res.json()) as { result: string }).result, 'GATE_ERROR');
  assert.equal(broken.repos.accessLogs.listAccessLogs(1)[0].result, 'GATE_ERROR');
  broken.server.close();
});
