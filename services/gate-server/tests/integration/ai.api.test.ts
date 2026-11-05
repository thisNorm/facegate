import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../../src/infrastructure/database/database.ts';
import { createRepositories } from '../../src/app/repositories.ts';
import { createServer } from '../../src/app/server.ts';
import { loginAsAdmin } from './admin-session.ts';
import { photoSet, seedTestOrgs } from './harness.ts';
import { createSettingService } from '../../src/modules/setting/setting.service.ts';
import type { Gate } from '../../src/modules/gate/gate.types.ts';
import type {
  DecisionMessage,
  TerminalMessage,
} from '../../src/modules/terminal/terminal.types.ts';
import { testRegistry } from './registry.ts';
import type { FileGate } from '../../src/app/config.ts';

const contract = (name: string) =>
  JSON.parse(
    fs.readFileSync(new URL(`../../../../contracts/examples/${name}`, import.meta.url), 'utf8'),
  );
const appearWorker = contract('appear-worker.json');
const appearUnknown = contract('appear-unknown.json');
const decisionGranted = contract('decision-granted.json');
const decisionUnregistered = contract('decision-unregistered.json');
const JPEG: string = appearWorker.full_frame;
const INGEST = { 'X-Ingest-Key': 'ingest' };

async function start({
  gateFails = false,
  gateFailsOnce = false,
  gateDelayMs = 0,
  ingestKey = 'ingest' as string | undefined,
} = {}) {
  let failuresLeft = gateFailsOnce ? 1 : 0;
  const fileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'facegate-'));
  const config = { ingestKey, fileDir, duplicateWindowMs: 5000 };
  const sql = openDatabase(':memory:');
  const repos = createRepositories(sql);
  seedTestOrgs(repos);
  const gates: FileGate[] = [
    {
      gateKey: 1,
      name: 'g1',
      adapter: { type: 'MOCK' },
      terminals: [
        { terminalKey: 101, token: 'device-token', rtspUri: 'rtsp://gate101:pw@10.0.0.5:8555/' },
      ],
    },
  ];
  const opened: number[] = [];
  const sent: { gateKey: number; message: DecisionMessage }[] = [];
  const gateControl = {
    async open(gate: Gate) {
      if (gateFails || failuresLeft-- > 0) throw new Error('relay down');
      if (gateDelayMs) await new Promise((resolve) => setTimeout(resolve, gateDelayMs));
      opened.push(gate.gateKey);
    },
    async releaseAll() {},
  };
  const terminalHub = {
    handleUpgrade() {},
    isConnected: () => false,
    disconnect() {},
    broadcast(gateKey: number, message: TerminalMessage) {
      if (message.type !== 'decision') return;
      sent.push({ gateKey, message });
    },
  };
  const server = await createServer({
    config,
    repos,
    registry: testRegistry(repos, gates),
    gateControl,
    terminalHub,
    now: () => new Date('2026-10-27T23:51:03.250Z'),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = INGEST,
  ) =>
    fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const admin = await loginAsAdmin(repos, base);
  return { server, repos, sql, opened, sent, call, admin };
}

test('AI API requires ingest key', async () => {
  const { server, call } = await start();
  assert.equal((await call('GET', '/api/modules/camera/ai/rtsp', undefined, {})).status, 401);
  const res = await call('GET', '/api/modules/camera/ai/rtsp');
  assert.deepEqual(await res.json(), [
    { device_key: 101, rtsp_uri: 'rtsp://gate101:pw@10.0.0.5:8555/' },
  ]);
  server.close();
});

test('admin issues an ingest key that is shown once and stored hashed', async () => {
  const { server, sql, call, admin } = await start({ ingestKey: '' });
  const empty = await (
    await call('GET', '/api/admin/settings/ingest-key', undefined, admin)
  ).json();
  assert.deepEqual(empty, { issued: false, hint: null, issuedAt: null });

  const res = await call('POST', '/api/admin/settings/ingest-key', undefined, admin);
  assert.equal(res.status, 201);
  const { key, issuedAt } = (await res.json()) as { key: string; issuedAt: string };
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(issuedAt, '2026-10-28 08:51:03');

  const info = await (await call('GET', '/api/admin/settings/ingest-key', undefined, admin)).json();
  assert.deepEqual(info, { issued: true, hint: key.slice(-4), issuedAt });
  assert.ok(!JSON.stringify(sql.prepare('SELECT * FROM setting').all()).includes(key));
  server.close();
});

test('only the latest issued ingest key works', async () => {
  const { server, call, admin } = await start({ ingestKey: '' });
  const rtsp = (key: string) =>
    call('GET', '/api/modules/camera/ai/rtsp', undefined, { 'X-Ingest-Key': key });
  assert.equal((await call('GET', '/api/modules/camera/ai/rtsp')).status, 401);
  const issue = async () =>
    (
      (await (await call('POST', '/api/admin/settings/ingest-key', undefined, admin)).json()) as {
        key: string;
      }
    ).key;
  const first = await issue();
  assert.equal((await rtsp(first)).status, 200);
  const second = await issue();
  assert.equal((await rtsp(first)).status, 401);
  assert.equal((await rtsp(second)).status, 200);
  server.close();
});

test('INGEST_KEY seeds the first key and is ignored once a key exists', async () => {
  const { server, call, repos, admin } = await start();
  const info = await (await call('GET', '/api/admin/settings/ingest-key', undefined, admin)).json();
  assert.deepEqual(info, { issued: true, hint: 'gest', issuedAt: '2026-10-28 08:51:03' });
  server.close();

  const service = createSettingService({ settings: repos.settings });
  service.seedIngestKey('other-seed');
  assert.equal(service.verifyIngestKey('ingest'), true);
  assert.equal(service.verifyIngestKey('other-seed'), false);
});

test('ingest key admin endpoints require an admin login', async () => {
  const { server, call } = await start();
  for (const method of ['GET', 'POST'])
    assert.equal(
      (await call(method, '/api/admin/settings/ingest-key', undefined, INGEST)).status,
      401,
    );
  server.close();
});

test('registered employee photos become the dataset and are downloadable', async () => {
  const { server, call, admin } = await start();
  assert.equal((await call('GET', '/api/modules/camera/ai/face/dataset')).status, 204);
  const body = {
    employeeNo: 'E1',
    name: '홍길동',
    department: '개발팀',
    photos: photoSet(),
    consent: true,
  };
  const created = await call('POST', '/api/admin/employees', body, admin);
  assert.equal(created.status, 200);
  const { employeeKey } = (await created.json()) as {
    employeeKey: number;
  };
  const dataset = (await (await call('GET', '/api/modules/camera/ai/face/dataset')).json()) as {
    worker_key: number;
    image_path: string[];
  }[];
  assert.equal(dataset.length, 1);
  assert.equal(dataset[0].worker_key, employeeKey);
  assert.equal(dataset[0].image_path.length, 6);
  const stored = [];
  for (const url of dataset[0].image_path) {
    const image = await call('GET', url);
    assert.equal(image.status, 200);
    stored.push(
      'data:image/jpeg;base64,' + Buffer.from(await image.arrayBuffer()).toString('base64'),
    );
  }
  assert.deepEqual(stored.sort(), photoSet().sort());
  assert.equal((await call('GET', dataset[0].image_path[0], undefined, {})).status, 401);
  server.close();
});

test('appear of active employee opens gate and sends the granted contract', async () => {
  const { server, repos, opened, sent, call } = await start();
  repos.employees.addEmployee({ employeeNo: 'E1', name: '홍길동', department: '개발팀' });
  const res = await call('POST', '/api/modules/camera/ai/face/appear', appearWorker);
  const { event_key } = (await res.json()) as { event_key: number };
  assert.deepEqual(opened, [1]);
  assert.deepEqual(sent[0], { gateKey: 1, message: { ...decisionGranted, event_key } });
  const [row] = repos.accessLogs.listAccessLogs(1);
  assert.equal(row.receivedAt, '2026-10-28 08:51:03.250');
  assert.equal(row.openedAt, '2026-10-28 08:51:03.250');
  await call('POST', '/api/modules/camera/ai/face/appear', appearWorker);
  assert.equal(opened.length, 1, 'repeated appear is merged into the same visit');
  server.close();
});

const APPEAR = '/api/modules/camera/ai/face/appear';
const eventKeyOf = async (res: Response) => ((await res.json()) as { event_key: number }).event_key;

test('repeated worker appear merges into one visit', async () => {
  const { server, repos, opened, sent, call } = await start();
  repos.employees.addEmployee({ employeeNo: 'E1', name: '홍길동' });
  const first = await eventKeyOf(await call('POST', APPEAR, appearWorker));
  const second = await eventKeyOf(await call('POST', APPEAR, appearWorker));
  assert.equal(second, first);
  assert.equal(repos.accessLogs.listAccessLogs(10).length, 1);
  assert.equal(opened.length, 1);
  assert.equal(sent.length, 1);
  server.close();
});

test('repeated unknown appear merges into one visit', async () => {
  const { server, repos, sent, call } = await start();
  const first = await eventKeyOf(await call('POST', APPEAR, appearUnknown));
  const second = await eventKeyOf(await call('POST', APPEAR, appearUnknown));
  assert.equal(second, first);
  assert.equal(repos.accessLogs.listAccessLogs(10).length, 1);
  assert.equal(sent.length, 1);
  server.close();
});

test('concurrent appears share one open and one event_key', async () => {
  const { server, repos, opened, call } = await start({ gateDelayMs: 20 });
  repos.employees.addEmployee({ employeeNo: 'E1', name: '홍길동' });
  const [a, b] = await Promise.all([
    call('POST', APPEAR, appearWorker),
    call('POST', APPEAR, appearWorker),
  ]);
  assert.equal(await eventKeyOf(a), await eventKeyOf(b));
  assert.equal(opened.length, 1);
  server.close();
});

test('appear after a GATE_ERROR retries the open', async () => {
  const { server, repos, opened, sent, call } = await start({ gateFailsOnce: true });
  repos.employees.addEmployee({ employeeNo: 'E1', name: '홍길동' });
  const first = await eventKeyOf(await call('POST', APPEAR, appearWorker));
  const second = await eventKeyOf(await call('POST', APPEAR, appearWorker));
  assert.notEqual(second, first);
  assert.deepEqual(opened, [1]);
  assert.deepEqual(
    sent.map((s) => s.message.result),
    ['GATE_ERROR', 'GRANTED'],
  );
  server.close();
});

test('unknown face does not open and sends the unregistered contract', async () => {
  const { server, opened, sent, call } = await start();
  const res = await call('POST', '/api/modules/camera/ai/face/appear', appearUnknown);
  const { event_key } = (await res.json()) as { event_key: number };
  assert.deepEqual(opened, []);
  assert.deepEqual(sent[0].message, { ...decisionUnregistered, event_key });
  server.close();
});

test('relay failure becomes GATE_ERROR without name', async () => {
  const { server, repos, sent, call } = await start({ gateFails: true });
  repos.employees.addEmployee({ employeeNo: 'E1', name: '홍길동' });
  await call('POST', '/api/modules/camera/ai/face/appear', appearWorker);
  assert.equal(sent[0].message.result, 'GATE_ERROR');
  assert.equal('name' in sent[0].message, false);
  assert.equal(repos.accessLogs.listAccessLogs(1)[0].openedAt, null);
  server.close();
});

test('bad appear body and unknown terminal (device_key) are 400', async () => {
  const { server, call } = await start();
  const unknownTerminal = await call('POST', '/api/modules/camera/ai/face/appear', {
    ...appearWorker,
    device_key: 999,
  });
  assert.equal(unknownTerminal.status, 400);
  const badTime = await call('POST', '/api/modules/camera/ai/face/appear', {
    ...appearWorker,
    appear_time: 'yesterday',
  });
  assert.equal(badTime.status, 400);
  server.close();
});

test('disappear, power-on and status are stored', async () => {
  const { server, repos, call } = await start();
  const appeared = await call('POST', '/api/modules/camera/ai/face/appear', appearUnknown);
  const { event_key } = (await appeared.json()) as { event_key: number };
  const disappear = {
    event_key,
    disappear_time: '2026-10-28 08:51:09',
    duration_time: 7,
    full_frame: JPEG,
    crop_frame: JPEG,
  };
  assert.equal(
    (await call('POST', '/api/modules/camera/ai/face/disappear', disappear)).status,
    201,
  );
  assert.equal(repos.accessLogs.listAccessLogs(1)[0].durationSec, 7);
  await call('POST', '/api/modules/camera/ai/power-on', { event_time: '2026-10-28 08:00:00' });
  await call('POST', '/api/modules/camera/ai/status', {
    event_time: '2026-10-28 08:01:00',
    cameras: [{ device_key: 101, rtsp_ok: true }],
  });
  // 온라인 판단은 연동 문서대로 서버 수신 시각으로 저장 → 고정한 now의 KST 값
  assert.equal(repos.aiStatus.getStatus()?.lastStatusAt, '2026-10-28 08:51:03');
  server.close();
});

test('appear with an impossible date is rejected', async () => {
  const { server, call } = await start();
  const res = await call('POST', '/api/modules/camera/ai/face/appear', {
    ...appearWorker,
    appear_time: '2026-13-45 99:99:99',
  });
  assert.equal(res.status, 400);
  server.close();
});

test('concurrent appears for one employee open the gate once', async () => {
  const { server, repos, opened, sent, call } = await start({ gateDelayMs: 20 });
  repos.employees.addEmployee({ employeeNo: 'E1', name: '홍길동', department: '개발팀' });
  await Promise.all([
    call('POST', '/api/modules/camera/ai/face/appear', appearWorker),
    call('POST', '/api/modules/camera/ai/face/appear', appearWorker),
  ]);
  assert.equal(opened.length, 1);
  assert.equal(sent.filter((s) => s.message.result === 'GRANTED').length, 1);
  server.close();
});

test('access-logs limit of 1 returns one item and a non-positive limit is rejected', async () => {
  const { server, call, admin } = await start();
  await call('POST', APPEAR, appearUnknown);
  await call('POST', APPEAR, { ...appearUnknown, worker_key: 999 });
  assert.equal(
    (await call('GET', '/api/admin/access-logs?limit=-1', undefined, admin)).status,
    400,
  );
  const res = await call('GET', '/api/admin/access-logs?limit=1', undefined, admin);
  assert.equal(((await res.json()) as { items: unknown[] }).items.length, 1);
  server.close();
});

test('unexpected errors become a JSON 500 without details', async () => {
  const { server, call, admin, repos } = await start();
  repos.employees.listEmployees = () => {
    throw new Error('disk on fire');
  };
  const res = await call('GET', '/api/admin/employees', undefined, admin);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'internal error' });
  server.close();
});

test('access logs require an admin login', async () => {
  const { server, call } = await start();
  assert.equal((await call('GET', '/api/admin/access-logs', undefined, {})).status, 401);
  server.close();
});

test('retired employee photos leave the dataset and are removed', async () => {
  const { server, call, admin } = await start();
  const body = {
    employeeNo: 'E1',
    name: '홍길동',
    photos: photoSet(),
    consent: true,
  };
  const created = await call('POST', '/api/admin/employees', body, admin);
  assert.equal(created.status, 200);
  const { employeeKey } = (await created.json()) as { employeeKey: number };
  const dataset = (await (await call('GET', '/api/modules/camera/ai/face/dataset')).json()) as {
    image_path: string[];
  }[];
  assert.equal(dataset.length, 1);
  assert.equal(dataset[0].image_path.length, 6);
  const retired = await call(
    'POST',
    `/api/admin/employees/${employeeKey}/retire`,
    undefined,
    admin,
  );
  assert.equal(retired.status, 200);
  assert.equal((await call('GET', '/api/modules/camera/ai/face/dataset')).status, 204);
  for (const url of dataset[0].image_path) assert.equal((await call('GET', url)).status, 404);
  server.close();
});

test('malformed JSON is a JSON 400, not 500', async () => {
  const { server } = await start();
  const res = await fetch(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/modules/camera/ai/face/appear`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', ...INGEST }, body: '{bad' },
  );
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'bad request' });
  server.close();
});

test('a worker without a right to the gate is denied and the terminal is told', async () => {
  const { server, repos, opened, sent, call, admin } = await start();
  repos.employees.addEmployee({ employeeNo: 'E1', name: '홍길동', department: '개발팀' });
  // 관리자 API로 바꿔야 서버의 게이트 목록(registry)도 다시 읽힌다
  const gate = { name: '정문 1', adapter: { type: 'MOCK' }, floor: 3, openToAll: false };
  assert.equal((await call('PATCH', '/api/admin/gates/1', gate, admin)).status, 200);
  await call('POST', APPEAR, appearWorker);
  assert.deepEqual(opened, []);
  assert.equal(sent.at(-1)?.message.result, 'DENIED_GATE');
  assert.equal(sent.at(-1)?.message.name, undefined);
  server.close();
});

test('a worker in a group for the gate is denied outside its schedule as DENIED_TIME', async () => {
  const { server, repos, opened, sent, call, admin } = await start();
  repos.employees.addEmployee({ employeeNo: 'E1', name: '홍길동', department: '개발팀' });
  const gate = { name: '정문 1', adapter: { type: 'MOCK' }, floor: 3, openToAll: false };
  assert.equal((await call('PATCH', '/api/admin/gates/1', gate, admin)).status, 200);
  // 지금(화요일 09시)은 막힌 시간표
  const closed = repos.permissions.createSchedule(
    '밤',
    Array(8).fill({ start: '20:00', end: '24:00' }),
    '2026-11-03 09:00:00',
  );
  const dev = repos.orgs.getByName('개발팀')!.orgKey;
  repos.permissions.createGroup(
    { name: '개발팀 밤', scheduleKey: closed, gateKeys: [1], orgKeys: [dev], employeeKeys: [] },
    '2026-11-03 09:00:00',
  );
  await call('POST', APPEAR, appearWorker);
  assert.deepEqual(opened, []);
  assert.equal(sent.at(-1)?.message.result, 'DENIED_TIME');
  server.close();
});
