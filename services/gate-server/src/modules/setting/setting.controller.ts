import { Router, type RequestHandler } from 'express';
import type { Admin } from '../admin/admin.types.ts';
import type { AuditService } from '../audit/audit.service.ts';
import {
  SettingInputError,
  type SettingService,
  type TerminalLight,
  type TerminalVoice,
} from './setting.service.ts';

/** 작업 이력에 남길 바뀐 항목만. `{ 'terminalLight.granted': ['GREEN', 'BLUE'] }` */
function changes<T extends object>(
  before: T,
  after: T,
  prefix = '',
): Record<string, [unknown, unknown]> {
  return Object.fromEntries(
    Object.entries(after)
      .filter(([key, value]) => before[key as keyof T] !== value)
      .map(([key, value]) => [prefix + key, [before[key as keyof T], value]]),
  );
}

/** 바뀐 것이 있을 때만 작업 이력에 남긴다 (그대로 저장은 남기지 않음) */
function recordSettings(
  audit: AuditService,
  res: { locals: Record<string, unknown> },
  detail: Record<string, unknown>,
): void {
  if (Object.keys(detail).length === 0) return;
  audit.record(
    (res.locals.admin as Pick<Admin, 'adminKey'>).adminKey,
    'SETTINGS_UPDATE',
    null,
    detail,
  );
}

/** 불빛 색 저장. 관리자 웹과 단말 관리자 설정이 같이 쓴다. 저장하면 연결된 단말 모두에 보냄 */
export function updateLightHandler(
  service: Pick<SettingService, 'terminalLight' | 'updateTerminalLight'>,
  audit: AuditService,
  push: (light: TerminalLight) => void,
): RequestHandler {
  return (req, res) => {
    const before = service.terminalLight();
    let updated;
    try {
      updated = service.updateTerminalLight((req.body ?? {}) as Record<string, unknown>);
    } catch (error) {
      if (!(error instanceof SettingInputError)) throw error;
      res.status(400).json({ error: error.message });
      return;
    }
    recordSettings(audit, res, changes(before, updated, 'terminalLight.'));
    push(updated);
    res.json(updated);
  };
}

/** 음성 안내 문구 저장. 저장하면 연결된 단말 모두에 보냄 */
export function updateVoiceHandler(
  service: Pick<SettingService, 'terminalVoice' | 'updateTerminalVoice'>,
  audit: AuditService,
  push: (voice: TerminalVoice) => void,
): RequestHandler {
  return (req, res) => {
    const before = service.terminalVoice();
    let updated;
    try {
      updated = service.updateTerminalVoice((req.body ?? {}) as Record<string, unknown>);
    } catch (error) {
      if (!(error instanceof SettingInputError)) throw error;
      res.status(400).json({ error: error.message });
      return;
    }
    recordSettings(audit, res, changes(before, updated, 'terminalVoice.'));
    push(updated);
    res.json(updated);
  };
}

export function createSettingRouter(
  service: SettingService,
  audit: AuditService,
  pushLight: (light: TerminalLight) => void = () => {},
  pushVoice: (voice: TerminalVoice) => void = () => {},
): Router {
  const router = Router();

  router.get('/settings/terminal-voice', (_req, res) => {
    res.json(service.terminalVoice());
  });
  router.put('/settings/terminal-voice', updateVoiceHandler(service, audit, pushVoice));

  router.get('/settings/terminal-light', (_req, res) => {
    res.json(service.terminalLight());
  });
  router.put('/settings/terminal-light', updateLightHandler(service, audit, pushLight));

  router.get('/settings', (_req, res) => {
    res.json(service.generalSettings());
  });

  router.put('/settings', (req, res) => {
    const input = (req.body ?? {}) as Record<string, unknown>;
    const before = service.generalSettings();
    let updated;
    try {
      updated = service.updateGeneralSettings(input);
    } catch (error) {
      if (!(error instanceof SettingInputError)) throw error;
      res.status(400).json({ error: error.message });
      return;
    }
    recordSettings(audit, res, changes(before, updated));
    res.json(updated);
  });

  router.get('/settings/ingest-key', (_req, res) => {
    res.json(service.ingestKeyInfo());
  });

  // 전체 키는 이 응답에서만 볼 수 있다. 작업 이력에는 마지막 4자리만
  router.post('/settings/ingest-key', (_req, res) => {
    const issued = service.issueIngestKey();
    audit.record((res.locals.admin as Admin).adminKey, 'INGEST_KEY_ISSUE', null, {
      hint: issued.key.slice(-4),
    });
    res.set('Cache-Control', 'no-store');
    res.status(201).json(issued);
  });

  router.get('/settings/face-engine', (_req, res) => {
    res.json({ engine: service.faceEngine() });
  });

  router.put('/settings/face-engine', (req, res) => {
    const before = service.faceEngine();
    let engine;
    try {
      engine = service.updateFaceEngine((req.body ?? {}) as Record<string, unknown>);
    } catch (error) {
      if (!(error instanceof SettingInputError)) throw error;
      res.status(400).json({ error: error.message });
      return;
    }
    recordSettings(audit, res, before === engine ? {} : { faceEngine: [before, engine] });
    res.json({ engine });
  });

  router.get('/settings/terminal-admin', (_req, res) => {
    res.json(service.terminalAdmin());
  });

  // 번호 원문은 이력에 남기지 않는다
  router.put('/settings/terminal-admin', async (req, res) => {
    const input = (req.body ?? {}) as Record<string, unknown>;
    const before = service.terminalAdmin();
    let updated;
    try {
      updated = await service.updateTerminalAdmin(input);
    } catch (error) {
      if (!(error instanceof SettingInputError)) throw error;
      res.status(400).json({ error: error.message });
      return;
    }
    recordSettings(audit, res, {
      ...(before.mode !== updated.mode && { terminalAdminMode: [before.mode, updated.mode] }),
      ...(input.pin !== undefined && { terminalAdminPin: 'changed' }),
    });
    res.json(updated);
  });

  return router;
}
