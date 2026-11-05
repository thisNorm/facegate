import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, loadGates } from '../../src/app/config.ts';

test('loadConfig needs no keys; INGEST_KEY is an optional first seed', () => {
  assert.equal(loadConfig({}).ingestKey, undefined);
  assert.equal(loadConfig({ INGEST_KEY: 'a' }).ingestKey, 'a');
  assert.equal('adminKey' in loadConfig({}), false);
});

test('loadConfig applies defaults', () => {
  const config = loadConfig({});
  assert.equal(config.port, 8080);
  assert.equal(config.duplicateWindowMs, 5000);
});

test('loadConfig rejects a non-positive DUPLICATE_WINDOW_SEC', () => {
  for (const value of ['0', '-1', 'abc'])
    assert.throws(
      () => loadConfig({ DUPLICATE_WINDOW_SEC: value }),
      /DUPLICATE_WINDOW_SEC must be a positive number/,
    );
});

test('loadGates reads example file', () => {
  const gates = loadGates(new URL('../../config/gates.example.json', import.meta.url));
  assert.equal(gates[0].gateKey, 1);
  assert.equal(gates[0].terminals[0].terminalKey, 101);
});

test('loadGates rejects the old separate cameras list and duplicate terminal numbers', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const write = (gates: unknown) => {
    const file = path.join(dir, 'gates.json');
    fs.writeFileSync(file, JSON.stringify({ gates }));
    return file;
  };
  const terminal = (terminalKey: number) => ({ terminalKey, token: 't', rtspUri: 'rtsp://x/' });
  const gate = (gateKey: number, extra = {}) => ({
    gateKey,
    name: 'g',
    adapter: { type: 'MOCK' },
    terminals: [terminal(gateKey)],
    ...extra,
  });
  assert.throws(() => loadGates(write([gate(1, { cameras: [] })])), /cameras/);
  assert.throws(() => loadGates(write([gate(1), gate(2, { terminals: [terminal(1)] })])), /중복/);
  assert.throws(
    () => loadGates(write([gate(1, { terminals: [{ terminalKey: 1, token: 't' }] })])),
    /rtspUri/,
  );
  assert.equal(loadGates(write([gate(1), gate(2)])).length, 2);
});

test('initial account configuration is injected and APP_ENV defaults to production', () => {
  for (const env of [{}, { APP_ENV: '' }]) {
    const config = loadConfig(env);
    assert.equal(config.appEnv, 'production');
    assert.equal(config.initialAdminId, undefined);
    assert.equal(config.initialAdminPassword, undefined);
  }
  const config = loadConfig({
    INITIAL_ADMIN_ID: 'boot.admin',
    INITIAL_ADMIN_PASSWORD: 'boot password',
    APP_ENV: 'development',
  });
  assert.equal(config.initialAdminId, 'boot.admin');
  assert.equal(config.initialAdminPassword, 'boot password');
  assert.equal(config.appEnv, 'development');
  assert.throws(() => loadConfig({ APP_ENV: 'staging' }), /APP_ENV/);
});
