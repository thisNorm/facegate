import path from 'node:path';
import { Router } from 'express';
import { parseAppear } from './ai.dto.ts';
import type { AiService } from './ai.service.ts';
import type { SettingService } from '../setting/setting.service.ts';

/**
 * 단말 안 얼굴 인식 (D-63). 단말이 AI 서버 역할을 맡아 등록 사진을 받고 인식 결과를 appear로 보낸다.
 * 판정과 같은 사람 합치기는 AI 서버 appear와 같은 길(ai.handleAppear). 단말 번호는 토큰에서 정한다.
 * 인증은 server.ts의 requireTerminal.
 */
export function createFaceTerminalRouter(
  ai: AiService,
  settings: Pick<SettingService, 'faceEngine'>,
): Router {
  const router = Router();
  const onTerminal = () => settings.faceEngine() === 'TERMINAL';

  // 단말은 사진 목록이 바뀔 때만 다시 받는다. 꺼져 있으면 빈 목록 (등록 사진을 내보내지 않음)
  router.get('/face/dataset', (_req, res) => {
    const enabled = onTerminal();
    res.set('Cache-Control', 'no-store');
    res.json({
      enabled,
      faces: enabled
        ? ai.dataset().map((f) => ({
            worker_key: f.worker_key,
            image_path: f.image_path.map((p) => `/face${p}`),
          }))
        : [],
    });
  });

  router.get('/face/file/:employeeKey/:fileName', (req, res) => {
    const employeeKey = Number(req.params.employeeKey);
    const { fileName } = req.params;
    if (!onTerminal()) {
      res.sendStatus(404);
      return;
    }
    if (!Number.isInteger(employeeKey) || path.basename(fileName) !== fileName) {
      res.sendStatus(400);
      return;
    }
    res.set('Cache-Control', 'no-store');
    res.sendFile(ai.facePath(employeeKey, fileName), (error) => {
      if (error && !res.headersSent) res.sendStatus(404);
    });
  });

  router.post('/face/appear', async (req, res) => {
    if (!onTerminal()) {
      res.status(409).json({ error: 'face engine is AI_SERVER' });
      return;
    }
    const { terminalKey } = res.locals.terminal as { terminalKey: number };
    const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
    const dto = parseAppear({ ...body, device_key: terminalKey });
    const eventKey = dto && (await ai.handleAppear(dto));
    if (!eventKey) {
      res.status(400).json({ error: 'invalid appear' });
      return;
    }
    res.json({ event_key: eventKey });
  });

  return router;
}
