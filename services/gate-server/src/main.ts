import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { loadConfig } from './app/config.ts';
import { createRepositories } from './app/repositories.ts';
import { createServer } from './app/server.ts';
import { createBackup } from './infrastructure/backup.ts';
import { openDatabase } from './infrastructure/database/database.ts';
import { createFileStore } from './infrastructure/filesystem/file-store.ts';
import { createRetentionService } from './modules/access/access.retention.ts';
import { createAuditService } from './modules/audit/audit.service.ts';
import { createSettingService } from './modules/setting/setting.service.ts';
import { scheduleDaily } from './shared/daily.ts';
import { createGateControl } from './modules/gate/gate.service.ts';
import { importGatesFile } from './modules/gate/gate.import.ts';
import { createGateRegistry } from './modules/gate/gate.registry.ts';
import { kst } from './shared/time.ts';
import { createTerminalHub } from './modules/terminal/terminal.websocket.ts';
import { pickReachable } from './modules/terminal/terminal.pairing.ts';

process.on('uncaughtException', (error) => console.error('[uncaught]', error));
process.on('unhandledRejection', (error) => console.error('[unhandled]', error));

const config = loadConfig();
fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const sql = openDatabase(config.dbPath);
const repos = createRepositories(sql);

const backup = createBackup({
  sql,
  fileDir: config.fileDir,
  backupDir: config.backupDir,
  keepDays: config.backupKeepDays,
});
const runBackup = () => {
  try {
    const { db, facesCopied, removed } = backup.run(kst().slice(0, 10));
    console.log(
      `[backup] ${db ?? 'today already saved'}, faces copied ${facesCopied}, old removed ${removed.length}`,
    );
  } catch (error) {
    // 백업 실패가 출입을 막지 않게. 디스크가 찼거나 경로가 없을 때 로그로 알린다
    console.error('[backup]', error);
  }
};
scheduleDaily(4, runBackup);
// 오늘 백업이 없으면 시작할 때 만든다. 서버가 DB를 옮기기(권한 그룹 등) 전이라 옮기기 전 상태가 남는다
runBackup();

importGatesFile(repos.gates, config.gatesFile, kst(new Date()));
const registry = createGateRegistry(repos.gates);
registry.reload();
const gates = registry.gates;
const terminalHub = createTerminalHub({
  gates,
  // 단말 IP가 바뀌면 영상 주소를 새 IP로 (D-57). 공유기(NAT) 너머에서 붙으면 접속 주소로는
  // 영상을 못 받으므로 서버가 RTSP 포트에 실제로 닿는 주소를 고른다
  onConnect: (terminalKey, address, reported) => {
    const terminal = repos.gates.getTerminal(terminalKey);
    if (!terminal) return;
    repos.gates.touchTerminal(terminalKey, terminal.lastIp, kst(new Date()));
    const candidates = [terminal.lastIp, address, ...reported, '127.0.0.1'];
    void pickReachable(candidates, terminal.rtspPort).then((ip) => {
      if (!ip || ip === terminal.lastIp) return;
      repos.gates.touchTerminal(terminalKey, ip, kst(new Date()));
      registry.reload();
    });
  },
});
const gateControl = createGateControl();
gateControl.releaseAll(gates).catch((error: Error) => console.error('[release]', error));
const server = await createServer({
  config,
  repos,
  registry,
  gateControl,
  terminalHub,
});

const retention = createRetentionService({
  accessLogs: repos.accessLogs,
  visitors: repos.visitors,
  files: createFileStore(config.fileDir),
  settings: createSettingService({ settings: repos.settings }),
  audit: createAuditService({ audits: repos.audits }),
});
// 파일 시스템 오류가 서버 시작·스케줄을 막지 않게 여기서 잡는다
const purge = () => {
  try {
    console.log(`[retention] purged photos of ${retention.purge()} events`);
  } catch (error) {
    console.error('[retention]', error);
  }
};
scheduleDaily(3, purge);

if (config.tls) {
  const secure = https.createServer({
    cert: fs.readFileSync(config.tls.certFile),
    key: fs.readFileSync(config.tls.keyFile),
  });
  // 같은 앱과 단말 WebSocket 처리를 그대로 쓴다
  secure.on('request', (req, res) => server.emit('request', req, res));
  secure.on('upgrade', (req, socket, head) => server.emit('upgrade', req, socket, head));
  secure.listen(config.tls.port, () => console.log(`[FaceGate] https on ${config.tls!.port}`));
}

server.listen(config.port, () => {
  console.log(
    `[FaceGate] listening on ${config.port}, gates: ${gates.map((g) => g.gateKey).join(',')}`,
  );
  purge(); // 03시에 서버가 꺼져 있었던 날도 놓치지 않게 시작할 때 한 번
});
