import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { startServer, T0 } from './harness.ts';

const DEVICE = { model: 'WF1589T', appVersion: '0.1.0', rtspPort: 8555 };
type Info = {
  terminalKey: number;
  token: string;
  gateKey: number;
  gateName: string;
  rtspUser: string;
  rtspPassword: string;
  serverUrls: string[];
};

test('hello needs no token', async (t) => {
  const { server, call } = await startServer();
  t.after(() => server.close());
  const res = await call('GET', '/api/terminal/hello', undefined, {});
  assert.deepEqual(await res.json(), { app: 'FaceGate' });
});

test('a QR code pairs a new terminal once and its token opens the terminal API', async (t) => {
  const { server, call, repos } = await startServer();
  t.after(() => server.close());
  const issued = await call('POST', '/api/admin/gates/1/pair-codes');
  assert.equal(issued.status, 201);
  const { code, serverUrls } = (await issued.json()) as { code: string; serverUrls: string[] };
  assert.match(code, /^\d{6}$/);
  assert.match(serverUrls.at(-1)!, /^http:\/\/127\.0\.0\.1:\d+$/);
  const paired = await call('POST', '/api/terminal/pair', { code, ...DEVICE }, {});
  assert.equal(paired.status, 200);
  const info = (await paired.json()) as Info;
  assert.deepEqual(
    [info.terminalKey, info.gateKey, info.gateName, info.rtspUser],
    [103, 1, '정문 1', 'gate103'],
  );
  assert.match(info.token, /^[0-9a-f]{64}$/);
  assert.match(info.rtspPassword, /^[0-9a-f]{32}$/);
  const row = repos.gates.getTerminal(103)!;
  assert.notEqual(row.tokenHash, info.token);
  assert.deepEqual([row.lastIp, row.model, row.rtspPort], ['127.0.0.1', 'WF1589T', 8555]);
  const again = await call('POST', '/api/terminal/pair', { code, ...DEVICE }, {});
  assert.deepEqual([again.status, await again.json()], [410, { error: 'USED' }]);
  const [log] = repos.audits.list(1);
  assert.deepEqual(
    [log.action, log.target, log.detail],
    ['TERMINAL_PAIR', 'terminal:103', { gateKey: 1, method: 'QR' }],
  );
  // 새 토큰으로 단말 API 인증을 통과한다 (로그인 실패는 401이 아니라 자격 증명 오류)
  const bearer = { Authorization: `Bearer ${info.token}` };
  const login = await call(
    'POST',
    '/api/terminal/admin/login',
    { loginId: 'x', password: 'y' },
    bearer,
  );
  assert.notEqual(((await login.json()) as { error?: string }).error, 'invalid terminal token');
  assert.deepEqual(repos.audits.list(1)[0].detail, { terminalKey: 103 });
});

test('replaced, expired and wrong codes are refused; five misses lock the address', async (t) => {
  const { server, call, setNow } = await startServer();
  t.after(() => server.close());
  const issue = async () =>
    ((await (await call('POST', '/api/admin/gates/1/pair-codes')).json()) as { code: string }).code;
  const pair = (code: string) => call('POST', '/api/terminal/pair', { code, ...DEVICE }, {});
  const first = await issue();
  const second = await issue();
  if (first !== second) assert.equal((await pair(first)).status, 401); // 새 코드가 이전 코드를 없앰
  setNow(new Date(T0.getTime() + 10 * 60_000 + 1000));
  assert.deepEqual(await (await pair(second)).json(), { error: 'EXPIRED' });
  for (let i = 0; i < 5; i++) await pair('000000');
  assert.equal((await pair('000000')).status, 429);
  setNow(new Date(T0.getTime() + 21 * 60_000));
  assert.equal((await pair('000000')).status, 401); // 10분 뒤 잠금 풀림
  assert.equal(
    (await call('POST', '/api/terminal/pair', { code: 'abc', ...DEVICE }, {})).status,
    400,
  );
  assert.equal((await call('POST', '/api/admin/gates/99/pair-codes')).status, 404);
});

/** 단말의 8556 번호 창구 흉내. 받은 본문을 기록 */
async function fakeTerminal(t: test.TestContext, pin: string) {
  const got: Record<string, unknown>[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      got.push(body);
      const ok = body.pin === pin;
      res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
      res.end(ok ? JSON.stringify(DEVICE) : '{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return { got, port: (server.address() as AddressInfo).port };
}

test('number pairing sends credentials to the terminal and saves it only on success', async (t) => {
  const terminal = await fakeTerminal(t, '482913');
  const { server, call, repos } = await startServer({
    push: async (address, body) => {
      const res = await fetch(`http://${address}:${terminal.port}/pair`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return { status: res.status, json: await res.json() };
    },
  });
  t.after(() => server.close());
  const wrong = await call('POST', '/api/admin/gates/2/terminals', {
    address: '127.0.0.1',
    pin: '000000',
  });
  assert.deepEqual([wrong.status, await wrong.json()], [400, { error: 'WRONG_PIN' }]);
  assert.equal(repos.gates.getTerminal(103), undefined);
  const ok = await call('POST', '/api/admin/gates/2/terminals', {
    address: '127.0.0.1',
    pin: '482913',
  });
  assert.deepEqual([ok.status, await ok.json()], [201, { terminalKey: 103 }]);
  const sent = terminal.got.at(-1)!;
  assert.deepEqual(
    [sent.pin, sent.terminalKey, sent.gateKey, sent.gateName, sent.rtspUser],
    ['482913', 103, 2, '정문 2', 'gate103'],
  );
  assert.equal(repos.gates.getTerminal(103)?.lastIp, '127.0.0.1');
  assert.deepEqual(repos.audits.list(1)[0].detail, { gateKey: 2, method: 'NUMBER' });
});

test('number pairing reports an unreachable terminal and bad input', async (t) => {
  const { server, call, repos } = await startServer({
    push: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  t.after(() => server.close());
  const res = await call('POST', '/api/admin/gates/1/terminals', {
    address: '127.0.0.1',
    pin: '123456',
  });
  assert.deepEqual([res.status, await res.json()], [502, { error: 'UNREACHABLE' }]);
  assert.equal(repos.gates.getTerminal(103), undefined);
  for (const body of [
    { address: 'evil.example', pin: '123456' },
    { address: '10.0.0.1', pin: '12' },
    { address: '10.0.0.256', pin: '123456' },
  ])
    assert.equal((await call('POST', '/api/admin/gates/1/terminals', body)).status, 400);
  assert.equal(
    (await call('POST', '/api/admin/gates/99/terminals', { address: '10.0.0.1', pin: '123456' }))
      .status,
    404,
  );
});
