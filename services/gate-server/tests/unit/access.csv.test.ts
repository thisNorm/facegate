import test from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../../src/modules/access/access.csv.ts';
import type { AccessLogView } from '../../src/modules/access/access.types.ts';

const row = (fields: Partial<AccessLogView>): AccessLogView => ({
  eventKey: 1,
  terminalKey: 101,
  gateKey: 1,
  employeeKey: 7,
  aiTrackKey: null,
  method: 'FACE',
  result: 'GRANTED',
  appearTime: '2026-11-03 08:59:59',
  receivedAt: '2026-11-03 09:00:00.120',
  openedAt: '2026-11-03 09:00:00.300',
  disappearTime: null,
  durationSec: null,
  fullImage: null,
  cropImage: null,
  remoteReason: null,
  remoteNote: null,
  visitorName: null,
  visitorCompany: null,
  visitTargetKey: null,
  adminKey: null,
  employeeNo: 'E1',
  employeeName: '홍길동',
  department: '개발팀',
  ...fields,
});

test('CSV has a BOM, Korean header and Korean labels', () => {
  const csv = toCsv([row({})], new Map([[1, '정문 1']]));
  assert.ok(csv.startsWith('﻿'));
  const [header, line] = csv.slice(1).trimEnd().split('\r\n');
  assert.equal(header, '시각,게이트,결과,인증 수단,사번,이름,부서,원격 사유,방문객,메모');
  assert.equal(line, '2026-11-03 09:00:00,정문 1,허가,얼굴,E1,홍길동,개발팀,,,');
});

test('CSV guards formulas hidden behind a leading tab or CR', () => {
  const csv = toCsv([row({ remoteNote: '\t=1+1' })], new Map());
  assert.ok(csv.includes("'\t=1+1"));
});

test('CSV quotes commas and quotes, and neutralises formulas', () => {
  const csv = toCsv(
    [
      row({
        method: 'REMOTE',
        result: 'GATE_ERROR',
        employeeName: null,
        employeeNo: null,
        department: null,
        remoteReason: 'VISITOR',
        visitorName: '=HYPERLINK("x")',
        visitorCompany: '가,나',
        remoteNote: '말 "인용"',
      }),
    ],
    new Map(),
  );
  const line = csv.slice(1).trimEnd().split('\r\n')[1];
  assert.equal(
    line,
    `2026-11-03 09:00:00,1,게이트 오류,원격,,,,방문객,"'=HYPERLINK(""x"") (가,나)","말 ""인용"""`,
  );
});
