import { CONSENT_VERSION } from '../../src/modules/employee/consent.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JPEG, startServer, photoSet } from './harness.ts';

async function seed(call: Awaited<ReturnType<typeof startServer>>['call']) {
  const add = async (employeeNo: string, name: string, department: string, photos = photoSet()) =>
    (
      (await (
        await call('POST', '/api/admin/employees', {
          employeeNo,
          name,
          department,
          photos,
          consent: true,
        })
      ).json()) as {
        employeeKey: number;
      }
    ).employeeKey;
  return {
    hong: await add('E002', '홍길동', '개발팀'),
    kim: await add('E001', '김철수', '인사팀'),
    lee: await add('E003', '이영희', '개발_팀'),
  };
}

test('employee list is sorted by employee number with face counts', async () => {
  const { server, call } = await startServer();
  await seed(call);
  const list = (await (await call('GET', '/api/admin/employees')).json()) as {
    employeeNo: string;
    faceCount: number;
    status: string;
  }[];
  assert.deepEqual(
    list.map((e) => e.employeeNo),
    ['E001', 'E002', 'E003'],
  );
  assert.deepEqual(
    list.map((e) => e.faceCount),
    [6, 6, 6],
  );
  assert.equal((await call('GET', '/api/admin/employees', undefined, {})).status, 401);
  server.close();
});

test('search matches name, number or department and treats % and _ literally', async () => {
  const { server, call } = await startServer();
  await seed(call);
  const names = async (query: string) =>
    ((await (await call('GET', `/api/admin/employees?${query}`)).json()) as { name: string }[]).map(
      (e) => e.name,
    );
  assert.deepEqual(await names('q=%ED%99%8D'), ['홍길동']); // 홍
  assert.deepEqual(await names('q=E003'), ['이영희']);
  assert.deepEqual(await names('q=%EA%B0%9C%EB%B0%9C'), ['홍길동', '이영희']); // 개발
  assert.deepEqual(await names('q=_'), ['이영희']);
  assert.deepEqual(await names('q=%25'), []);
  server.close();
});

test('status and no-face filters', async () => {
  const { server, call } = await startServer();
  const { kim } = await seed(call);
  await call('POST', `/api/admin/employees/${kim}/retire`);
  const statuses = async (query: string) =>
    ((await (await call('GET', `/api/admin/employees?${query}`)).json()) as { name: string }[]).map(
      (e) => e.name,
    );
  assert.deepEqual(await statuses('status=RETIRED'), ['김철수']);
  assert.deepEqual(await statuses('status=ACTIVE'), ['홍길동', '이영희']);
  assert.deepEqual(await statuses('noFace=1'), ['김철수']); // 퇴사하면 사진이 지워짐
  assert.equal((await call('GET', '/api/admin/employees?status=GONE')).status, 400);
  server.close();
});

test('PATCH updates given fields and writes the audit log', async () => {
  const { server, call } = await startServer();
  const { hong } = await seed(call);
  const res = await call('PATCH', `/api/admin/employees/${hong}`, { department: '보안팀' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    employeeKey: hong,
    employeeNo: 'E002',
    name: '홍길동',
    department: '보안팀',
    status: 'ACTIVE',
  });
  const [log] = (await (await call('GET', '/api/admin/audit-logs?limit=1')).json()).items as {
    action: string;
    target: string;
    targetName: string;
    via: string;
    detail: unknown;
  }[];
  assert.equal(log.action, 'EMPLOYEE_UPDATE');
  assert.equal(log.target, `employee:${hong}`);
  assert.equal(log.targetName, '홍길동');
  assert.equal(log.via, 'WEB');
  assert.deepEqual(log.detail, { department: '보안팀' });
  server.close();
});

test('PATCH rejects bad input, unknown employees and duplicate numbers', async () => {
  const { server, call } = await startServer();
  const { hong } = await seed(call);
  assert.equal((await call('PATCH', `/api/admin/employees/${hong}`, {})).status, 400);
  assert.equal((await call('PATCH', `/api/admin/employees/${hong}`, { name: '' })).status, 400);
  assert.equal((await call('PATCH', `/api/admin/employees/${hong}`, { name: 3 })).status, 400);
  assert.equal((await call('PATCH', '/api/admin/employees/999', { name: 'x' })).status, 404);
  assert.equal((await call('PATCH', '/api/admin/employees/abc', { name: 'x' })).status, 404);
  assert.equal(
    (await call('PATCH', `/api/admin/employees/${hong}`, { employeeNo: 'E001' })).status,
    409,
  );
  assert.equal(
    (await call('PATCH', `/api/admin/employees/${hong}`, { employeeNo: 'E002' })).status,
    200,
  );
  server.close();
});

test('register trims fields, so a padded number collides with the trimmed one', async () => {
  const { server, call } = await startServer();
  const register = (employeeNo: string, name = ' 홍 ') =>
    call('POST', '/api/admin/employees', {
      employeeNo,
      name,
      photos: photoSet(),
      consent: true,
    });
  const created = (await (await register(' E1 ')).json()) as { employeeKey: number };
  const detail = (await (
    await call('GET', `/api/admin/employees/${created.employeeKey}`)
  ).json()) as { employeeNo: string; name: string };
  assert.equal(detail.employeeNo, 'E1');
  assert.equal(detail.name, '홍');
  assert.equal((await register('E1')).status, 409);
  assert.equal((await register('  ')).status, 400);
  assert.equal((await register('E2', '   ')).status, 400);
  server.close();
});

for (const count of [1, 3, 6]) {
  test(`register accepts ${count} photos (1 to 6)`, async (t) => {
    const { server, call, repos } = await startServer();
    t.after(() => server.close());
    const res = await call('POST', '/api/admin/employees', {
      employeeNo: 'E1',
      name: '홍길동',
      photos: photoSet(count),
      consent: true,
    });
    assert.equal(res.status, 200);
    const { employeeKey } = (await res.json()) as { employeeKey: number };
    assert.equal(repos.employees.listFaces(employeeKey).length, count);
  });
}

for (const count of [0, 7, 8, 9, 10, 11]) {
  test(`register rejects ${count} photos without changing employees, faces or audit logs`, async (t) => {
    const { server, call, repos } = await startServer();
    t.after(() => server.close());
    const auditLogs = repos.audits.list(100);
    const res = await call('POST', '/api/admin/employees', {
      employeeNo: 'E1',
      name: '홍길동',
      photos: photoSet(count),
      consent: true,
    });
    assert.deepEqual(
      {
        status: res.status,
        employees: repos.employees.listEmployees({}),
        faces: repos.employees.faceDataset(),
        auditLogs: repos.audits.list(100),
      },
      { status: 400, employees: [], faces: [], auditLogs },
    );
  });
}

for (const [source, expectedSource] of [
  [undefined, 'WEB_UPLOAD'],
  ['WEB_UPLOAD', 'WEB_UPLOAD'],
  ['WEBCAM', 'WEBCAM'],
] as const) {
  test(`register accepts exactly six JPEG photos with ${source ?? 'default source'}`, async (t) => {
    const { server, call, repos } = await startServer();
    t.after(() => server.close());
    const res = await call('POST', '/api/admin/employees', {
      employeeNo: 'E1',
      name: '홍길동',
      photos: photoSet(),
      source,
      consent: true,
    });
    assert.equal(res.status, 200);
    const { employeeKey } = (await res.json()) as { employeeKey: number };
    const detail = (await (await call('GET', `/api/admin/employees/${employeeKey}`)).json()) as {
      consentAt: string;
      faces: { source: string; registeredBy: string }[];
    };
    assert.equal(detail.consentAt, '2026-11-03 09:00:00');
    assert.equal(detail.faces.length, 6);
    for (const face of detail.faces) {
      assert.equal(face.source, expectedSource);
      assert.equal(face.registeredBy, '김인사');
    }
    const [log] = repos.audits.list(1);
    assert.equal(log.action, 'EMPLOYEE_REGISTER');
    assert.equal(log.target, `employee:${employeeKey}`);
    assert.deepEqual(log.detail, { employeeNo: 'E1', photos: 6, consentVersion: CONSENT_VERSION });
  });
}

for (const invalidIndex of [0, 1, 2, 3, 4, 5]) {
  test(`register rejects an invalid JPEG at index ${invalidIndex} among six photos`, async (t) => {
    const { server, call, repos } = await startServer();
    t.after(() => server.close());
    const auditLogs = repos.audits.list(100);
    const res = await call('POST', '/api/admin/employees', {
      employeeNo: 'E1',
      name: '홍길동',
      photos: Array.from({ length: 6 }, (_, index) =>
        index === invalidIndex ? 'not a jpeg' : JPEG,
      ),
      consent: true,
    });
    assert.equal(res.status, 400);
    assert.deepEqual(repos.employees.listEmployees({}), []);
    assert.deepEqual(repos.employees.faceDataset(), []);
    assert.deepEqual(repos.audits.list(100), auditLogs);
  });
}

for (const [label, fields] of [
  ['missing consent', { consent: undefined }],
  ['false consent', { consent: false }],
  ['non-boolean consent', { consent: 'true' }],
  ['terminal source', { source: 'TERMINAL' }],
  ['unknown source', { source: 'OTHER' }],
  ['a repeated photo', { photos: [...photoSet(5), photoSet(1)[0]] }],
] as const) {
  test(`register rejects six JPEG photos with ${label}`, async (t) => {
    const { server, call, repos } = await startServer();
    t.after(() => server.close());
    const auditLogs = repos.audits.list(100);
    const body = {
      employeeNo: 'E1',
      name: '홍길동',
      photos: photoSet(),
      consent: true,
    };
    const res = await call('POST', '/api/admin/employees', { ...body, ...fields });
    assert.equal(res.status, 400);
    assert.deepEqual(repos.employees.listEmployees({}), []);
    assert.deepEqual(repos.employees.faceDataset(), []);
    assert.deepEqual(repos.audits.list(100), auditLogs);
  });
}

test('registering a duplicate employee number is 409', async () => {
  const { server, call } = await startServer();
  await seed(call);
  const res = await call('POST', '/api/admin/employees', {
    employeeNo: 'E001',
    name: '중복',
    photos: photoSet(),
    consent: true,
  });
  assert.equal(res.status, 409);
  server.close();
});

test('search matches Hangul while it is still being typed', async () => {
  const { server, call } = await startServer();
  await call('POST', '/api/admin/employees', {
    employeeNo: 'K1',
    name: '김철수',
    department: '관리팀',
    photos: photoSet(1),
    consent: true,
    source: 'WEB_UPLOAD',
  });
  for (const q of ['ㄱ', '기', '김ㅊ', '처', '고', 'k1']) {
    const rows = (await (
      await call('GET', `/api/admin/employees?q=${encodeURIComponent(q)}`)
    ).json()) as unknown[];
    assert.equal(rows.length, 1, q);
  }
  const none = (await (await call('GET', '/api/admin/employees?q=%EB%B0%95')).json()) as unknown[];
  assert.equal(none.length, 0);
  server.close();
});

test('the list filters by an exact org', async () => {
  const { server, call } = await startServer();
  for (const [employeeNo, department] of [
    ['A', '개발팀'],
    ['B', '개발_팀'],
  ])
    await call('POST', '/api/admin/employees', {
      employeeNo,
      name: employeeNo,
      department,
      photos: photoSet(1),
      consent: true,
    });
  const rows = (await (
    await call('GET', `/api/admin/employees?department=${encodeURIComponent('개발팀')}`)
  ).json()) as { employeeNo: string }[];
  assert.deepEqual(
    rows.map((r) => r.employeeNo),
    ['A'],
  );
  server.close();
});
