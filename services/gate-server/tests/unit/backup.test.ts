import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createBackup } from '../../src/infrastructure/backup.ts';

test('backup keeps daily DB copies for keepDays and mirrors face photos', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-'));
  const fileDir = path.join(root, 'files');
  const backupDir = path.join(root, 'backup');
  const sql = new DatabaseSync(path.join(root, 'live.db'));
  t.after(() => {
    sql.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  sql.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('first')");
  const face = path.join(fileDir, 'faces', '7', 'a.jpg');
  fs.mkdirSync(path.dirname(face), { recursive: true });
  fs.writeFileSync(face, 'jpeg');
  fs.mkdirSync(path.join(fileDir, 'events', '1'), { recursive: true });
  fs.writeFileSync(path.join(fileDir, 'events', '1', 'full.jpg'), 'event');

  const backup = createBackup({ sql, fileDir, backupDir, keepDays: 2 });
  const first = backup.run('2026-11-01');
  assert.equal(first.facesCopied, 1);
  const copy = new DatabaseSync(first.db!);
  assert.deepEqual({ ...copy.prepare('SELECT v FROM t').get() }, { v: 'first' });
  copy.close();
  assert.equal(fs.existsSync(path.join(backupDir, 'faces', '7', 'a.jpg')), true);
  assert.equal(fs.existsSync(path.join(backupDir, 'events')), false); // 출입 사진은 백업 안 함

  // 같은 날 다시 돌리면 DB 사본은 그대로, 지운 얼굴은 거울에서도 지움
  fs.rmSync(face);
  assert.deepEqual(backup.run('2026-11-01'), { db: null, facesCopied: 0, removed: [] });
  assert.equal(fs.existsSync(path.join(backupDir, 'faces', '7', 'a.jpg')), false);

  backup.run('2026-11-02');
  assert.deepEqual(backup.run('2026-11-03').removed, ['2026-11-01']);
  assert.deepEqual(fs.readdirSync(path.join(backupDir, 'db')).sort(), [
    '2026-11-02.db',
    '2026-11-03.db',
  ]);
});
