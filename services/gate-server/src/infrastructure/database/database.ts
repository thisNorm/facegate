import { DatabaseSync } from 'node:sqlite';
import { toJamo } from '../../shared/jamo.ts';

// shortcut: 시작할 때 CREATE IF NOT EXISTS로 스키마를 만듦, 1차 개발에서 migrations/ 번호 파일로 바꿈
const SCHEMA = `
CREATE TABLE IF NOT EXISTS employee (
  employee_key INTEGER PRIMARY KEY,
  employee_no TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  consent_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS face_image (
  face_image_key INTEGER PRIMARY KEY,
  employee_key INTEGER NOT NULL REFERENCES employee (employee_key) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'WEB_UPLOAD',
  registered_by INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS access_log (
  event_key INTEGER PRIMARY KEY,
  terminal_key INTEGER,
  gate_key INTEGER,
  employee_key INTEGER,
  ai_track_key INTEGER,
  method TEXT NOT NULL,
  result TEXT NOT NULL,
  appear_time TEXT,
  received_at TEXT NOT NULL,
  opened_at TEXT,
  disappear_time TEXT,
  duration_sec INTEGER,
  full_image TEXT,
  crop_image TEXT,
  remote_reason TEXT,
  remote_note TEXT,
  visitor_name TEXT,
  visitor_company TEXT,
  visit_target_key INTEGER,
  admin_key INTEGER,
  images_purged INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS access_log_appear ON access_log (appear_time);
CREATE INDEX IF NOT EXISTS access_log_received ON access_log (received_at);
CREATE TABLE IF NOT EXISTS ai_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  power_on_at TEXT,
  last_status_at TEXT,
  rtsp_report TEXT
);
CREATE TABLE IF NOT EXISTS setting (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_user (
  admin_key INTEGER PRIMARY KEY,
  login_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  must_change_credentials INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_session (
  token_hash TEXT PRIMARY KEY,
  admin_key INTEGER NOT NULL REFERENCES admin_user (admin_key) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  audit_key INTEGER PRIMARY KEY,
  admin_key INTEGER,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_log_created ON audit_log (created_at);
CREATE TABLE IF NOT EXISTS gate (
  gate_key INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  adapter TEXT NOT NULL,
  floor INTEGER,
  open_to_all INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS terminal (
  terminal_key INTEGER PRIMARY KEY,
  gate_key INTEGER NOT NULL REFERENCES gate (gate_key),
  name TEXT NOT NULL,
  model TEXT,
  app_version TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  rtsp_user TEXT NOT NULL,
  rtsp_password TEXT NOT NULL,
  rtsp_port INTEGER NOT NULL,
  last_ip TEXT NOT NULL,
  last_seen_at TEXT,
  paired_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS visitor_call (
  call_key INTEGER PRIMARY KEY,
  gate_key INTEGER NOT NULL,
  terminal_key INTEGER NOT NULL,
  has_photo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  ack_at TEXT,
  ack_by INTEGER
);
CREATE TABLE IF NOT EXISTS org (
  org_key INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL
);
-- 권한 그룹, 시간표, 휴일 (D-61). 예전 org_gate, employee_gate는 permission.repository가 옮기고 지운다
CREATE TABLE IF NOT EXISTS schedule (
  schedule_key INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  days TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS holiday (
  date TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS access_group (
  group_key INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  schedule_key INTEGER NOT NULL REFERENCES schedule (schedule_key),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS access_group_gate (
  group_key INTEGER NOT NULL REFERENCES access_group (group_key) ON DELETE CASCADE,
  gate_key INTEGER NOT NULL REFERENCES gate (gate_key) ON DELETE CASCADE,
  PRIMARY KEY (group_key, gate_key)
);
CREATE TABLE IF NOT EXISTS access_group_org (
  group_key INTEGER NOT NULL REFERENCES access_group (group_key) ON DELETE CASCADE,
  org_key INTEGER NOT NULL REFERENCES org (org_key) ON DELETE CASCADE,
  PRIMARY KEY (group_key, org_key)
);
CREATE TABLE IF NOT EXISTS access_group_employee (
  group_key INTEGER NOT NULL REFERENCES access_group (group_key) ON DELETE CASCADE,
  employee_key INTEGER NOT NULL REFERENCES employee (employee_key) ON DELETE CASCADE,
  PRIMARY KEY (group_key, employee_key)
);
-- 핸드폰으로 열기 (D-62). 등록 링크와 등록된 핸드폰. 토큰은 해시만 둔다
CREATE TABLE IF NOT EXISTS phone_invite (
  token_hash TEXT PRIMARY KEY,
  employee_key INTEGER NOT NULL REFERENCES employee (employee_key) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE TABLE IF NOT EXISTS phone (
  phone_key INTEGER PRIMARY KEY,
  employee_key INTEGER NOT NULL REFERENCES employee (employee_key) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE TABLE IF NOT EXISTS pair_code (
  code TEXT PRIMARY KEY,
  gate_key INTEGER NOT NULL REFERENCES gate (gate_key) ON DELETE CASCADE,
  issued_by INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
`;

// 예전 버전으로 만든 DB에 없는 컬럼을 더함 (CREATE TABLE IF NOT EXISTS는 기존 표를 바꾸지 않음)
// shortcut: 컬럼 추가만 처리, 1차 개발 끝나면 migrations/ 번호 파일로 바꿈
const MIGRATIONS: [table: string, column: string, definition: string][] = [
  ['employee', 'consent_at', 'TEXT'],
  ['admin_user', 'must_change_credentials', 'INTEGER NOT NULL DEFAULT 0'],
  ['face_image', 'source', "TEXT NOT NULL DEFAULT 'WEB_UPLOAD'"],
  ['face_image', 'registered_by', 'INTEGER'],
  ['access_log', 'remote_reason', 'TEXT'],
  ['access_log', 'remote_note', 'TEXT'],
  ['access_log', 'visitor_name', 'TEXT'],
  ['access_log', 'visitor_company', 'TEXT'],
  ['access_log', 'visit_target_key', 'INTEGER'],
  ['access_log', 'admin_key', 'INTEGER'],
  ['access_log', 'images_purged', 'INTEGER NOT NULL DEFAULT 0'],
  ['gate', 'floor', 'INTEGER'],
  ['audit_log', 'via', 'TEXT'],
  ['employee', 'consent_version', 'TEXT'],
  // 권한 기능 이전 게이트는 모든 사람 통과로 옮긴다 (D-59). 새 게이트는 insertGate가 값을 정한다
  ['gate', 'open_to_all', 'INTEGER NOT NULL DEFAULT 1'],
];

// 단말 = 카메라로 통일하면서 바뀐 이름 (D-56). 예전 DB면 이름만 바꿈
const RENAMES: [table: string, from: string, to: string][] = [
  ['access_log', 'device_key', 'terminal_key'],
  ['ai_status', 'cameras', 'rtsp_report'],
];

function renameOldColumns(sql: DatabaseSync): void {
  for (const [table, from, to] of RENAMES) {
    const columns = sql.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (columns.some((c) => c.name === from))
      sql.exec(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`);
  }
}

function addMissingColumns(sql: DatabaseSync): void {
  for (const [table, column, definition] of MIGRATIONS) {
    const columns = sql.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === column))
      sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function openDatabase(path: string): DatabaseSync {
  const sql = new DatabaseSync(path);
  sql.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  sql.exec(SCHEMA);
  renameOldColumns(sql);
  addMissingColumns(sql);
  // 검색에서 입력 중인 한글("기")로도 찾게 자모로 풀어 비교 (shared/jamo.ts)
  sql.function('jamo', { deterministic: true }, (text) =>
    text === null ? null : toJamo(String(text)),
  );
  return sql;
}
