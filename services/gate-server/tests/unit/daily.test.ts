import test from 'node:test';
import assert from 'node:assert/strict';
import { msUntilKstHour } from '../../src/shared/daily.ts';

const at = (iso: string) => new Date(iso);

test('time until the next 03:00 KST', () => {
  // 2026-11-03 02:00 KST = 11-02 17:00Z → 1시간 뒤
  assert.equal(msUntilKstHour(at('2026-11-02T17:00:00Z'), 3), 3600_000);
  // 정확히 03:00이면 다음 날
  assert.equal(msUntilKstHour(at('2026-11-02T18:00:00Z'), 3), 24 * 3600_000);
  // 03:00:01이면 23시간 59분 59초 뒤
  assert.equal(msUntilKstHour(at('2026-11-02T18:00:01Z'), 3), 24 * 3600_000 - 1000);
});
