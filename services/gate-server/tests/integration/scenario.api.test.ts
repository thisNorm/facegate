import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { INGEST, contract, photoSet, startServer } from './harness.ts';
import {
  ACTION_LABEL,
  METHOD_LABEL,
  REASON_LABEL,
  RESULT_LABEL,
} from '../../../../apps/admin-web/src/labels.ts';

const APPEAR = '/api/modules/camera/ai/face/appear';
/** 한국 시간 → Date */
const kst = (text: string) => new Date(`${text}+09:00`);

/**
 * 관리자 웹 화면이 보내는 값과 서버가 받는 값이 같은지 (검증 지도 C-1).
 * 웹은 서버 응답을 흉내 내 시험하므로, 결과 필터처럼 웹에만 있는 값은 여기서만 잡힌다
 */
test('every filter value the admin web offers is accepted by the server', async (t) => {
  const { server, call } = await startServer();
  t.after(() => server.close());
  for (const result of Object.keys(RESULT_LABEL))
    assert.equal(
      (await call('GET', `/api/admin/access-logs?result=${result}`)).status,
      200,
      result,
    );
  for (const method of Object.keys(METHOD_LABEL))
    assert.equal(
      (await call('GET', `/api/admin/access-logs?method=${method}`)).status,
      200,
      method,
    );
  for (const reason of Object.keys(REASON_LABEL)) {
    const body = { reason, note: '확인', visitor: { name: '방문객' } };
    assert.notEqual((await call('POST', '/api/admin/gates/1/open', body)).status, 400, reason);
  }
});

test('every audit action the server writes has a Korean label in the admin web', () => {
  const source = fs.readFileSync(
    new URL('../../src/modules/audit/audit.types.ts', import.meta.url),
    'utf8',
  );
  const union = source.slice(source.indexOf('AuditAction ='), source.indexOf(';'));
  const actions = [...union.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  assert.ok(actions.length > 30);
  assert.deepEqual(
    actions.filter((a) => !ACTION_LABEL[a]),
    [],
  );
});

/**
 * 핵심 흐름 하나를 처음부터 끝까지 (검증 지도 C-2):
 * 소속, 시간표, 권한 그룹 → 동의하고 직원 등록 → AI 인식 → 판정, 문 열림 → 출입 기록 필터, CSV → 작업 이력
 */
test('org, schedule and group, consented registration, recognition, logs and audit work together', async (t) => {
  const { server, call, repos, opened, setNow, broadcasts } = await startServer();
  t.after(() => server.close());
  const ok = async (res: Response, status = 200) => {
    assert.equal(res.status, status, await res.clone().text());
    return res.json();
  };

  // 정문 1을 권한 있는 사람만 다니는 게이트로
  await ok(
    await call('PATCH', '/api/admin/gates/1', {
      name: '정문 1',
      adapter: { type: 'MOCK' },
      floor: 3,
      openToAll: false,
    }),
  );
  const { orgKey } = await ok(
    await call('POST', '/api/admin/orgs', { name: '입주사 B', kind: 'TENANT' }),
    201,
  );
  const weekdays = [null, ...Array(5).fill({ start: '08:00', end: '12:00' }), null, null];
  const { scheduleKey } = await ok(
    await call('POST', '/api/admin/schedules', { name: '평일 낮', days: weekdays }),
    201,
  );
  const { groupKey } = await ok(
    await call('POST', '/api/admin/access-groups', {
      name: '입주사 B 3층',
      scheduleKey,
      gateKeys: [1],
      orgKeys: [orgKey],
    }),
    201,
  );

  // 동의 없이는 등록 안 됨, 동의하면 판(version)까지 남음
  const person = {
    employeeNo: 'B001',
    name: '박입주',
    department: '입주사 B',
    photos: photoSet(2),
  };
  assert.equal((await call('POST', '/api/admin/employees', person)).status, 400);
  const { employeeKey } = await ok(
    await call('POST', '/api/admin/employees', { ...person, consent: true }),
  );
  const { version } = await call('GET', '/api/admin/consent').then((r) => r.json());
  assert.equal(
    (await ok(await call('GET', `/api/admin/employees/${employeeKey}`))).consentVersion,
    version,
  );

  // 화요일 10시: 통과하고 문이 열림. 같은 날 13시: 시간 외 (로그인 세션 8시간 안에서)
  const appear = { ...contract('appear-worker.json'), worker_key: employeeKey };
  setNow(kst('2026-11-03T10:00:00'));
  await ok(await call('POST', APPEAR, appear, INGEST));
  assert.deepEqual(opened, [1]);
  setNow(kst('2026-11-03T13:00:00'));
  await ok(await call('POST', APPEAR, appear, INGEST));
  assert.deepEqual(opened, [1]);
  assert.deepEqual(
    broadcasts
      .filter((b) => b.message.type === 'decision')
      .map((b) => (b.message as { result: string }).result),
    ['GRANTED', 'DENIED_TIME'],
  );

  // 출입 기록: 결과로 거르고, CSV에는 한글 결과
  const day = 'from=2026-11-03&to=2026-11-03';
  const late = await ok(await call('GET', `/api/admin/access-logs?${day}&result=DENIED_TIME`));
  assert.deepEqual(
    late.items.map((i: { result: string; employeeName: string }) => [i.result, i.employeeName]),
    [['DENIED_TIME', '박입주']],
  );
  const csv = await (await call('GET', `/api/admin/access-logs.csv?${day}`)).text();
  assert.match(csv, /시간 외/);
  assert.match(csv, /허가/);

  // 작업 이력: 그룹 만든 일이 이름과 함께, 관리자 웹에서 한 일로
  const audit = await ok(await call('GET', '/api/admin/audit-logs?limit=50'));
  const made = audit.items.find((l: { action: string }) => l.action === 'ACCESS_GROUP_CREATE');
  assert.deepEqual([made.targetName, made.via], ['입주사 B 3층', 'WEB']);
  assert.equal(repos.permissions.group(groupKey)?.orgKeys[0], orgKey);
});
