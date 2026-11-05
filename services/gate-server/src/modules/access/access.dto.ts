import { parseKst } from '../../shared/time.ts';
import type { AccessFilter, AccessMethod, AccessResult } from './access.types.ts';

const RESULTS: AccessResult[] = [
  'GRANTED',
  'UNREGISTERED',
  'DENIED_INACTIVE',
  'DENIED_GATE',
  'DENIED_TIME',
  'DUPLICATE',
  'GATE_ERROR',
];
const METHODS: AccessMethod[] = ['FACE', 'REMOTE', 'PHONE'];

const positiveInt = (value: unknown) =>
  typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : null;

const isDate = (value: unknown): value is string =>
  typeof value === 'string' && parseKst(`${value} 00:00:00`) !== null;

/** 출입 기록 쿼리 문자열. 알 수 없는 값이 있으면 null */
export function parseAccessFilter(
  query: Record<string, unknown>,
  maxLimit: number,
): AccessFilter | null {
  const filter: AccessFilter = { limit: Math.min(50, maxLimit) };
  for (const key of ['from', 'to'] as const) {
    if (query[key] === undefined) continue;
    if (!isDate(query[key])) return null;
    filter[key] = query[key] as string;
  }
  for (const key of ['gateKey', 'beforeEventKey', 'limit'] as const) {
    if (query[key] === undefined) continue;
    const value = positiveInt(query[key]);
    if (value === null) return null;
    filter[key] = key === 'limit' ? Math.min(value, maxLimit) : value;
  }
  if (query.result !== undefined) {
    if (!RESULTS.includes(query.result as AccessResult)) return null;
    filter.result = query.result as AccessResult;
  }
  if (query.method !== undefined) {
    if (!METHODS.includes(query.method as AccessMethod)) return null;
    filter.method = query.method as AccessMethod;
  }
  if (typeof query.q === 'string' && query.q.trim()) filter.q = query.q.trim();
  return filter;
}
