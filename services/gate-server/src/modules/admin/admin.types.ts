export type Admin = { adminKey: number; loginId: string; name: string };
export type AppEnv = 'development' | 'production';
export type AdminSession = { admin: Admin; mustChangeCredentials: boolean; appEnv: AppEnv };
export type CredentialsInput = { loginId?: string; currentPassword: string; newPassword?: string };

/** WEB: 관리자 웹 쿠키, TERMINAL: 단말 관리자 모드 */
export type SessionKind = 'WEB' | 'TERMINAL';
export type Issued = { token: string; expiresAt: string; admin: Admin };
export type LoginFailure = { error: 'INVALID' | 'LOCKED' };
