import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '../../src/shared/secret.ts';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { createTerminalHub } from '../../src/modules/terminal/terminal.websocket.ts';

const gates = [
  {
    gateKey: 1,
    terminals: [{ terminalKey: 101, tokenHash: sha256('secret-token'), rtspUri: 'rtsp://x/' }],
  },
  {
    gateKey: 2,
    terminals: [{ terminalKey: 102, tokenHash: sha256('other-token'), rtspUri: 'rtsp://y/' }],
  },
];
const auth = { Authorization: 'Bearer secret-token' };

async function start(options: Partial<Parameters<typeof createTerminalHub>[0]> = {}) {
  const hub = createTerminalHub({ gates, ...options });
  const server = http.createServer();
  server.on('upgrade', hub.handleUpgrade);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { hub, server, base: `ws://127.0.0.1:${port}/ws/terminal` };
}

function rejectedStatus(url: string, headers: Record<string, string> = {}) {
  const client = new WebSocket(url, { headers });
  client.on('error', () => {});
  return new Promise<number | undefined>((resolve) =>
    client.once('unexpected-response', (_req, res) => {
      resolve(res.statusCode);
      client.terminate();
    }),
  );
}

test('authorized terminal receives broadcast', async () => {
  const { hub, server, base } = await start();
  const client = new WebSocket(`${base}?gate_key=1`, { headers: auth });
  await new Promise((resolve) => client.once('open', resolve));
  const received = new Promise((resolve) =>
    client.once('message', (data) => resolve(JSON.parse(String(data)))),
  );
  const message = {
    type: 'decision',
    event_key: 1,
    result: 'GRANTED',
    at: '2026-10-28 08:51:03',
  } as const;
  hub.broadcast(1, message);
  assert.deepEqual(await received, message);
  assert.equal(hub.isConnected(101), true);
  assert.equal(hub.isConnected(102), false);
  client.close();
  // 서버 쪽 close는 클라이언트보다 조금 늦게 온다
  for (let i = 0; i < 100 && hub.isConnected(101); i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(hub.isConnected(101), false);
  hub.close();
  server.close();
});

test('wrong token is rejected', async () => {
  const { hub, server, base } = await start();
  const status = await rejectedStatus(`${base}?gate_key=1`, { Authorization: 'Bearer wrong' });
  assert.equal(status, 401);
  hub.close();
  server.close();
});

test('missing token is rejected', async () => {
  const { hub, server, base } = await start();
  assert.equal(await rejectedStatus(`${base}?gate_key=1`), 401);
  hub.close();
  server.close();
});

test('the token decides the gate, so a stale gate_key still connects', async () => {
  const seen: [number, string, string[]][] = [];
  const { hub, server, base } = await start({ onConnect: (k, a, r) => seen.push([k, a, r]) });
  for (const url of [`${base}?gate_key=9`, base]) {
    const client = new WebSocket(url, {
      headers: { ...auth, 'X-Terminal-Addresses': '192.168.0.59, not-an-ip' },
    });
    await new Promise((resolve) => client.once('open', resolve));
    client.close();
  }
  assert.deepEqual(seen, [
    [101, '127.0.0.1', ['192.168.0.59']],
    [101, '127.0.0.1', ['192.168.0.59']],
  ]);
  hub.close();
  server.close();
});

test('disconnect closes the terminal with code 4401', async () => {
  const { hub, server, base } = await start();
  const client = new WebSocket(`${base}?gate_key=1`, { headers: auth });
  await new Promise((resolve) => client.once('open', resolve));
  const closed = new Promise<number>((resolve) => client.once('close', (code) => resolve(code)));
  hub.disconnect(101);
  assert.equal(await closed, 4401);
  hub.close();
  server.close();
});

test('broadcast follows a terminal moved to another gate', async () => {
  const moving = [
    { gateKey: 1, terminals: [...gates[0].terminals] },
    { gateKey: 2, terminals: [] as (typeof gates)[0]['terminals'] },
  ];
  const { hub, server, base } = await start({ gates: moving });
  const client = new WebSocket(`${base}?gate_key=1`, { headers: auth });
  await new Promise((resolve) => client.once('open', resolve));
  moving[1].terminals.push(...moving[0].terminals.splice(0));
  const received = new Promise((resolve) => client.once('message', resolve));
  hub.broadcast(2, {
    type: 'decision',
    event_key: 1,
    result: 'GRANTED',
    at: '2026-10-28 08:51:03',
  });
  assert.ok(await received);
  client.close();
  hub.close();
  server.close();
});

test('broadcast only reaches the target gate', async () => {
  const { hub, server, base } = await start();
  const client1 = new WebSocket(`${base}?gate_key=1`, { headers: auth });
  const client2 = new WebSocket(`${base}?gate_key=2`, {
    headers: { Authorization: 'Bearer other-token' },
  });
  await Promise.all(
    [client1, client2].map((client) => new Promise((resolve) => client.once('open', resolve))),
  );
  let leaked = false;
  client2.on('message', () => {
    leaked = true;
  });
  const received = new Promise((resolve) => client1.once('message', resolve));
  hub.broadcast(1, {
    type: 'decision',
    event_key: 1,
    result: 'GRANTED',
    at: '2026-10-28 08:51:03',
  } as const);
  await received;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(hub.isConnected(102), true);
  assert.equal(leaked, false);
  client1.close();
  client2.close();
  hub.close();
  server.close();
});
