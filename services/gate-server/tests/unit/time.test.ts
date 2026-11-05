import test from 'node:test';
import assert from 'node:assert/strict';
import { kst, kstMs, parseKst } from '../../src/shared/time.ts';

test('kst formats UTC date as Korea time', () => {
  const date = new Date('2026-10-27T23:51:02.345Z');
  assert.equal(kst(date), '2026-10-28 08:51:02');
  assert.equal(kstMs(date), '2026-10-28 08:51:02.345');
});

test('parseKst reverses kst', () => {
  assert.equal(parseKst('2026-10-28 08:51:02')?.toISOString(), '2026-10-27T23:51:02.000Z');
  assert.equal(parseKst('not a time'), null);
});

test('parseKst rejects impossible dates and keeps milliseconds', () => {
  assert.equal(parseKst('2026-13-45 99:99:99'), null);
  assert.equal(parseKst('2026-02-31 10:00:00'), null);
  assert.equal(parseKst('2026-10-28 08:51:02.345')?.toISOString(), '2026-10-27T23:51:02.345Z');
});
