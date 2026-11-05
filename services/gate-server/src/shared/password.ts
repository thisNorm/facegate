import crypto from 'node:crypto';

const PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;

function scrypt(
  password: string,
  salt: Buffer,
  length: number,
  options: crypto.ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, length, options, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH, PARAMS);
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const options = { N: Number(n), r: Number(r), p: Number(p) };
  if (
    !Object.values(options).every(Number.isSafeInteger) ||
    Object.values(options).some((v) => v < 1)
  )
    return false;
  const expected = Buffer.from(hash, 'base64');
  if (expected.length !== KEY_LENGTH) return false;
  try {
    const actual = await scrypt(password, Buffer.from(salt, 'base64'), KEY_LENGTH, options);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
