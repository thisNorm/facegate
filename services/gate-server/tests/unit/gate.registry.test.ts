import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../src/infrastructure/database/database.ts';
import { createGateRepository } from '../../src/modules/gate/gate.repository.ts';
import { createGateRegistry } from '../../src/modules/gate/gate.registry.ts';
import { importGatesFile } from '../../src/modules/gate/gate.import.ts';
import { sha256 } from '../../src/shared/secret.ts';

const AT = '2026-11-03 09:00:00';

function gatesFile(t: test.TestContext, gates: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const file = path.join(dir, 'gates.json');
  fs.writeFileSync(file, JSON.stringify({ gates }));
  return file;
}

const oneGate = (rtspUri: string) => [
  {
    gateKey: 1,
    name: '정문',
    adapter: { type: 'MOCK' },
    terminals: [{ terminalKey: 101, token: 'secret', rtspUri }],
  },
];

test('imports gates.json once and keeps tokens only as hashes', (t) => {
  const repo = createGateRepository(openDatabase(':memory:'));
  const file = gatesFile(t, oneGate('rtsp://gate1:p%40w@192.168.0.21:8555/'));
  assert.equal(importGatesFile(repo, file, AT), 1);
  assert.equal(importGatesFile(repo, file, AT), 0); // 두 번째는 건너뜀
  const [terminal] = repo.listTerminals();
  assert.deepEqual(
    {
      key: terminal.terminalKey,
      hash: terminal.tokenHash,
      user: terminal.rtspUser,
      pw: terminal.rtspPassword,
      ip: terminal.lastIp,
      port: terminal.rtspPort,
    },
    { key: 101, hash: sha256('secret'), user: 'gate1', pw: 'p@w', ip: '192.168.0.21', port: 8555 },
  );
  const empty = createGateRepository(openDatabase(':memory:'));
  assert.equal(importGatesFile(empty, path.join(os.tmpdir(), 'no-such-gates.json'), AT), 0);
});

test('registry keeps the same array and rebuilds RTSP addresses on reload', (t) => {
  const repo = createGateRepository(openDatabase(':memory:'));
  importGatesFile(repo, gatesFile(t, oneGate('rtsp://gate1:pw@10.0.0.5:8555/')), AT);
  const registry = createGateRegistry(repo);
  registry.reload();
  const same = registry.gates;
  assert.deepEqual(same, [
    {
      gateKey: 1,
      name: '정문',
      adapter: { type: 'MOCK' },
      floor: null,
      openToAll: true, // gates.json에 openToAll이 없으면 모두 통과
      terminals: [
        {
          terminalKey: 101,
          tokenHash: sha256('secret'),
          rtspUri: 'rtsp://gate1:pw@10.0.0.5:8555/',
        },
      ],
    },
  ]);
  repo.touchTerminal(101, '10.0.0.9', AT);
  repo.insertGate({ name: '후문', adapter: { type: 'MOCK' } }, AT);
  registry.reload();
  assert.equal(registry.gates, same);
  assert.equal(same[0].terminals[0].rtspUri, 'rtsp://gate1:pw@10.0.0.9:8555/');
  assert.deepEqual(
    same.map((g) => g.name),
    ['정문', '후문'],
  );
});
