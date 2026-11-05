import test from 'node:test';
import assert from 'node:assert/strict';
import { CONSENT_VERSION } from '../../src/modules/employee/consent.ts';
import { JPEG, startServer, photoSet } from './harness.ts';

test('registering photos needs biometric consent, which is stored once', async () => {
  const { server, call, repos, setNow } = await startServer();
  const body = {
    employeeNo: 'E1',
    name: '홍길동',
    photos: photoSet(),
  };
  assert.equal((await call('POST', '/api/admin/employees', body)).status, 400);
  assert.deepEqual(repos.employees.listEmployees({}), []);
  const res = await call('POST', '/api/admin/employees', { ...body, consent: true });
  assert.equal(res.status, 200);
  const { employeeKey } = (await res.json()) as { employeeKey: number };
  const detail = (await (await call('GET', `/api/admin/employees/${employeeKey}`)).json()) as {
    consentAt: string;
    consentVersion: string;
    faces: unknown[];
  };
  assert.equal(detail.consentAt, '2026-11-03 09:00:00');
  assert.equal(detail.consentVersion, CONSENT_VERSION);
  assert.equal(detail.faces.length, 6);
  setNow(new Date('2026-11-03T00:01:00.000Z'));
  // 동의가 있으면 사진 추가 때 다시 안 보내도 됨
  assert.equal(
    (await call('POST', `/api/admin/employees/${employeeKey}/photos`, { photos: [JPEG] })).status,
    201,
  );
  // 이미 동의가 있으면 consent: true를 보내도 새 동의로 이력에 남지 않는다
  await call('POST', `/api/admin/employees/${employeeKey}/photos`, {
    photos: [JPEG],
    consent: true,
  });
  assert.equal(
    (repos.audits.list(1)[0].detail as { consentVersion?: string }).consentVersion,
    undefined,
  );
  const afterAdd = (await (await call('GET', `/api/admin/employees/${employeeKey}`)).json()) as {
    consentAt: string;
    faces: unknown[];
  };
  assert.equal(afterAdd.consentAt, '2026-11-03 09:00:00');
  assert.equal(afterAdd.faces.length, 8);
  server.close();
});

test('an employee without consent (older data) needs consent to add photos', async () => {
  const { server, call, repos } = await startServer();
  const key = repos.employees.addEmployee({ employeeNo: 'E9', name: '옛 직원' });
  const url = `/api/admin/employees/${key}/photos`;
  const denied = await call('POST', url, { photos: [JPEG] });
  assert.equal(denied.status, 400);
  assert.deepEqual(await denied.json(), { error: 'consent required' });
  assert.equal(repos.employees.listFaces(key).length, 0);
  assert.equal((await call('POST', url, { photos: [JPEG], consent: true })).status, 201);
  assert.equal(repos.employees.listFaces(key).length, 1);
  server.close();
});

test('web and terminal admins read the same consent text with the current photo retention', async (t) => {
  const { server, call } = await startServer();
  t.after(() => server.close());
  await call('PUT', '/api/admin/settings', { photoRetentionDays: 30 });
  const doc = (await (await call('GET', '/api/admin/consent')).json()) as {
    version: string;
    sections: { lines: string[] }[];
  };
  assert.equal(doc.version, CONSENT_VERSION);
  assert.ok(doc.sections.some((s) => s.lines.some((l) => l.includes('30일 보관'))));
  // 단말은 연결 토큰만 있으면 읽는다 (관리자 확인 없이). 토큰이 없으면 401
  const terminal = await call('GET', '/api/terminal/consent', undefined, {
    Authorization: 'Bearer device-token',
  });
  assert.equal(terminal.status, 200);
  assert.equal(((await terminal.json()) as { version: string }).version, CONSENT_VERSION);
  assert.equal((await call('GET', '/api/terminal/consent', undefined, {})).status, 401);
});
