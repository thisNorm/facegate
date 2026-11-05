export type AuditAction =
  | 'ADMIN_CREATE'
  | 'ADMIN_ENABLE'
  | 'ADMIN_DISABLE'
  | 'PASSWORD_CHANGE'
  | 'CREDENTIALS_CONFIRM'
  | 'CREDENTIALS_CHANGE'
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGIN_LOCKED'
  | 'LOGOUT'
  | 'TERMINAL_LOGIN'
  | 'TERMINAL_LOGIN_FAILED'
  | 'EMPLOYEE_REGISTER'
  | 'EMPLOYEE_RETIRE'
  | 'INGEST_KEY_ISSUE'
  | 'SETTINGS_UPDATE'
  | 'ORG_CREATE'
  | 'ORG_UPDATE'
  | 'ORG_DELETE'
  | 'ACCESS_RULE_UPDATE'
  | 'ACCESS_GROUP_CREATE'
  | 'ACCESS_GROUP_UPDATE'
  | 'ACCESS_GROUP_DELETE'
  | 'SCHEDULE_CREATE'
  | 'SCHEDULE_UPDATE'
  | 'SCHEDULE_DELETE'
  | 'HOLIDAY_ADD'
  | 'HOLIDAY_DELETE'
  | 'EMPLOYEE_UPDATE'
  | 'FACE_ADD'
  | 'FACE_DELETE'
  | 'REMOTE_OPEN'
  | 'PHONE_INVITE'
  | 'PHONE_REVOKE'
  | 'PHOTO_PURGE'
  | 'GATE_CREATE'
  | 'GATE_UPDATE'
  | 'GATE_DELETE'
  | 'TERMINAL_PAIR'
  | 'TERMINAL_UPDATE'
  | 'TERMINAL_UNPAIR'
  | 'PAIR_CODE_ISSUE'
  | 'VISITOR_CALL'
  | 'VISITOR_CALL_ACK';

export type AuditEntry = {
  adminKey: number | null;
  action: AuditAction;
  target: string | null;
  detail: Record<string, unknown> | null;
};

export type AuditLog = AuditEntry & {
  auditKey: number;
  adminName: string | null;
  /** WEB 또는 TERMINAL:단말번호. 서버가 스스로 한 일은 null */
  via: string | null;
  /** 그 단말의 지금 이름과 게이트 */
  viaName: string | null;
  /** 대상의 지금 이름. 지워진 대상은 null */
  targetName: string | null;
  createdAt: string;
};
