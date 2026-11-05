import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import express, { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { requireKey } from '../shared/auth.ts';
import { createFileStore } from '../infrastructure/filesystem/file-store.ts';
import { createAccessRouter } from '../modules/access/access.controller.ts';
import {
  createAdminAccountRouter,
  createAuthRouter,
  rejectCrossSite,
  requireAdmin,
} from '../modules/admin/admin.controller.ts';
import { createAdminService } from '../modules/admin/admin.service.ts';
import { createAuditRouter } from '../modules/audit/audit.controller.ts';
import { auditVia, createAuditService } from '../modules/audit/audit.service.ts';
import { createAiRouter } from '../modules/ai/ai.controller.ts';
import { createAiService } from '../modules/ai/ai.service.ts';
import { createFaceTerminalRouter } from '../modules/ai/ai.terminal.ts';
import { createEmployeeRouter } from '../modules/employee/employee.controller.ts';
import { createConsentRouter } from '../modules/employee/consent.ts';
import { createEmployeeService } from '../modules/employee/employee.service.ts';
import { createOrgRouter, createOrgTerminalRouter } from '../modules/org/org.controller.ts';
import {
  createPassCodes,
  createPhoneAdminRouter,
  createPhonePass,
  createPhonePublicRouter,
  createPhoneTerminalRouter,
} from '../modules/phone/phone.ts';
import { createPermissionRouter } from '../modules/permission/permission.controller.ts';
import { kst } from '../shared/time.ts';
import { createStatusRouter } from '../modules/status/status.controller.ts';
import { createStatusService } from '../modules/status/status.service.ts';
import { createSettingRouter, updateLightHandler } from '../modules/setting/setting.controller.ts';
import {
  createSettingService,
  type TerminalLight,
  type TerminalVoice,
} from '../modules/setting/setting.service.ts';
import { createGateRouter } from '../modules/gate/gate.controller.ts';
import { createGateAdmin } from '../modules/gate/gate.admin.ts';
import { createRemoteOpenService } from '../modules/gate/gate.remote.ts';
import { createTerminalVideoRouter } from '../modules/terminal/terminal.video.controller.ts';
import { createTerminalVideo, type TerminalVideo } from '../modules/terminal/terminal.video.ts';
import type { GateRegistry } from '../modules/gate/gate.registry.ts';
import type { GateControl } from '../modules/gate/gate.types.ts';
import {
  createPinSessions,
  createTerminalAdminRouter,
  createTerminalOpenRouter,
  requireTerminal,
  requireTerminalAdmin,
} from '../modules/terminal/terminal.admin.controller.ts';
import {
  createVisitorAdminRouter,
  createVisitorTerminalRouter,
} from '../modules/visitor/visitor.ts';
import type { TerminalHub } from '../modules/terminal/terminal.types.ts';
import {
  createPairAdminRouter,
  createPairingRouter,
} from '../modules/terminal/terminal.pairing.controller.ts';
import {
  createPairingService,
  serverUrlsFrom,
  type Push,
} from '../modules/terminal/terminal.pairing.ts';
import type { ServerConfig } from './config.ts';
import type { Repositories } from './repositories.ts';

export async function createServer({
  config,
  repos,
  registry,
  gateControl,
  terminalHub,
  terminalVideo,
  pairingPush,
  now = () => new Date(),
}: {
  config: ServerConfig;
  repos: Repositories;
  /** DB 게이트·단말. registry.gates는 바뀌어도 같은 배열이라 모듈들이 그대로 읽는다 */
  registry: GateRegistry;
  gateControl: GateControl;
  terminalHub: TerminalHub;
  terminalVideo?: TerminalVideo;
  /** 번호 연결에서 단말로 보내는 함수 (테스트용 교체) */
  pairingPush?: Push;
  now?: () => Date;
}): Promise<http.Server> {
  const gates = registry.gates;
  const files = createFileStore(config.fileDir);
  const employees = createEmployeeService({
    employees: repos.employees,
    files,
    now,
    knownDepartment: (name) => repos.orgs.getByName(name) !== undefined,
  });
  const audit = createAuditService({ audits: repos.audits, now });
  const admins = createAdminService({
    admins: repos.admins,
    audit,
    now,
    appEnv: config.appEnv ?? 'production',
  });
  await admins.initializeAccounts({
    initialAdminId: config.initialAdminId,
    initialAdminPassword: config.initialAdminPassword,
  });

  const settings = createSettingService({
    settings: repos.settings,
    now,
    defaults: { duplicateWindowSec: Math.max(1, Math.round(config.duplicateWindowMs / 1000)) },
  });
  const ai = createAiService({
    duplicateWindowMs: () => settings.generalSettings().duplicateWindowSec * 1000,
    repos,
    gates,
    gateControl,
    terminalHub,
    files,
    now,
  });
  settings.seedIngestKey(config.ingestKey);
  // 권한 기능 이전에 직원에게 적어 둔 부서 글자를 소속으로 만든다 (D-59)
  const seeded = repos.orgs.seedFromDepartments(kst(now()));
  if (seeded) console.log(`[orgs] 직원 부서 ${seeded}개를 소속으로 만들었습니다.`);
  // 기본 시간표를 만들고 예전 소속별 게이트, 개인 추가 게이트를 권한 그룹으로 옮긴다 (D-61)
  const moved = repos.permissions.prepare(kst(now()));
  if (moved) console.log(`[access] 예전 출입 권한을 권한 그룹 ${moved}개로 옮겼습니다.`);
  if (!settings.ingestKeyInfo().issued)
    console.warn('AI ingest key not issued: POST /api/admin/settings/ingest-key to issue one');

  const remote = createRemoteOpenService({ gates, gateControl, accessLogs: repos.accessLogs, now });
  const gateAdmin = createGateAdmin({ repo: repos.gates, registry, terminalHub, now });
  const pins = createPinSessions(now);
  const pushLight = (light: TerminalLight) => {
    for (const { gateKey } of gates) terminalHub.broadcast(gateKey, { type: 'light', ...light });
  };
  const pushVoice = (voice: TerminalVoice) => {
    for (const { gateKey } of gates) terminalHub.broadcast(gateKey, { type: 'voice', ...voice });
  };
  // 주소 후보에 실제 듣는 포트를 넣으려고 서버를 먼저 만들고 요청 처리는 맨 끝에 붙인다
  const server = http.createServer();
  const pairing = createPairingService({
    repo: repos.gates,
    registry,
    now,
    serverUrls: () => serverUrlsFrom((server.address() as AddressInfo | null)?.port ?? 0),
    push: pairingPush,
    onPaired: (adminKey, terminalKey, gateKey, method) =>
      audit.record(adminKey, 'TERMINAL_PAIR', `terminal:${terminalKey}`, { gateKey, method }),
  });
  const video = terminalVideo ?? createTerminalVideo({ gates, ffmpegPath: config.ffmpegPath });

  const status = createStatusService({
    gates,
    aiStatus: repos.aiStatus,
    terminalHub,
    settings,
    now,
  });

  const passCodes = createPassCodes(now);
  const phonePass = createPhonePass({
    phones: repos.phones,
    codes: passCodes,
    repos,
    gates,
    gateControl,
    terminalHub,
    now,
  });
  const consent = createConsentRouter(() => settings.generalSettings().photoRetentionDays);
  const app = express();
  // HTTPS를 켜면 관리자 웹은 HTTPS로만. 단말(/api/terminal, /ws)과 AI(/api/modules, /file)는 HTTP 그대로
  const tls = config.tls;
  if (tls)
    app.use((req, res, next) => {
      if (req.secure || /^\/(api\/terminal|api\/modules|file|ws|health)(\/|$)/.test(req.path)) {
        next();
        return;
      }
      if (req.path.startsWith('/api/')) res.status(403).json({ error: 'use https' });
      // 302: 나중에 HTTPS를 끄거나 포트를 바꿔도 브라우저가 기억한 이동이 남지 않게
      else res.redirect(302, `https://${req.hostname}:${tls.port}${req.originalUrl}`);
    });
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  // 작업 이력에 어디서 한 일인지 남김. 본문 읽기(express.json)가 끝난 뒤에 정해야 이어진다
  const via =
    (where: (res: Response) => string): RequestHandler =>
    (_req, res, next) =>
      auditVia.run(where(res), next);
  const fromWeb = via(() => 'WEB');
  const fromTerminal = via(
    (res) => `TERMINAL:${(res.locals.terminal as { terminalKey: number }).terminalKey}`,
  );
  app.use('/api/admin/auth', rejectCrossSite, express.json(), fromWeb, createAuthRouter(admins));
  app.use(
    '/api/admin',
    rejectCrossSite,
    requireAdmin(admins),
    express.json({ limit: '20mb' }), // 직원 등록은 base64 사진 여러 장
    fromWeb,
    createAdminAccountRouter(admins),
    createEmployeeRouter(employees, audit),
    consent,
    createAccessRouter({ accessLogs: repos.accessLogs, gates, fileDir: config.fileDir, now }),
    createSettingRouter(settings, audit, pushLight, pushVoice),
    createOrgRouter(repos.orgs, audit, now),
    createPermissionRouter({
      permissions: repos.permissions,
      audit,
      now,
      exists: {
        gates: (keys) => keys.every((k) => repos.gates.getGate(k) !== undefined),
        orgs: (keys) => keys.every((k) => repos.orgs.get(k) !== undefined),
        employees: (keys) => keys.every((k) => repos.employees.getEmployee(k) !== undefined),
      },
      employeeOf: (employeeKey) => repos.employees.getEmployee(employeeKey),
    }),
    createAuditRouter(repos.audits),
    createGateRouter(remote, gateAdmin, audit),
    createTerminalVideoRouter(video),
    createStatusRouter(status),
    createPairAdminRouter(pairing, audit),
    createVisitorAdminRouter({ calls: repos.visitors, files, audit, now }),
    createPhoneAdminRouter({
      phones: repos.phones,
      audit,
      now,
      baseUrl: config.phoneBaseUrl,
      employeeExists: (key) => repos.employees.getEmployee(key) !== undefined,
    }),
  );
  app.use('/api/terminal', createPairingRouter(pairing));
  app.use(
    '/api/terminal',
    requireTerminal(gates),
    express.json({ limit: '20mb' }),
    fromTerminal,
    createTerminalAdminRouter({ admins, settings, pins, audit }),
    // 동의서 문구는 비밀이 아니라 연결된 단말이면 읽는다 (등록 화면, 개발용 미리 보기)
    consent,
    createVisitorTerminalRouter({ calls: repos.visitors, files, audit, now }),
    createPhoneTerminalRouter(passCodes, config.phoneBaseUrl),
    createFaceTerminalRouter(ai, settings),
    // 여기부터 단말 관리자 모드 (FR-T-07, FR-T-18): 직원 등록·수정·퇴사, 문 열기
    requireTerminalAdmin(admins, pins),
    createOrgTerminalRouter(repos.orgs),
    createEmployeeRouter(employees, audit, true),
    createTerminalOpenRouter(remote, audit),
    Router().put('/light', updateLightHandler(settings, audit, pushLight)),
  );
  // 핸드폰 브라우저 (D-62). HTTPS를 켜면 위에서 관리자 웹처럼 HTTPS로 넘긴다
  app.use(
    '/m',
    express.json(),
    createPhonePublicRouter({
      phones: repos.phones,
      pass: phonePass,
      now,
      employeeName: (key) => repos.employees.getEmployee(key)?.name,
    }),
  );
  app.use(
    ['/api/modules/camera/ai', '/file'],
    requireKey('X-Ingest-Key', settings.verifyIngestKey),
    express.json({ limit: '20mb' }), // appear에 1080p 원본+얼굴 사진 base64가 들어옴
  );
  app.use(createAiRouter(ai));
  // 관리자 웹(P3) 빌드 결과. 화면 주소로 새로고침해도 index.html을 돌려줌
  if (config.adminWebDir && fs.existsSync(path.join(config.adminWebDir, 'index.html'))) {
    const webDir = path.resolve(config.adminWebDir);
    app.use(express.static(webDir, { index: 'index.html' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || /^\/(api|file|ws|health|m)(\/|$)/.test(req.path)) {
        next();
        return;
      }
      res.sendFile(path.join(webDir, 'index.html'));
    });
  }

  app.use(
    (
      error: Error & { status?: number; statusCode?: number },
      req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      if (res.headersSent) {
        next(error);
        return;
      }
      const status = error.status ?? error.statusCode;
      if (status !== undefined && status >= 400 && status <= 499) {
        // error.message에 요청 본문 일부(비밀번호 등)가 섞일 수 있어 남기지 않음
        console.warn(`client error ${status} ${req.method} ${req.originalUrl} (${error.name})`);
        res.status(status).json({ error: 'bad request' });
        return;
      }
      console.error(`unhandled error: ${error.stack ?? error.message}`);
      res.status(500).json({ error: 'internal error' });
    },
  );

  server.on('request', app);
  server.on('close', () => video.close());
  server.on('upgrade', terminalHub.handleUpgrade);
  return server;
}
