import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/infrastructure/database/database.ts';

test('an older admin table gets a default-zero flag and can be reopened', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'facegate-migration-'));
  const file = path.join(dir, 'old.db');
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE admin_user (
    admin_key INTEGER PRIMARY KEY, login_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    password_hash TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
    failed_count INTEGER NOT NULL DEFAULT 0, locked_until TEXT, created_at TEXT NOT NULL
  ); INSERT INTO admin_user (login_id, name, password_hash, created_at)
     VALUES ('older.admin', '기존 관리자', 'fake hash', '2026-10-28 09:00:00');`);
  old.close();
  for (let i = 0; i < 2; i++) {
    const sql = openDatabase(file);
    try {
      const row = sql.prepare('SELECT must_change_credentials AS flag FROM admin_user').get() as {
        flag: number;
      };
      assert.equal(row.flag, 0);
      const columns = sql.prepare('PRAGMA table_info(employee)').all() as { name: string }[];
      assert.ok(columns.some((column) => column.name === 'consent_at'));
    } finally {
      sql.close();
    }
  }
});
