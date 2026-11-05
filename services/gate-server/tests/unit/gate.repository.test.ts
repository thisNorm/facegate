import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../src/infrastructure/database/database.ts';
import { createGateRepository, type TerminalRow } from '../../src/modules/gate/gate.repository.ts';

const AT = '2026-11-03 09:00:00';
const repo = () => createGateRepository(openDatabase(':memory:'));
const terminal = (terminalKey: number, gateKey: number): TerminalRow => ({
  terminalKey,
  gateKey,
  name: `단말 ${terminalKey}`,
  model: 'WF1589T',
  appVersion: '0.1.0',
  tokenHash: `hash-${terminalKey}`,
  rtspUser: `gate${terminalKey}`,
  rtspPassword: 'pw',
  rtspPort: 8555,
  lastIp: '127.0.0.1',
  lastSeenAt: null,
  pairedAt: AT,
});

test('gates keep their adapter JSON and can be given a key on import', () => {
  const r = repo();
  const relay = {
    type: 'DRY_CONTACT',
    host: '10.0.0.50',
    port: 502,
    unitId: 1,
    coil: 0,
    pulseMs: 500,
  } as const;
  assert.equal(r.insertGate({ gateKey: 7, name: '정문', adapter: relay }, AT), 7);
  assert.equal(r.insertGate({ name: '후문', adapter: { type: 'MOCK' } }, AT), 8);
  assert.deepEqual(r.listGates(), [
    { gateKey: 7, name: '정문', adapter: relay, floor: null, openToAll: false },
    { gateKey: 8, name: '후문', adapter: { type: 'MOCK' }, floor: null, openToAll: false },
  ]);
  assert.equal(
    r.updateGate(8, { name: '후문 1', adapter: { type: 'MOCK' }, floor: 2, openToAll: true }),
    true,
  );
  assert.deepEqual(
    [r.getGate(8)?.name, r.getGate(8)?.floor, r.getGate(8)?.openToAll],
    ['후문 1', 2, true],
  );
  assert.equal(
    r.updateGate(99, { name: 'x', adapter: { type: 'MOCK' }, floor: null, openToAll: false }),
    false,
  );
});

test('terminal keys start at 101 and continue after the largest one', () => {
  const r = repo();
  r.insertGate({ gateKey: 1, name: 'g', adapter: { type: 'MOCK' } }, AT);
  assert.equal(r.nextTerminalKey(), 101);
  r.insertTerminal(terminal(105, 1));
  assert.equal(r.nextTerminalKey(), 106);
  assert.equal(r.updateTerminal(105, { name: '로비' }), true);
  r.touchTerminal(105, '192.168.0.20', '2026-11-03 09:01:00');
  assert.deepEqual(
    { ...r.getTerminal(105) },
    {
      ...terminal(105, 1),
      name: '로비',
      lastIp: '192.168.0.20',
      lastSeenAt: '2026-11-03 09:01:00',
    },
  );
  assert.equal(r.deleteTerminal(105), true);
  assert.equal(r.deleteTerminal(105), false);
});

test('a gate with terminals cannot be deleted', () => {
  const r = repo();
  r.insertGate({ gateKey: 1, name: 'g', adapter: { type: 'MOCK' } }, AT);
  r.insertTerminal(terminal(101, 1));
  assert.throws(() => r.deleteGate(1));
  r.deleteTerminal(101);
  assert.equal(r.deleteGate(1), true);
});

test("a new pair code replaces the gate's unused one and is used once", () => {
  const r = repo();
  r.insertGate({ gateKey: 1, name: 'g', adapter: { type: 'MOCK' } }, AT);
  r.replaceCode({ code: '111111', gateKey: 1, issuedBy: 1, expiresAt: '2026-11-03 09:10:00' });
  r.replaceCode({ code: '222222', gateKey: 1, issuedBy: 1, expiresAt: '2026-11-03 09:11:00' });
  assert.equal(r.findCode('111111'), undefined);
  assert.equal(r.useCode('222222', AT), true);
  assert.equal(r.useCode('222222', AT), false);
  assert.deepEqual(
    { ...r.findCode('222222') },
    { code: '222222', gateKey: 1, issuedBy: 1, expiresAt: '2026-11-03 09:11:00', usedAt: AT },
  );
});
