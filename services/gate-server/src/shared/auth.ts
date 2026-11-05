import type { RequestHandler } from 'express';
import { sameSecret } from './secret.ts';

export function requireKey(
  header: string,
  expected: string | ((candidate: string | undefined) => boolean),
): RequestHandler {
  return (req, res, next) => {
    const ok =
      typeof expected === 'function'
        ? expected(req.get(header))
        : sameSecret(req.get(header), expected);
    if (!ok) {
      console.warn(`401 ${header} ${req.method} ${req.originalUrl}`);
      res.status(401).json({ error: `invalid ${header}` });
      return;
    }
    next();
  };
}
