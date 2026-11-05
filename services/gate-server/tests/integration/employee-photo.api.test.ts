import test from 'node:test';
import assert from 'node:assert/strict';
import { JPEG, startServer, photoSet } from './harness.ts';

async function addEmployee(
  call: Awaited<ReturnType<typeof startServer>>['call'],
  photos = photoSet(),
) {
  const res = await call('POST', '/api/admin/employees', {
    employeeNo: 'E1',
    name: '홍길동',
    department: '개발팀',
    photos,
    source: 'WEBCAM',
    consent: true,
  });
  return ((await res.json()) as { employeeKey: number }).employeeKey;
}

test('detail lists photos with source, registrar and time, without file names', async () => {
  const { server, call } = await startServer();
  const key = await addEmployee(call);
  const res = await call('GET', `/api/admin/employees/${key}`);
  assert.equal(res.status, 200);
  const detail = (await res.json()) as Record<string, unknown> & {
    faces: Record<string, unknown>[];
  };
  assert.equal(detail.name, '홍길동');
  assert.equal(detail.faces.length, 6);
  assert.deepEqual(Object.keys(detail.faces[0]).sort(), [
    'createdAt',
    'faceImageKey',
    'registeredBy',
    'source',
  ]);
  assert.equal(detail.faces[0].source, 'WEBCAM');
  assert.equal(detail.faces[0].registeredBy, '김인사');
  assert.equal((await call('GET', '/api/admin/employees/999')).status, 404);
  server.close();
});

test('photos can be added, viewed and deleted one by one', async () => {
  const { server, call, repos } = await startServer();
  const key = await addEmployee(call);
  const added = await call('POST', `/api/admin/employees/${key}/photos`, { photos: [JPEG, JPEG] });
  assert.equal(added.status, 201);
  const { faceImageKeys } = (await added.json()) as { faceImageKeys: number[] };
  assert.equal(faceImageKeys.length, 2);

  const image = await call('GET', `/api/admin/employees/${key}/photos/${faceImageKeys[0]}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.equal(image.headers.get('cache-control'), 'private, no-store');
  assert.ok((await image.arrayBuffer()).byteLength > 0);

  assert.equal(
    (await call('DELETE', `/api/admin/employees/${key}/photos/${faceImageKeys[0]}`)).status,
    200,
  );
  assert.equal(
    (await call('GET', `/api/admin/employees/${key}/photos/${faceImageKeys[0]}`)).status,
    404,
  );
  assert.equal(
    (await call('DELETE', `/api/admin/employees/${key}/photos/${faceImageKeys[0]}`)).status,
    404,
  );
  assert.equal(repos.employees.listFaces(key).length, 7);

  const actions = (
    (await (await call('GET', '/api/admin/audit-logs?limit=2')).json()).items as {
      action: string;
    }[]
  ).map((log) => log.action);
  assert.deepEqual(actions, ['FACE_DELETE', 'FACE_ADD']);
  server.close();
});

test('an existing employee can delete below six photos and add one replacement', async (t) => {
  const { server, call, repos } = await startServer();
  t.after(() => server.close());
  const key = await addEmployee(call);
  const [face] = repos.employees.listFaces(key);
  assert.equal(
    (await call('DELETE', `/api/admin/employees/${key}/photos/${face.faceImageKey}`)).status,
    200,
  );
  assert.equal(repos.employees.listFaces(key).length, 5);
  const added = await call('POST', `/api/admin/employees/${key}/photos`, { photos: [JPEG] });
  assert.equal(added.status, 201);
  const { faceImageKeys } = (await added.json()) as { faceImageKeys: number[] };
  assert.equal(faceImageKeys.length, 1);
  assert.equal(repos.employees.listFaces(key).length, 6);
});

test('a photo of another employee cannot be read or deleted through this employee', async () => {
  const { server, call } = await startServer();
  const a = await addEmployee(call);
  const b = (
    (await (
      await call('POST', '/api/admin/employees', {
        employeeNo: 'E2',
        name: '김',
        photos: photoSet(),
        consent: true,
      })
    ).json()) as {
      employeeKey: number;
    }
  ).employeeKey;
  const [bFace] = (
    (await (await call('GET', `/api/admin/employees/${b}`)).json()) as {
      faces: { faceImageKey: number }[];
    }
  ).faces;
  assert.equal(
    (await call('GET', `/api/admin/employees/${a}/photos/${bFace.faceImageKey}`)).status,
    404,
  );
  assert.equal(
    (await call('DELETE', `/api/admin/employees/${a}/photos/${bFace.faceImageKey}`)).status,
    404,
  );
  server.close();
});

test('bad photos, the terminal source, retired employees and more than 10 photos are rejected', async () => {
  const { server, call, repos } = await startServer();
  const key = await addEmployee(call);
  const url = `/api/admin/employees/${key}/photos`;
  assert.equal((await call('POST', url, { photos: [] })).status, 400);
  assert.equal((await call('POST', url, { photos: ['not a jpeg'] })).status, 400);
  assert.equal((await call('POST', url, { photos: [JPEG], source: 'TERMINAL' })).status, 400);
  assert.equal(
    (await call('POST', '/api/admin/employees/999/photos', { photos: [JPEG] })).status,
    404,
  );
  assert.equal((await call('POST', url, { photos: Array(5).fill(JPEG) })).status, 409); // 6 + 5 > 10
  assert.equal(repos.employees.listFaces(key).length, 6);
  const added = await call('POST', url, { photos: Array(4).fill(JPEG) });
  assert.equal(added.status, 201); // 6 + 4 = 10
  const { faceImageKeys } = (await added.json()) as { faceImageKeys: number[] };
  assert.equal(faceImageKeys.length, 4);
  assert.equal(repos.employees.listFaces(key).length, 10);
  assert.equal((await call('POST', url, { photos: [JPEG] })).status, 409);
  assert.equal(repos.employees.listFaces(key).length, 10);
  await call('POST', `/api/admin/employees/${key}/retire`);
  assert.equal((await call('POST', url, { photos: [JPEG] })).status, 409);
  server.close();
});
