import type { Admin } from '../modules/admin/admin.types.ts';

/** 주소의 번호 칸. 숫자가 아니면 null */
export const keyOf = (value: string) => (/^\d+$/.test(value) ? Number(value) : null);

/** 1~40자 이름. 앞뒤 공백은 뗀다 */
export const nameOf = (value: unknown) =>
  typeof value === 'string' && value.trim() && value.trim().length <= 40 ? value.trim() : null;

/** 요청한 관리자 번호 (requireAdmin 뒤) */
export const adminOf = (res: { locals: Record<string, unknown> }) =>
  (res.locals.admin as Admin).adminKey;
