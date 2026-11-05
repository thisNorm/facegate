import test from 'node:test';
import assert from 'node:assert/strict';
import { INGEST, contract, startServer, T0 } from './harness.ts';

const appearUnknown = contract('appear-unknown.json');

test('general settings start from defaults and need a login', async () => {
  const { server, call } = await startServer();
  assert.equal((await call('GET', '/api/admin/settings', undefined, {})).status, 401);
  assert.deepEqual(await (await call('GET', '/api/admin/settings')).json(), {
    duplicateWindowSec: 5,
    photoRetentionDays: 90,
  });
  server.close();
});

test('PUT changes only the given settings and writes the audit log', async () => {
  const { server, call } = await startServer();
  const res = await call('PUT', '/api/admin/settings', { photoRetentionDays: 30 });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { duplicateWindowSec: 5, photoRetentionDays: 30 });
  assert.deepEqual(await (await call('GET', '/api/admin/settings')).json(), {
    duplicateWindowSec: 5,
    photoRetentionDays: 30,
  });
  const [log] = (await (await call('GET', '/api/admin/audit-logs?limit=1')).json()).items as {
    action: string;
    detail: unknown;
  }[];
  assert.equal(log.action, 'SETTINGS_UPDATE');
  assert.deepEqual(log.detail, { photoRetentionDays: [90, 30] });
  // 같은 값으로 다시 저장하면 이력을 남기지 않는다
  await call('PUT', '/api/admin/settings', { photoRetentionDays: 30 });
  const count = (await (await call('GET', '/api/admin/audit-logs')).json()).total;
  await call('PUT', '/api/admin/settings', { photoRetentionDays: 30 });
  assert.equal((await (await call('GET', '/api/admin/audit-logs')).json()).total, count);
  server.close();
});

test('PUT without any known setting is 400 and leaves no audit row', async () => {
  const { server, call } = await startServer();
  for (const body of [{}, { unknown: 1 }])
    assert.equal((await call('PUT', '/api/admin/settings', body)).status, 400);
  const logs = (await (await call('GET', '/api/admin/audit-logs')).json()).items as {
    action: string;
  }[];
  assert.ok(!logs.some((l) => l.action === 'SETTINGS_UPDATE'));
  server.close();
});

test('out-of-range or non-integer values are 400 and change nothing', async () => {
  const { server, call } = await startServer();
  for (const body of [
    { duplicateWindowSec: 0 },
    { duplicateWindowSec: 61 },
    { duplicateWindowSec: 1.5 },
    { duplicateWindowSec: '5' },
    { photoRetentionDays: 6 },
    { photoRetentionDays: 366 },
    { duplicateWindowSec: 10, photoRetentionDays: 400 },
  ])
    assert.equal(
      (await call('PUT', '/api/admin/settings', body)).status,
      400,
      JSON.stringify(body),
    );
  assert.deepEqual(await (await call('GET', '/api/admin/settings')).json(), {
    duplicateWindowSec: 5,
    photoRetentionDays: 90,
  });
  server.close();
});

test('the AI duplicate window follows the setting', async () => {
  const { server, call, repos, setNow } = await startServer();
  const appear = () => call('POST', '/api/modules/camera/ai/face/appear', appearUnknown, INGEST);
  await call('PUT', '/api/admin/settings', { duplicateWindowSec: 1 });
  await appear();
  setNow(new Date(T0.getTime() + 2000));
  await appear();
  assert.equal(repos.accessLogs.listAccessLogs(10).length, 2);

  await call('PUT', '/api/admin/settings', { duplicateWindowSec: 10 });
  setNow(new Date(T0.getTime() + 60_000));
  await appear();
  setNow(new Date(T0.getTime() + 62_000));
  await appear();
  assert.equal(repos.accessLogs.listAccessLogs(10).length, 3);
  server.close();
});
