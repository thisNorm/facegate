import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../../src/modules/access/access.rules.ts';
import type { Employee } from '../../src/modules/employee/employee.types.ts';

const active: Employee = {
  employeeKey: 1,
  employeeNo: 'E1',
  name: '홍길동',
  department: '',
  status: 'ACTIVE',
};
const base = {
  isWorker: true,
  employee: active,
  access: 'ALLOWED' as const,
  lastGrantedMs: undefined,
  nowMs: 10_000,
  duplicateWindowMs: 5000,
};

test('unknown face or missing employee is UNREGISTERED', () => {
  assert.equal(decide({ ...base, isWorker: false }), 'UNREGISTERED');
  assert.equal(decide({ ...base, employee: undefined }), 'UNREGISTERED');
});

test('retired employee is DENIED_INACTIVE', () => {
  assert.equal(decide({ ...base, employee: { ...active, status: 'RETIRED' } }), 'DENIED_INACTIVE');
});

test('same employee inside the window is DUPLICATE, outside is GRANTED', () => {
  assert.equal(decide({ ...base, lastGrantedMs: 6000 }), 'DUPLICATE');
  assert.equal(decide({ ...base, lastGrantedMs: 5000 }), 'GRANTED');
  assert.equal(decide(base), 'GRANTED');
});

test('an active employee without a right to this gate is DENIED_GATE', () => {
  assert.equal(decide({ ...base, access: 'NO_GATE' }), 'DENIED_GATE');
  // 퇴사가 권한보다 먼저
  assert.equal(
    decide({ ...base, employee: { ...active, status: 'RETIRED' }, access: 'NO_GATE' }),
    'DENIED_INACTIVE',
  );
});

test('a right to the gate outside its group schedule is DENIED_TIME', () => {
  assert.equal(decide({ ...base, access: 'OFF_HOURS' }), 'DENIED_TIME');
  // 시간 외도 중복보다 먼저
  assert.equal(decide({ ...base, access: 'OFF_HOURS', lastGrantedMs: 6000 }), 'DENIED_TIME');
});
