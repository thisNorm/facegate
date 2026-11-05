import { hashPassword } from '../../src/shared/password.ts';
import type { Repositories } from '../../src/app/repositories.ts';

export const ADMIN_PASSWORD = 'correct horse battery';

/** 관리자 계정을 하나 만들고 로그인해 쿠키 헤더를 돌려준다 */
export async function loginAsAdmin(repos: Repositories, base: string, loginId = 'hr.kim') {
  repos.admins.addAdmin({
    loginId,
    name: '김인사',
    passwordHash: await hashPassword(ADMIN_PASSWORD),
    createdAt: '2026-10-28 08:00:00',
  });
  const res = await fetch(`${base}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginId, password: ADMIN_PASSWORD }),
  });
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  if (res.status !== 200 || !cookie) throw new Error(`login failed: ${res.status}`);
  return { Cookie: cookie };
}
