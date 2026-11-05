import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { openDatabase } from '../../src/infrastructure/database/database.ts';
import { createRepositories } from '../../src/app/repositories.ts';
import { createServer } from '../../src/app/server.ts';
import { testRegistry } from './registry.ts';

test('the admin web is served from ADMIN_WEB_DIR with an index.html fallback', async (t) => {
  const webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'facegate-web-'));
  fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>FaceGate</title>');
  fs.mkdirSync(path.join(webDir, 'assets'));
  fs.writeFileSync(path.join(webDir, 'assets', 'app.js'), 'console.log(1)');
  const sql = openDatabase(':memory:');
  const server = await createServer({
    config: {
      ingestKey: 'ingest',
      fileDir: os.tmpdir(),
      duplicateWindowMs: 5000,
      adminWebDir: webDir,
    },
    repos: createRepositories(sql),
    registry: testRegistry(createRepositories(sql)),
    gateControl: { async open() {}, async releaseAll() {} },
    terminalHub: { handleUpgrade() {}, broadcast() {}, isConnected: () => false, disconnect() {} },
  });
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    sql.close();
    fs.rmSync(webDir, { recursive: true });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  assert.match(await (await fetch(`${base}/`)).text(), /FaceGate/);
  assert.match(await (await fetch(`${base}/employees/3`)).text(), /FaceGate/);
  assert.equal(await (await fetch(`${base}/assets/app.js`)).text(), 'console.log(1)');
  assert.equal((await fetch(`${base}/api/admin/nope`)).status, 401); // API는 화면으로 넘기지 않음
  assert.equal((await fetch(`${base}/health`)).status, 200);
});
