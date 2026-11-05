import test from 'node:test';
import assert from 'node:assert/strict';
import { JPEG, photoSet, startServer } from './harness.ts';

const DEVICE = { Authorization: 'Bearer device-token' };

test('the web chooses how terminals check admins; PIN mode needs a pin first', async (t) => {
  const { server, call, repos } = await startServer();
  t.after(() => server.close());
  assert.deepEqual(await (await call('GET', '/api/admin/settings/terminal-admin')).json(), {
    mode: 'ACCOUNT',
    pinSet: false,
  });
  assert.equal(
    (await call('PUT', '/api/admin/settings/terminal-admin', { mode: 'PIN' })).status,
    400,
  );
  for (const bad of [{ pin: '12' }, { pin: '12345678901' }, { pin: 'abcd' }, { mode: 'X' }, {}])
    assert.equal((await call('PUT', '/api/admin/settings/terminal-admin', bad)).status, 400);
  const ok = await call('PUT', '/api/admin/settings/terminal-admin', { mode: 'PIN', pin: '2468' });
  assert.deepEqual(await ok.json(), { mode: 'PIN', pinSet: true });
  const [log] = repos.audits.list(1);
  assert.deepEqual(log.detail, {
    terminalAdminMode: ['ACCOUNT', 'PIN'],
    terminalAdminPin: 'changed',
  });
  assert.equal(JSON.stringify(repos.audits.list(5)).includes('2468'), false);
  const terminal = await call('GET', '/api/terminal/admin/mode', undefined, DEVICE);
  assert.deepEqual(await terminal.json(), { mode: 'PIN' });
});

test('PIN login: wrong pins lock the terminal, the right pin opens the admin API', async (t) => {
  const { server, call, repos } = await startServer();
  t.after(() => server.close());
  await call('PUT', '/api/admin/settings/terminal-admin', { mode: 'PIN', pin: '2468' });
  const pinLogin = (pin: string) => call('POST', '/api/terminal/admin/pin-login', { pin }, DEVICE);
  // 계정 방식이 아니면 계정 로그인은 받지 않는다
  assert.equal(
    (await call('POST', '/api/terminal/admin/login', { loginId: 'x', password: 'y' }, DEVICE))
      .status,
    403,
  );
  assert.equal((await call('GET', '/api/terminal/employees', undefined, DEVICE)).status, 401);
  const res = await pinLogin('2468');
  assert.equal(res.status, 200);
  const { token, admin } = (await res.json()) as { token: string; admin: { name: string } };
  assert.equal(admin.name, '단말 101 관리자 번호');
  const asAdmin = { ...DEVICE, 'X-Terminal-Admin-Token': token };
  assert.equal((await call('GET', '/api/terminal/employees', undefined, asAdmin)).status, 200);
  // 다른 단말 토큰으로는 이 번호 세션을 못 쓴다
  const other = { Authorization: 'Bearer device-token-2', 'X-Terminal-Admin-Token': token };
  assert.equal((await call('GET', '/api/terminal/employees', undefined, other)).status, 401);
  for (let i = 0; i < 5; i++) await pinLogin('0000');
  assert.equal((await pinLogin('2468')).status, 423);
  assert.equal(repos.audits.list(1)[0].action, 'TERMINAL_LOGIN_FAILED');
});

test('PIN login is refused while the server uses accounts', async (t) => {
  const { server, call } = await startServer();
  t.after(() => server.close());
  assert.equal(
    (await call('POST', '/api/terminal/admin/pin-login', { pin: '1' }, DEVICE)).status,
    403,
  );
});

test('a terminal admin registers, edits, retires and opens its own gate', async (t) => {
  const { server, call, repos, opened } = await startServer();
  t.after(() => server.close());
  await call('PUT', '/api/admin/settings/terminal-admin', { mode: 'PIN', pin: '2468' });
  const { token } = (await (
    await call('POST', '/api/terminal/admin/pin-login', { pin: '2468' }, DEVICE)
  ).json()) as { token: string };
  const asAdmin = { ...DEVICE, 'X-Terminal-Admin-Token': token };
  const created = await call(
    'POST',
    '/api/terminal/employees',
    { employeeNo: 'T1', name: '홍길동', photos: photoSet(2), consent: true, source: 'WEB_UPLOAD' },
    asAdmin,
  );
  assert.equal(created.status, 200);
  const { employeeKey } = (await created.json()) as { employeeKey: number };
  const detail = (await (
    await call('GET', `/api/terminal/employees/${employeeKey}`, undefined, asAdmin)
  ).json()) as { faces: { source: string }[] };
  assert.deepEqual(
    detail.faces.map((f) => f.source),
    ['TERMINAL', 'TERMINAL'],
  );
  assert.equal(
    (
      await call(
        'PATCH',
        `/api/terminal/employees/${employeeKey}`,
        { department: '보안팀' },
        asAdmin,
      )
    ).status,
    200,
  );
  const added = await call(
    'POST',
    `/api/terminal/employees/${employeeKey}/photos`,
    { photos: [JPEG] },
    asAdmin,
  );
  assert.equal(added.status, 201);
  assert.equal(
    (await call('POST', `/api/terminal/employees/${employeeKey}/retire`, undefined, asAdmin))
      .status,
    200,
  );
  const open = await call(
    'POST',
    '/api/terminal/open',
    { reason: 'OTHER', note: '웹 먹통' },
    asAdmin,
  );
  assert.equal(open.status, 200);
  assert.deepEqual(opened, [1]); // 단말 101은 1번 게이트
  const [log] = repos.audits.list(1);
  assert.deepEqual([log.action, log.adminKey, log.target], ['REMOTE_OPEN', null, 'gate:1']);
  assert.equal((log.detail as { terminalKey: number }).terminalKey, 101);
});

test('visitor calls carry a photo, debounce repeats and are acknowledged on the web', async (t) => {
  const { server, call, repos, setNow } = await startServer();
  t.after(() => server.close());
  const first = await call('POST', '/api/terminal/visitor-calls', { photo: JPEG }, DEVICE);
  assert.equal(first.status, 201);
  const { callKey } = (await first.json()) as { callKey: number };
  const again = await call('POST', '/api/terminal/visitor-calls', {}, DEVICE);
  assert.deepEqual(await again.json(), { callKey, repeated: true });
  assert.equal(
    (await call('POST', '/api/terminal/visitor-calls', { photo: 'nope' }, DEVICE)).status,
    400,
  );
  const pending = (await (await call('GET', '/api/admin/visitor-calls')).json()) as {
    callKey: number;
    gateKey: number;
    terminalKey: number;
    hasPhoto: boolean;
  }[];
  assert.deepEqual(
    pending.map((c) => [c.callKey, c.gateKey, c.terminalKey, c.hasPhoto]),
    [[callKey, 1, 101, true]],
  );
  const photo = await call('GET', `/api/admin/visitor-calls/${callKey}/photo`);
  assert.equal(photo.headers.get('content-type'), 'image/jpeg');
  assert.equal((await call('POST', `/api/admin/visitor-calls/${callKey}/ack`)).status, 200);
  assert.deepEqual(await (await call('GET', '/api/admin/visitor-calls')).json(), []);
  assert.equal(repos.audits.list(1)[0].action, 'VISITOR_CALL_ACK');
  // 실제 단말 사진은 100KB를 넘는다. 연결 API의 작은 본문 한도에 걸리면 안 된다
  await call('POST', `/api/admin/visitor-calls/${callKey}/ack`);
  const big = Buffer.concat([Buffer.from(JPEG.split(',')[1], 'base64'), Buffer.alloc(300_000)]);
  const large = await call(
    'POST',
    '/api/terminal/visitor-calls',
    { photo: `data:image/jpeg;base64,${big.toString('base64')}` },
    DEVICE,
  );
  assert.equal(large.status, 201);
  await call(
    'POST',
    `/api/admin/visitor-calls/${((await large.json()) as { callKey: number }).callKey}/ack`,
  );
  // 확인한 뒤에는 바로 다시 부를 수 있다
  setNow(new Date(Date.parse('2026-11-03T00:00:05Z')));
  assert.equal((await call('POST', '/api/terminal/visitor-calls', {}, DEVICE)).status, 201);
  assert.equal((await call('GET', '/api/admin/visitor-calls', undefined, {})).status, 401);
});

test('gate light colors are picked from presets on the web or the terminal and pushed out', async (t) => {
  const { server, call, repos, broadcasts } = await startServer();
  t.after(() => server.close());
  const light = { idle: 'WHITE', granted: 'GREEN', denied: 'RED' };
  assert.deepEqual(
    await (await call('GET', '/api/terminal/light', undefined, DEVICE)).json(),
    light,
  );
  for (const bad of [{}, { idle: 'PINK' }, { granted: '#00ff00' }])
    assert.equal((await call('PUT', '/api/admin/settings/terminal-light', bad)).status, 400);
  const web = await call('PUT', '/api/admin/settings/terminal-light', { idle: 'BLUE' });
  assert.deepEqual(await web.json(), { ...light, idle: 'BLUE' });
  assert.deepEqual(
    broadcasts.map((b) => b.message),
    [1, 2].map(() => ({ type: 'light', ...light, idle: 'BLUE' })), // 게이트마다 한 번
  );
  const [webLog] = repos.audits.list(1);
  assert.equal(webLog.action, 'SETTINGS_UPDATE');
  assert.equal(webLog.via, 'WEB');
  assert.deepEqual(webLog.detail, { 'terminalLight.idle': ['WHITE', 'BLUE'] });

  // 단말에서는 관리자 확인 뒤에만 바꿀 수 있다
  assert.equal(
    (await call('PUT', '/api/terminal/light', { denied: 'YELLOW' }, DEVICE)).status,
    401,
  );
  await call('PUT', '/api/admin/settings/terminal-admin', { mode: 'PIN', pin: '2468' });
  const { token } = (await (
    await call('POST', '/api/terminal/admin/pin-login', { pin: '2468' }, DEVICE)
  ).json()) as { token: string };
  const asAdmin = { ...DEVICE, 'X-Terminal-Admin-Token': token };
  const fromTerminal = await call('PUT', '/api/terminal/light', { denied: 'YELLOW' }, asAdmin);
  assert.deepEqual(await fromTerminal.json(), { idle: 'BLUE', granted: 'GREEN', denied: 'YELLOW' });
  assert.deepEqual(await (await call('GET', '/api/admin/settings/terminal-light')).json(), {
    idle: 'BLUE',
    granted: 'GREEN',
    denied: 'YELLOW',
  });
  const [terminalLog] = repos.audits.list(1);
  assert.equal(terminalLog.via, 'TERMINAL:101');
  assert.match(terminalLog.viaName ?? '', /\(.+\)$/); // 단말 이름 (게이트 이름)
  assert.deepEqual(terminalLog.detail, { 'terminalLight.denied': ['RED', 'YELLOW'] });
});

test('voice lines are typed on the web, pushed to terminals and an empty line means silence', async (t) => {
  const { server, call, repos, broadcasts } = await startServer();
  t.after(() => server.close());
  const voice = { granted: '인증되었습니다', denied: '출입 권한이 없습니다', unregistered: '' };
  assert.deepEqual(
    await (await call('GET', '/api/terminal/voice', undefined, DEVICE)).json(),
    voice,
  );
  for (const bad of [{}, { granted: 3 }, { denied: 'ㄱ'.repeat(41) }])
    assert.equal((await call('PUT', '/api/admin/settings/terminal-voice', bad)).status, 400);
  const saved = await call('PUT', '/api/admin/settings/terminal-voice', {
    granted: '  환영합니다  ',
    unregistered: '등록되지 않은 사용자입니다',
  });
  const next = {
    granted: '환영합니다',
    denied: '출입 권한이 없습니다',
    unregistered: '등록되지 않은 사용자입니다',
  };
  assert.deepEqual(await saved.json(), next);
  assert.deepEqual(broadcasts.at(-1)?.message, { type: 'voice', ...next });
  assert.equal(repos.audits.list(1)[0].action, 'SETTINGS_UPDATE');
  assert.deepEqual(await (await call('GET', '/api/admin/settings/terminal-voice')).json(), next);
});
