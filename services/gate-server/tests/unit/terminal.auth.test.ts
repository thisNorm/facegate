import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '../../src/shared/secret.ts';
import { findTerminal } from '../../src/modules/terminal/terminal.auth.ts';

const gates = [
  {
    gateKey: 1,
    terminals: [
      { terminalKey: 100, tokenHash: sha256(''), rtspUri: 'rtsp://x/' },
      { terminalKey: 101, tokenHash: sha256('secret-1'), rtspUri: 'rtsp://y/' },
    ],
  },
] as Parameters<typeof findTerminal>[0];

test('findTerminal matches by token and never matches an empty token', () => {
  assert.deepEqual(findTerminal(gates, 'secret-1'), { gateKey: 1, terminalKey: 101 });
  assert.equal(findTerminal(gates, 'nope'), undefined);
  assert.equal(findTerminal(gates, ''), undefined);
});
