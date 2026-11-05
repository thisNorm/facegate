import test from 'node:test';
import assert from 'node:assert/strict';
import type os from 'node:os';
import net from 'node:net';
import {
  canReach,
  pickReachable,
  parseDevice,
  serverUrlsFrom,
} from '../../src/modules/terminal/terminal.pairing.ts';

test('server URLs put LAN addresses first, keep three, and loopback last', () => {
  const nic = (address: string) =>
    ({ address, family: 'IPv4', internal: false }) as os.NetworkInterfaceInfo;
  assert.deepEqual(
    serverUrlsFrom(18080, {
      vpn: [nic('100.118.159.111')],
      wsl: [nic('172.30.32.1')],
      eth: [nic('192.168.0.191')],
      other: [nic('10.0.0.5')],
    }),
    [
      'http://192.168.0.191:18080',
      'http://10.0.0.5:18080',
      'http://172.30.32.1:18080',
      'http://127.0.0.1:18080',
    ],
  );
});

test('server URLs list external IPv4 first and loopback last', () => {
  const nic = (address: string, family: string, internal: boolean) =>
    ({ address, family, internal }) as os.NetworkInterfaceInfo;
  const urls = serverUrlsFrom(18080, {
    lo: [nic('127.0.0.1', 'IPv4', true)],
    eth0: [nic('192.168.0.191', 'IPv4', false), nic('fe80::1', 'IPv6', false)],
  });
  assert.deepEqual(urls, ['http://192.168.0.191:18080', 'http://127.0.0.1:18080']);
});

test('device info needs model, app version and a valid RTSP port', () => {
  const ok = { model: 'WF1589T', appVersion: '0.1.0', rtspPort: 8555 };
  assert.deepEqual(parseDevice(ok), ok);
  for (const bad of [
    { ...ok, model: '' },
    { ...ok, appVersion: 'x'.repeat(65) },
    { ...ok, rtspPort: 0 },
    { ...ok, rtspPort: '8555' },
    null,
  ])
    assert.equal(parseDevice(bad), null);
});

test('canReach tells an open port from a closed one', async (t) => {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  t.after(() => server.close());
  assert.equal(await canReach('127.0.0.1', port), true);
  server.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await canReach('127.0.0.1', port, 500), false);
});

test('pickReachable keeps candidate order and skips duplicates', async () => {
  const tried: string[] = [];
  const reach = async (host: string) => {
    tried.push(host);
    return host === '127.0.0.1';
  };
  const picked = await pickReachable(
    ['192.168.0.155', '192.168.0.155', '192.168.0.59', '127.0.0.1'],
    8555,
    reach,
  );
  assert.equal(picked, '127.0.0.1');
  assert.deepEqual(tried, ['192.168.0.155', '192.168.0.59', '127.0.0.1']);
  assert.equal(await pickReachable(['10.0.0.1'], 8555, async () => false), null);
});
