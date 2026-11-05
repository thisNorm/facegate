import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createRepositories } from '../../src/app/repositories.ts';
import { createServer } from '../../src/app/server.ts';
import { openDatabase } from '../../src/infrastructure/database/database.ts';
import { testRegistry } from './registry.ts';

test('with HTTPS on, the admin web over plain HTTP moves to HTTPS but terminals and AI stay on HTTP', async (t) => {
  const repos = createRepositories(openDatabase(':memory:'));
  const server = await createServer({
    config: {
      ingestKey: 'ingest',
      fileDir: fs.mkdtempSync(path.join(os.tmpdir(), 'facegate-https-')),
      duplicateWindowMs: 5000,
      tls: { certFile: 'unused', keyFile: 'unused', port: 8443 },
    },
    repos,
    registry: testRegistry(repos, []),
    gateControl: { async open() {}, async releaseAll() {} },
    terminalHub: { handleUpgrade() {}, broadcast() {}, isConnected: () => false, disconnect() {} },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  const page = await fetch(`${base}/employees?q=1`, { redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), 'https://localhost:8443/employees?q=1');
  assert.equal((await fetch(`${base}/api/admin/auth/session`)).status, 403);
  assert.equal((await fetch(`${base}/health`)).status, 200);
  // 단말과 AI는 HTTP로 계속 받는다 (토큰·키가 없어 401이지 막히지는 않는다)
  assert.equal((await fetch(`${base}/api/terminal/light`)).status, 401);
  assert.equal(
    (await fetch(`${base}/api/modules/camera/ai/face/appear`, { method: 'POST' })).status,
    401,
  );
});
