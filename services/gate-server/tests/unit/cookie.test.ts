import test from 'node:test';
import assert from 'node:assert/strict';
import { readCookie } from '../../src/shared/cookie.ts';

test('readCookie finds one cookie among several', () => {
  assert.equal(readCookie('a=1; facegate_session=abc%2Bd; b=2', 'facegate_session'), 'abc+d');
  assert.equal(readCookie('a=1', 'facegate_session'), undefined);
  assert.equal(readCookie(undefined, 'facegate_session'), undefined);
});

test('readCookie keeps "=" inside values and ignores malformed encoding', () => {
  assert.equal(readCookie('t=ab==', 't'), 'ab==');
  assert.equal(readCookie('t=%E0%A4%A', 't'), undefined);
});
