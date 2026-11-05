import test from 'node:test';
import assert from 'node:assert/strict';
import { JPEG, photoSet, startServer } from './harness.ts';

const TERMINAL = { Authorization: 'Bearer device-token' };

/** 단말 안 얼굴 인식 (D-63): 설정을 단말로 바꾸면 단말이 등록 사진을 받고 appear를 보낸다 */
async function setUp(t: test.TestContext) {
  const ctx = await startServer();
  t.after(() => ctx.server.close());
  const person = {
    employeeNo: 'F001',
    name: '김얼굴',
    department: '개발팀',
    photos: photoSet(2),
    consent: true,
  };
  const { employeeKey } = await (await ctx.call('POST', '/api/admin/employees', person)).json();
  const terminal = (method: string, url: string, body?: unknown) =>
    ctx.call(method, `/api/terminal${url}`, body, TERMINAL);
  return { ...ctx, employeeKey, terminal };
}

test('face on terminal is off by default and hands out no photos', async (t) => {
  const { terminal, call } = await setUp(t);
  assert.deepEqual(await (await call('GET', '/api/admin/settings/face-engine')).json(), {
    engine: 'AI_SERVER',
  });
  assert.deepEqual(await (await terminal('GET', '/face/dataset')).json(), {
    enabled: false,
    faces: [],
  });
  const appear = await terminal('POST', '/face/appear', {
    worker_key: 1,
    is_worker: true,
    appear_time: '2026-11-03 09:00:00',
  });
  assert.equal(appear.status, 409);
  // 단말 토큰 없이는 못 본다
  assert.equal((await call('GET', '/api/terminal/face/dataset', undefined, {})).status, 401);
});

test('terminal recognition opens the gate of that terminal like the AI server', async (t) => {
  const { terminal, call, employeeKey, opened, broadcasts, repos } = await setUp(t);
  const put = await call('PUT', '/api/admin/settings/face-engine', { engine: 'TERMINAL' });
  assert.deepEqual(await put.json(), { engine: 'TERMINAL' });
  assert.equal((await call('PUT', '/api/admin/settings/face-engine', { engine: 'X' })).status, 400);

  const dataset = await (await terminal('GET', '/face/dataset')).json();
  assert.equal(dataset.enabled, true);
  assert.equal(dataset.faces.length, 1);
  assert.equal(dataset.faces[0].worker_key, employeeKey);
  assert.equal(dataset.faces[0].image_path.length, 2);
  const photo = await terminal('GET', dataset.faces[0].image_path[0]);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('content-type'), 'image/jpeg');
  assert.equal((await terminal('GET', '/face/file/1/..%2Fx.jpg')).status, 400);

  // 단말이 보낸 device_key는 무시하고 토큰의 단말(101, 정문 1)로 판정한다
  const appear = await terminal('POST', '/face/appear', {
    worker_key: employeeKey,
    is_worker: true,
    device_key: 102,
    appear_time: '2026-11-03 09:00:00',
    full_frame: JPEG,
    crop_frame: JPEG,
  });
  assert.equal(appear.status, 200);
  const { event_key } = await appear.json();
  assert.deepEqual(opened, [1]);
  const decision = broadcasts.find((b) => b.message.type === 'decision');
  assert.equal(decision?.gateKey, 1);
  assert.equal(repos.accessLogs.getAccessLog(event_key)?.terminalKey, 101);

  // 같은 사람이 계속 서 있으면 같은 출입 한 건으로 합친다
  const again = await terminal('POST', '/face/appear', {
    worker_key: employeeKey,
    is_worker: true,
    appear_time: '2026-11-03 09:00:01',
  });
  assert.equal((await again.json()).event_key, event_key);
  assert.deepEqual(opened, [1]);

  const unknown = await terminal('POST', '/face/appear', {
    worker_key: 7,
    is_worker: false,
    appear_time: '2026-11-03 09:00:02',
  });
  assert.equal(unknown.status, 200);
  assert.equal((await terminal('POST', '/face/appear', { is_worker: true })).status, 400);

  // 다시 AI 서버로 돌리면 사진을 내보내지 않는다
  await call('PUT', '/api/admin/settings/face-engine', { engine: 'AI_SERVER' });
  assert.equal((await terminal('GET', dataset.faces[0].image_path[0])).status, 404);
});
