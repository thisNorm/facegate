import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../src/infrastructure/database/database.ts';
import { createRepositories } from '../../src/app/repositories.ts';

const repos = () => createRepositories(openDatabase(':memory:'));

test('employees and faces feed the AI dataset', () => {
  const { employees } = repos();
  const a = employees.addEmployee({ employeeNo: 'E1', name: '홍길동', department: '개발팀' });
  const b = employees.addEmployee({ employeeNo: 'E2', name: '김철수' });
  employees.addFace(a, 'a1.jpg');
  employees.addFace(a, 'a2.jpg');
  assert.deepEqual(employees.faceDataset(), [{ employeeKey: a, fileNames: ['a1.jpg', 'a2.jpg'] }]);
  employees.addFace(b, 'b1.jpg');
  assert.deepEqual(employees.retireEmployee(b), ['b1.jpg']);
  assert.equal(employees.getEmployee(b)?.status, 'RETIRED');
  assert.equal(employees.getEmployee(a)?.employeeNo, 'E1');
  assert.equal(employees.faceDataset().length, 1);
});

test('access log insert and update', () => {
  const { accessLogs } = repos();
  const eventKey = accessLogs.insertAccessLog({
    terminalKey: 101,
    gateKey: 1,
    employeeKey: null,
    aiTrackKey: 7,
    method: 'FACE',
    result: 'UNREGISTERED',
    appearTime: '2026-10-28 08:51:02',
    receivedAt: '2026-10-28 08:51:02.500',
    openedAt: null,
  });
  accessLogs.updateAccessLog(eventKey, { disappearTime: '2026-10-28 08:51:09', durationSec: 7 });
  const [row] = accessLogs.listAccessLogs(10);
  assert.equal(row.eventKey, eventKey);
  assert.equal(row.aiTrackKey, 7);
  assert.equal(row.durationSec, 7);
  assert.throws(
    () => accessLogs.updateAccessLog(eventKey, { result: 'GRANTED' } as never),
    /not updatable/,
  );
});

test('ai status keeps one row', () => {
  const { aiStatus } = repos();
  aiStatus.setPowerOn('2026-10-28 08:00:00');
  aiStatus.setStatus('2026-10-28 08:01:00', '[{"device_key":101,"rtsp_ok":true}]');
  assert.deepEqual(
    { ...aiStatus.getStatus() },
    {
      powerOnAt: '2026-10-28 08:00:00',
      lastStatusAt: '2026-10-28 08:01:00',
      rtspReport: '[{"device_key":101,"rtsp_ok":true}]',
    },
  );
});

test('retire runs in one transaction', () => {
  const sql = openDatabase(':memory:');
  const { employees } = createRepositories(sql);
  const key = employees.addEmployee({ employeeNo: 'E1', name: '홍길동' });
  employees.addFace(key, 'a.jpg');
  sql.exec(
    "CREATE TRIGGER fail_retire BEFORE UPDATE ON employee BEGIN SELECT RAISE(ABORT, 'boom'); END",
  );
  assert.throws(() => employees.retireEmployee(key), /boom/);
  assert.equal(employees.faceDataset().length, 1); // 사진 삭제도 되돌려짐
  assert.equal(employees.getEmployee(key)?.status, 'ACTIVE');
});
