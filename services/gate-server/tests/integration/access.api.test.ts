import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loginAsAdmin } from './admin-session.ts';
import { INGEST, JPEG, contract, startServer, T0, photoSet } from './harness.ts';

const appearWorker = contract('appear-worker.json');
const appearUnknown = contract('appear-unknown.json');
type Page = { items: Record<string, unknown>[]; nextBeforeEventKey: number | null };

async function seed() {
  const ctx = await startServer();
  const { setNow } = ctx;
  let call = ctx.call;
  const res = await call('POST', '/api/admin/employees', {
    employeeNo: 'E1',
    name: '홍길동',
    department: '개발팀',
    photos: photoSet(),
    consent: true,
  });
  assert.equal(res.status, 200);
  const employeeKey = ((await res.json()) as { employeeKey: number }).employeeKey;
  const appear = (body: unknown) =>
    call('POST', '/api/modules/camera/ai/face/appear', body, INGEST);
  await appear({ ...appearWorker, worker_key: employeeKey, full_frame: JPEG, crop_frame: JPEG }); // 11/03 GRANTED
  setNow(new Date(T0.getTime() + 60_000));
  await appear({ ...appearUnknown, full_frame: undefined, crop_frame: undefined }); // 11/03 UNREGISTERED, 사진 없음
  setNow(new Date(T0.getTime() + 24 * 3600_000));
  // 웹 세션은 8시간이라 하루 뒤로 가면 만료됨: 새로 로그인
  const fresh = await loginAsAdmin(ctx.repos, ctx.base, 'hr.lee');
  call = (method, url, body, headers = fresh) => ctx.call(method, url, body, headers);
  await call('POST', '/api/admin/gates/2/open', { reason: 'VISITOR', visitor: { name: '방문객' } }); // 11/04 REMOTE
  // appear 사진 저장은 응답 뒤에 끝남
  for (let i = 0; i < 40 && !ctx.repos.accessLogs.getAccessLog(1)?.fullImage; i++)
    await new Promise((resolve) => setTimeout(resolve, 50));
  return { ...ctx, call, employeeKey };
}

test('access logs are newest first with employee names and image flags, not file paths', async () => {
  const { server, call } = await seed();
  const page = (await (await call('GET', '/api/admin/access-logs')).json()) as Page;
  assert.deepEqual(
    page.items.map((i) => i.result),
    ['GRANTED', 'UNREGISTERED', 'GRANTED'],
  );
  assert.deepEqual(
    page.items.map((i) => i.method),
    ['REMOTE', 'FACE', 'FACE'],
  );
  assert.equal(page.items[2].employeeName, '홍길동');
  assert.equal(page.items[2].hasFullImage, true);
  assert.equal(page.items[1].hasFullImage, false);
  assert.ok(!('fullImage' in page.items[2]));
  assert.equal(page.nextBeforeEventKey, null);
  server.close();
});

test('filters: date range, gate, result, method and text', async () => {
  const { server, call } = await seed();
  const results = async (query: string) =>
    ((await (await call('GET', `/api/admin/access-logs?${query}`)).json()) as Page).items.map(
      (i) => i.eventKey,
    );
  assert.deepEqual(await results('from=2026-11-04&to=2026-11-04'), [3]);
  assert.deepEqual(await results('to=2026-11-03'), [2, 1]);
  assert.deepEqual(await results('gateKey=1'), [2, 1]);
  assert.deepEqual(await results('result=UNREGISTERED'), [2]);
  assert.deepEqual(await results('method=REMOTE'), [3]);
  assert.deepEqual(await results('q=%ED%99%8D'), [1]); // 홍
  assert.deepEqual(await results('q=%EB%B0%A9%EB%AC%B8'), [3]); // 방문 (방문객 이름)
  for (const bad of ['from=2026-13-01', 'gateKey=x', 'result=OK', 'method=NFC', 'limit=abc'])
    assert.equal((await call('GET', `/api/admin/access-logs?${bad}`)).status, 400, bad);
  server.close();
});

test('pagination with beforeEventKey', async () => {
  const { server, call } = await seed();
  const first = (await (await call('GET', '/api/admin/access-logs?limit=2')).json()) as Page;
  assert.deepEqual(
    first.items.map((i) => i.eventKey),
    [3, 2],
  );
  assert.equal(first.nextBeforeEventKey, 2);
  const second = (await (
    await call('GET', '/api/admin/access-logs?limit=2&beforeEventKey=2')
  ).json()) as Page;
  assert.deepEqual(
    second.items.map((i) => i.eventKey),
    [1],
  );
  assert.equal(second.nextBeforeEventKey, null);
  server.close();
});

test('event images are served only from the event folder', async () => {
  const { server, call, repos, fileDir } = await seed();
  const full = await call('GET', '/api/admin/access-logs/1/images/full');
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'image/jpeg');
  assert.equal((await call('GET', '/api/admin/access-logs/2/images/full')).status, 404);
  assert.equal((await call('GET', '/api/admin/access-logs/1/images/other')).status, 404);
  // DB 경로가 사진 폴더 밖을 가리키면 내주지 않음
  const outside = path.join(fileDir, '..', 'secret.jpg');
  fs.writeFileSync(outside, 'x');
  repos.accessLogs.updateAccessLog(1, { cropImage: outside });
  assert.equal((await call('GET', '/api/admin/access-logs/1/images/crop')).status, 404);
  server.close();
});

test('CSV export uses the same filters', async () => {
  const { server, call } = await seed();
  const res = await call('GET', '/api/admin/access-logs.csv?method=FACE');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.match(
    res.headers.get('content-disposition') ?? '',
    /attachment; filename="access-logs-20261104\.csv"/,
  );
  const text = await res.text();
  assert.equal(text.trimEnd().split('\r\n').length, 3); // 헤더 + 2행
  server.close();
});
