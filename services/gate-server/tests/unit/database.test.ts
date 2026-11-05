import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/infrastructure/database/database.ts';
import { createRepositories } from '../../src/app/repositories.ts';

test('openDatabase adds new columns to a database made by an older version', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'facegate-db-')), 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE face_image (
    face_image_key INTEGER PRIMARY KEY, employee_key INTEGER NOT NULL,
    file_name TEXT NOT NULL, created_at TEXT NOT NULL)`);
  old.exec("INSERT INTO face_image (employee_key, file_name, created_at) VALUES (1, 'a.jpg', 'x')");
  old.close();

  const sql = openDatabase(file);
  const row = sql.prepare('SELECT source, registered_by AS registeredBy FROM face_image').get() as {
    source: string;
    registeredBy: number | null;
  };
  assert.equal(row.source, 'WEB_UPLOAD');
  assert.equal(row.registeredBy, null);
  sql.close();
  openDatabase(file).close(); // 두 번 열어도 오류 없음
});

test('openDatabase adds access_log columns to the original PoC table', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'facegate-db-')), 'poc.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE access_log (
    event_key INTEGER PRIMARY KEY, device_key INTEGER, gate_key INTEGER, employee_key INTEGER,
    ai_track_key INTEGER, method TEXT NOT NULL, result TEXT NOT NULL, appear_time TEXT,
    received_at TEXT NOT NULL, opened_at TEXT, disappear_time TEXT, duration_sec INTEGER,
    full_image TEXT, crop_image TEXT)`);
  old.exec(
    "INSERT INTO access_log (gate_key, method, result, received_at) VALUES (1, 'FACE', 'GRANTED', 'x')",
  );
  old.close();

  const sql = openDatabase(file);
  const row = sql
    .prepare('SELECT images_purged AS purged, remote_reason AS reason FROM access_log')
    .get() as { purged: number; reason: string | null };
  assert.equal(row.purged, 0);
  assert.equal(row.reason, null);
  sql.close();
});

test('openDatabase renames camera columns to terminal ones and keeps the values', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'facegate-db-')), 'cam.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE access_log (
    event_key INTEGER PRIMARY KEY, device_key INTEGER, gate_key INTEGER,
    method TEXT NOT NULL, result TEXT NOT NULL, appear_time TEXT, received_at TEXT NOT NULL)`);
  old.exec(
    "INSERT INTO access_log (device_key, gate_key, method, result, received_at) VALUES (101, 1, 'FACE', 'GRANTED', 'x')",
  );
  old.exec(`CREATE TABLE ai_status (id INTEGER PRIMARY KEY, power_on_at TEXT,
    last_status_at TEXT, cameras TEXT)`);
  old.exec(`INSERT INTO ai_status (id, cameras) VALUES (1, '[]')`);
  old.close();

  const sql = openDatabase(file);
  assert.deepEqual(
    { ...(sql.prepare('SELECT terminal_key AS terminalKey FROM access_log').get() as object) },
    { terminalKey: 101 },
  );
  assert.deepEqual(
    { ...(sql.prepare('SELECT rtsp_report AS report FROM ai_status').get() as object) },
    { report: '[]' },
  );
  sql.close();
  openDatabase(file).close(); // 두 번 열어도 오류 없음
});

test('old gate rows become open to all, new gates default to closed', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'facegate-db-')), 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE gate (gate_key INTEGER PRIMARY KEY, name TEXT NOT NULL,
    adapter TEXT NOT NULL, created_at TEXT NOT NULL)`);
  old.exec(`INSERT INTO gate VALUES (1, '정문', '{"type":"MOCK"}', '2026-11-01 09:00:00')`);
  old.close();

  const repos = createRepositories(openDatabase(file));
  assert.deepEqual(
    [repos.gates.getGate(1)?.floor, repos.gates.getGate(1)?.openToAll],
    [null, true],
  );
  const key = repos.gates.insertGate(
    { name: '3층 동측', adapter: { type: 'MOCK' }, floor: 3 },
    'x',
  );
  assert.deepEqual(
    [repos.gates.getGate(key)?.floor, repos.gates.getGate(key)?.openToAll],
    [3, false],
  );
});
