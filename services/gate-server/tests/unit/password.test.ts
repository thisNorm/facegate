import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../../src/shared/password.ts';

test('hashPassword stores scrypt parameters and a random salt', async () => {
  const a = await hashPassword('correct horse battery');
  const b = await hashPassword('correct horse battery');
  assert.match(a, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.notEqual(a, b);
});

test('verifyPassword accepts only the original password', async () => {
  const stored = await hashPassword('correct horse battery');
  assert.equal(await verifyPassword('correct horse battery', stored), true);
  assert.equal(await verifyPassword('wrong horse battery', stored), false);
});

test('verifyPassword rejects malformed hashes instead of throwing', async () => {
  for (const stored of [
    '',
    'plain',
    'bcrypt$1$2$3$a$b',
    'scrypt$16384$8$1$$',
    'scrypt$16384$8$1$c2FsdA==$=',
    `scrypt$NaN$8$1$c2FsdA==$${Buffer.alloc(64).toString('base64')}`,
  ])
    assert.equal(await verifyPassword('x', stored), false);
});
