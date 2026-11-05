import path from 'node:path';
import { Router } from 'express';
import { parseAppear, parseDisappear, parseEventTime, parseStatus } from './ai.dto.ts';
import type { AiService } from './ai.service.ts';

const AI_BASE = '/api/modules/camera/ai';

// 경로는 엣지서버와 같음 → AI 프로그램은 주소·키만 바꾸면 됨 (04 문서 IF-1). 인증은 server.ts에서 붙임.
export function createAiRouter(ai: AiService): Router {
  const router = Router();

  router.get('/file/:employeeKey/:fileName', (req, res) => {
    const employeeKey = Number(req.params.employeeKey);
    const { fileName } = req.params;
    if (!Number.isInteger(employeeKey) || path.basename(fileName) !== fileName) {
      res.sendStatus(400);
      return;
    }
    res.sendFile(ai.facePath(employeeKey, fileName), (error) => {
      if (error && !res.headersSent) res.sendStatus(404);
    });
  });

  router.get(`${AI_BASE}/rtsp`, (_req, res) => {
    res.json(ai.rtspList());
  });

  router.get(`${AI_BASE}/face/dataset`, (_req, res) => {
    const dataset = ai.dataset();
    if (dataset.length === 0) res.sendStatus(204);
    else res.json(dataset);
  });

  router.post(`${AI_BASE}/face/appear`, async (req, res) => {
    const dto = parseAppear(req.body);
    const eventKey = dto && (await ai.handleAppear(dto));
    if (!eventKey) {
      res.status(400).json({ error: 'invalid appear' });
      return;
    }
    res.json({ event_key: eventKey });
  });

  router.post(`${AI_BASE}/face/disappear`, (req, res) => {
    const dto = parseDisappear(req.body);
    if (!dto) {
      res.status(400).json({ error: 'invalid disappear' });
      return;
    }
    ai.handleDisappear(dto);
    res.sendStatus(201);
  });

  router.post(`${AI_BASE}/power-on`, (req, res) => {
    const eventTime = parseEventTime(req.body);
    if (!eventTime) {
      res.status(400).json({ error: 'invalid event_time' });
      return;
    }
    ai.powerOn(eventTime);
    res.json({});
  });

  router.post(`${AI_BASE}/status`, (req, res) => {
    const dto = parseStatus(req.body);
    if (!dto) {
      res.status(400).json({ error: 'invalid status' });
      return;
    }
    ai.status(dto);
    res.json({});
  });

  return router;
}
