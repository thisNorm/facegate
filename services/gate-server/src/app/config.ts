import fs from 'node:fs';
import type { Gate } from '../modules/gate/gate.types.ts';
import type { AppEnv } from '../modules/admin/admin.types.ts';

export type Config = {
  port: number;
  dbPath: string;
  fileDir: string;
  ingestKey?: string;
  gatesFile: string;
  duplicateWindowMs: number;
  initialAdminId?: string;
  initialAdminPassword?: string;
  appEnv: AppEnv;
  adminWebDir: string;
  ffmpegPath: string;
  backupDir: string;
  backupKeepDays: number;
  /** 둘 다 있으면 관리자 웹을 HTTPS로도 연다 (P6). 단말과 AI는 계속 HTTP(port) */
  tls?: { certFile: string; keyFile: string; port: number };
  /** 핸드폰이 여는 서버 주소 (D-62). 없으면 핸드폰으로 열기를 끈다 */
  phoneBaseUrl?: string;
};

export type ServerConfig = Pick<Config, 'ingestKey' | 'fileDir' | 'duplicateWindowMs'> &
  Partial<
    Pick<
      Config,
      | 'initialAdminId'
      | 'initialAdminPassword'
      | 'appEnv'
      | 'adminWebDir'
      | 'ffmpegPath'
      | 'tls'
      | 'phoneBaseUrl'
    >
  >;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const duplicateWindowSec = Number(env.DUPLICATE_WINDOW_SEC || 5);
  if (!Number.isFinite(duplicateWindowSec) || duplicateWindowSec <= 0)
    throw new Error('DUPLICATE_WINDOW_SEC must be a positive number');
  const backupKeepDays = Number(env.BACKUP_KEEP_DAYS || 14);
  if (!Number.isInteger(backupKeepDays) || backupKeepDays < 1)
    throw new Error('BACKUP_KEEP_DAYS must be a whole number of days, 1 or more');
  if (!env.TLS_CERT_FILE !== !env.TLS_KEY_FILE)
    throw new Error('TLS_CERT_FILE and TLS_KEY_FILE must be set together');
  const phoneBaseUrl = (env.PHONE_BASE_URL || '').replace(/\/+$/, '') || undefined;
  if (phoneBaseUrl && !/^https?:\/\/[^/?#]+$/.test(phoneBaseUrl))
    throw new Error('PHONE_BASE_URL must be like https://gate.example.co.kr:8443');
  const appEnv = env.APP_ENV || 'production';
  if (appEnv !== 'development' && appEnv !== 'production')
    throw new Error('APP_ENV must be development or production');
  return {
    port: Number(env.PORT || 8080),
    dbPath: env.DB_PATH || 'storage/facegate.db',
    fileDir: env.FILE_DIR || 'storage/files',
    ingestKey: env.INGEST_KEY || undefined,
    gatesFile: env.GATES_FILE || 'config/gates.json',
    duplicateWindowMs: duplicateWindowSec * 1000,
    initialAdminId: env.INITIAL_ADMIN_ID || undefined,
    initialAdminPassword: env.INITIAL_ADMIN_PASSWORD || undefined,
    appEnv,
    adminWebDir: env.ADMIN_WEB_DIR || '../../apps/admin-web/dist',
    ffmpegPath: env.FFMPEG_PATH || 'ffmpeg',
    backupDir: env.BACKUP_DIR || 'storage/backup',
    backupKeepDays,
    tls:
      env.TLS_CERT_FILE && env.TLS_KEY_FILE
        ? {
            certFile: env.TLS_CERT_FILE,
            keyFile: env.TLS_KEY_FILE,
            port: Number(env.HTTPS_PORT || 8443),
          }
        : undefined,
    phoneBaseUrl,
  };
}

/** gates.json 형식. 토큰은 원문이고 DB로 가져올 때 해시로 바꾼다 */
export type FileGate = Omit<Gate, 'terminals' | 'floor' | 'openToAll'> & {
  floor?: number;
  /** 없으면 true (권한 기능 이전처럼 모두 통과) */
  openToAll?: boolean;
  terminals: { terminalKey: number; token: string; rtspUri: string }[];
};

export function loadGates(path: string | URL): FileGate[] {
  const { gates } = JSON.parse(fs.readFileSync(path, 'utf8')) as { gates: FileGate[] };
  const seen = new Set<number>();
  for (const gate of gates) {
    if ('cameras' in gate)
      throw new Error(
        `gates.json 형식이 바뀌었습니다: 게이트 ${gate.gateKey}의 cameras를 terminals[].terminalKey·rtspUri로 옮기세요 (단말 = 카메라)`,
      );
    if (gate.floor !== undefined && !Number.isInteger(gate.floor))
      throw new Error(`게이트 ${gate.gateKey}의 floor는 정수여야 합니다 (지하는 음수)`);
    for (const t of gate.terminals) {
      if (!Number.isSafeInteger(t.terminalKey) || !t.token || !t.rtspUri)
        throw new Error(
          `게이트 ${gate.gateKey}의 단말에는 terminalKey, token, rtspUri가 모두 필요합니다`,
        );
      if (seen.has(t.terminalKey)) throw new Error(`단말 번호 ${t.terminalKey}가 중복됩니다`);
      seen.add(t.terminalKey);
    }
  }
  return gates;
}
