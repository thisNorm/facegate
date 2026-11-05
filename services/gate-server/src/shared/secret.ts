import crypto from 'node:crypto';

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function sameSecret(a: unknown, b: unknown): boolean {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
