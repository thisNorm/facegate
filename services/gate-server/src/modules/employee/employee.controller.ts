import { CONSENT_VERSION } from './consent.ts';
import { Router } from 'express';
import type { Admin } from '../admin/admin.types.ts';
import type { AuditService } from '../audit/audit.service.ts';
import {
  parseAddPhotos,
  parseEmployeeFilter,
  parseRegisterEmployee,
  parseUpdateEmployee,
} from './employee.dto.ts';
import type { EmployeeService } from './employee.service.ts';

/** terminalSource: 단말 관리자 모드에 붙일 때 사진 경로를 TERMINAL로 고정 (FR-T-18) */
export function createEmployeeRouter(
  service: EmployeeService,
  audit: AuditService,
  terminalSource = false,
): Router {
  const router = Router();
  const keyOf = (value: string) => (/^\d+$/.test(value) ? Number(value) : null);

  router.get('/employees', (req, res) => {
    const filter = parseEmployeeFilter(req.query as Record<string, unknown>);
    if (!filter) {
      res.status(400).json({ error: 'status must be ACTIVE or RETIRED' });
      return;
    }
    res.json(service.list(filter));
  });

  router.get('/employees/:employeeKey', (req, res) => {
    const employeeKey = keyOf(req.params.employeeKey);
    const detail = employeeKey === null ? null : service.detail(employeeKey);
    if (!detail) res.sendStatus(404);
    else res.json(detail);
  });

  router.post('/employees/:employeeKey/photos', (req, res) => {
    const employeeKey = keyOf(req.params.employeeKey);
    if (employeeKey === null) {
      res.sendStatus(404);
      return;
    }
    const dto = parseAddPhotos(req.body);
    if (dto && terminalSource) dto.source = 'TERMINAL';
    if (!dto) {
      res
        .status(400)
        .json({ error: 'photos must be JPEG images; source must be WEB_UPLOAD or WEBCAM' });
      return;
    }
    const admin = res.locals.admin as Admin;
    // 이미 동의가 있으면 consent: true를 보내도 새 동의가 아니다
    const consentNow = dto.consent && !service.detail(employeeKey)?.consentAt;
    const result = service.addPhotos(
      employeeKey,
      dto.photos,
      dto.source,
      admin.adminKey,
      dto.consent,
    );
    if (result === 'NOT_FOUND') res.sendStatus(404);
    else if (result === 'RETIRED') res.status(409).json({ error: 'employee is retired' });
    else if (result === 'NO_CONSENT') res.status(400).json({ error: 'consent required' });
    else if (result === 'TOO_MANY')
      res.status(409).json({ error: 'an employee can have at most 10 photos' });
    else {
      audit.record(admin.adminKey, 'FACE_ADD', `employee:${employeeKey}`, {
        count: result.length,
        source: dto.source,
        ...(consentNow && { consentVersion: CONSENT_VERSION }),
      });
      res.status(201).json({ faceImageKeys: result });
    }
  });

  router.delete('/employees/:employeeKey/photos/:faceImageKey', (req, res) => {
    const employeeKey = keyOf(req.params.employeeKey);
    const faceImageKey = keyOf(req.params.faceImageKey);
    if (
      employeeKey === null ||
      faceImageKey === null ||
      !service.deletePhoto(employeeKey, faceImageKey)
    ) {
      res.sendStatus(404);
      return;
    }
    audit.record((res.locals.admin as Admin).adminKey, 'FACE_DELETE', `employee:${employeeKey}`, {
      faceImageKey,
    });
    res.json({});
  });

  router.get('/employees/:employeeKey/photos/:faceImageKey', (req, res) => {
    const employeeKey = keyOf(req.params.employeeKey);
    const faceImageKey = keyOf(req.params.faceImageKey);
    const file =
      employeeKey === null || faceImageKey === null
        ? null
        : service.photoPath(employeeKey, faceImageKey);
    if (!file) {
      res.sendStatus(404);
      return;
    }
    res.set('Cache-Control', 'private, no-store');
    res.type('image/jpeg').sendFile(file, (error) => {
      if (error && !res.headersSent) res.sendStatus(404);
    });
  });

  router.patch('/employees/:employeeKey', (req, res) => {
    const employeeKey = keyOf(req.params.employeeKey);
    if (employeeKey === null) {
      res.sendStatus(404);
      return;
    }
    const dto = parseUpdateEmployee(req.body);
    if (!dto) {
      res.status(400).json({ error: 'send employeeNo, name or department as non-empty strings' });
      return;
    }
    const result = service.update(employeeKey, dto);
    if (result === 'NOT_FOUND') res.sendStatus(404);
    else if (result === 'UNKNOWN_DEPARTMENT') res.status(400).json({ error: 'unknown department' });
    else if (result === 'DUPLICATE_NO')
      res.status(409).json({ error: 'employee number already exists' });
    else {
      audit.record(
        (res.locals.admin as Admin).adminKey,
        'EMPLOYEE_UPDATE',
        `employee:${employeeKey}`,
        { ...dto },
      );
      res.json(result);
    }
  });

  router.post('/employees', (req, res) => {
    const dto = parseRegisterEmployee(req.body);
    if (dto && terminalSource) dto.source = 'TERMINAL';
    if (!dto) {
      res.status(400).json({
        error: 'employeeNo, name, 1 to 6 different JPEG photos and consent: true are required',
      });
      return;
    }
    const employeeKey = service.register(dto, (res.locals.admin as Admin).adminKey);
    if (employeeKey === 'UNKNOWN_DEPARTMENT') {
      res.status(400).json({ error: 'unknown department' });
      return;
    }
    if (employeeKey === 'DUPLICATE_NO') {
      res.status(409).json({ error: 'employee number already exists' });
      return;
    }
    audit.record(
      (res.locals.admin as Admin).adminKey,
      'EMPLOYEE_REGISTER',
      `employee:${employeeKey}`,
      {
        employeeNo: dto.employeeNo,
        photos: dto.photos.length,
        consentVersion: CONSENT_VERSION,
      },
    );
    res.json({ employeeKey });
  });

  router.post('/employees/:employeeKey/retire', (req, res) => {
    const employeeKey = Number(req.params.employeeKey);
    if (!service.retire(employeeKey)) {
      res.sendStatus(404);
      return;
    }
    audit.record(
      (res.locals.admin as Admin).adminKey,
      'EMPLOYEE_RETIRE',
      `employee:${employeeKey}`,
    );
    res.json({});
  });

  return router;
}
