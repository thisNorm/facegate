import test from 'node:test';
import assert from 'node:assert/strict';
import { photoSet, startServer } from './harness.ts';

const BASE = 'https://gate.example.co.kr:8443';
const TERMINAL = { Authorization: 'Bearer device-token' };

/** 등록 링크 → 핸드폰 등록(쿠키) → 단말 일회용 주소 → 핸드폰으로 열기 (D-62) */
async function setUp(t: test.TestContext) {
  const ctx = await startServer({ phoneBaseUrl: BASE });
  t.after(() => ctx.server.close());
  const person = {
    employeeNo: 'P001',
    name: '최폰',
    department: '개발팀',
    photos: photoSet(2),
    consent: true,
  };
  const { employeeKey } = await (await ctx.call('POST', '/api/admin/employees', person)).json();
  const invite = await ctx.call('POST', `/api/admin/employees/${employeeKey}/phone-invite`);
  assert.equal(invite.status, 201);
  const { url } = await invite.json();
  assert.ok(url.startsWith(`${BASE}/m/register?t=`));
  const t0 = new URL(url).searchParams.get('t');
  const phone = (path: string, body: unknown, cookie = '') =>
    fetch(ctx.base + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (iPhone)',
        Cookie: cookie,
      },
      body: JSON.stringify(body),
    });
  const registered = await phone('/m/api/register', { t: t0 });
  assert.equal(registered.status, 200);
  assert.deepEqual(await registered.json(), { name: '최폰' });
  const cookie = (registered.headers.get('set-cookie') ?? '').split(';')[0];
  assert.match(cookie, /^facegate_phone=/);
  const passCode = async () => {
    const r = await ctx.call('GET', '/api/terminal/pass-code', undefined, TERMINAL);
    assert.equal(r.status, 200);
    const { url: passUrl } = await r.json();
    assert.ok(passUrl.startsWith(`${BASE}/m/pass?c=`));
    return new URL(passUrl).searchParams.get('c');
  };
  return { ...ctx, employeeKey, t0, phone, cookie, passCode };
}

test('a registered phone opens the gate once per code and is logged as PHONE', async (t) => {
  const { phone, cookie, passCode, opened, broadcasts, call, t0 } = await setUp(t);
  const c = await passCode();

  // 등록 안 된 핸드폰은 값을 써 버리지 않는다
  assert.equal((await phone('/m/api/pass', { c })).status, 401);
  const pass = await phone('/m/api/pass', { c }, cookie);
  assert.equal(pass.status, 200);
  assert.deepEqual(await pass.json(), {
    ok: true,
    result: 'GRANTED',
    name: '최폰',
    gateName: '정문 1',
  });
  assert.deepEqual(opened, [1]);
  const decision = broadcasts.at(-1)!;
  assert.equal(decision.gateKey, 1);
  assert.equal((decision.message as { name?: string }).name, '최폰');

  // 같은 값은 한 번만, 등록 링크도 한 번만
  assert.equal((await phone('/m/api/pass', { c }, cookie)).status, 410);
  assert.equal((await phone('/m/api/register', { t: t0 })).status, 410);

  const logs = await (await call('GET', '/api/admin/access-logs?method=PHONE')).json();
  assert.deepEqual(
    logs.items.map((i: { method: string; result: string; employeeName: string }) => [
      i.method,
      i.result,
      i.employeeName,
    ]),
    [['PHONE', 'GRANTED', '최폰']],
  );
});

test('codes expire after a minute and a revoked phone cannot open', async (t) => {
  const { phone, cookie, passCode, setNow, call, employeeKey, opened } = await setUp(t);
  const late = await passCode();
  setNow(new Date(Date.parse('2026-11-03T00:01:01.000Z')));
  assert.equal((await phone('/m/api/pass', { c: late }, cookie)).status, 410);

  const list = await (await call('GET', `/api/admin/employees/${employeeKey}/phones`)).json();
  assert.equal(list.enabled, true);
  assert.equal(list.phones.length, 1);
  assert.equal(list.phones[0].label, '아이폰');
  assert.equal((await call('DELETE', `/api/admin/phones/${list.phones[0].phoneKey}`)).status, 200);
  assert.equal((await phone('/m/api/pass', { c: await passCode() }, cookie)).status, 401);
  assert.deepEqual(opened, []);

  const audit = await (await call('GET', '/api/admin/audit-logs?limit=10')).json();
  const actions = audit.items.map((l: { action: string; targetName: string }) => [
    l.action,
    l.targetName,
  ]);
  assert.deepEqual(actions.slice(0, 2), [
    ['PHONE_REVOKE', '최폰'],
    ['PHONE_INVITE', '최폰'],
  ]);
});

test('phone passes follow the same gate rules as faces', async (t) => {
  const { phone, cookie, passCode, call, opened } = await setUp(t);
  await call('PATCH', '/api/admin/gates/1', {
    name: '정문',
    adapter: { type: 'MOCK' },
    openToAll: false,
  });
  const r = await (await phone('/m/api/pass', { c: await passCode() }, cookie)).json();
  assert.deepEqual(r, { ok: true, result: 'DENIED_GATE', gateName: '정문' });
  assert.deepEqual(opened, []);
});

test('without PHONE_BASE_URL the feature is off and pages reject other sites', async (t) => {
  const { server, call, base } = await startServer();
  t.after(() => server.close());
  assert.equal((await call('GET', '/api/terminal/pass-code', undefined, TERMINAL)).status, 404);
  assert.equal((await call('POST', '/api/admin/employees/1/phone-invite')).status, 404);
  const page = await fetch(`${base}/m/pass?c=x`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('cache-control') ?? '', /no-store/);
  const forged = await fetch(`${base}/m/api/pass`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ c: 'x' }),
  });
  assert.equal(forged.status, 403);
});
