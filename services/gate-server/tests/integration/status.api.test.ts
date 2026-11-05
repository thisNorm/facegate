import test from 'node:test';
import assert from 'node:assert/strict';
import { INGEST, startServer, T0 } from './harness.ts';

test('status before the AI has reported', async () => {
  const { server, call } = await startServer();
  assert.deepEqual(await (await call('GET', '/api/admin/status')).json(), {
    checkedAt: '2026-11-03 09:00:00',
    ai: { online: false, powerOnAt: null, lastStatusAt: null },
    ingestKeyIssued: true,
    gates: [
      {
        gateKey: 1,
        name: '정문 1',
        floor: null,
        adapterType: 'MOCK',
        terminals: [{ terminalKey: 101, connected: false, aiRtspOk: null }],
      },
      {
        gateKey: 2,
        name: '정문 2',
        floor: null,
        adapterType: 'MOCK',
        terminals: [{ terminalKey: 102, connected: false, aiRtspOk: null }],
      },
    ],
  });
  assert.equal((await call('GET', '/api/admin/status', undefined, {})).status, 401);
  server.close();
});

test('AI is online for 3 minutes after a status report, with terminal video states', async () => {
  const { server, call, connected, setNow } = await startServer();
  connected.add(101);
  await call(
    'POST',
    '/api/modules/camera/ai/power-on',
    { event_time: '2026-11-03 08:59:00' },
    INGEST,
  );
  await call(
    'POST',
    '/api/modules/camera/ai/status',
    {
      event_time: '2026-11-03 09:00:00',
      cameras: [
        { device_key: 101, rtsp_ok: true },
        { device_key: 102, rtsp_ok: false },
      ],
    },
    INGEST,
  );
  const snapshot = async () =>
    (await (await call('GET', '/api/admin/status')).json()) as {
      ai: { online: boolean; powerOnAt: string | null };
      gates: { terminals: { connected: boolean; aiRtspOk: boolean | null }[] }[];
    };
  let s = await snapshot();
  assert.equal(s.ai.online, true);
  assert.equal(s.ai.powerOnAt, '2026-11-03 08:59:00');
  assert.deepEqual(
    s.gates.map((g) => g.terminals[0].connected),
    [true, false],
  );
  assert.deepEqual(
    s.gates.map((g) => g.terminals[0].aiRtspOk),
    [true, false],
  );

  setNow(new Date(T0.getTime() + 3 * 60_000));
  assert.equal((await snapshot()).ai.online, true);
  setNow(new Date(T0.getTime() + 3 * 60_000 + 1000));
  s = await snapshot();
  assert.equal(s.ai.online, false);
  assert.deepEqual(
    s.gates.map((g) => g.terminals[0].aiRtspOk),
    [null, null],
  ); // 오프라인이면 AI 영상 수신 상태도 모름
  server.close();
});
