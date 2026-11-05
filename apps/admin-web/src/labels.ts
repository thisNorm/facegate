export const RESULT_LABEL: Record<string, string> = {
  GRANTED: '허가',
  UNREGISTERED: '미등록',
  DENIED_GATE: '권한 없음',
  DENIED_TIME: '시간 외',
  DENIED_INACTIVE: '퇴사자',
  DUPLICATE: '중복',
  GATE_ERROR: '게이트 오류',
};
export const METHOD_LABEL: Record<string, string> = {
  FACE: '얼굴',
  REMOTE: '원격',
  PHONE: '핸드폰',
};
export const REASON_LABEL: Record<string, string> = {
  VISITOR: '방문객',
  RECOGNITION_FAILED: '직원 인증 불가',
  OTHER: '기타',
};
export const SOURCE_LABEL: Record<string, string> = {
  WEB_UPLOAD: '파일 업로드',
  WEBCAM: 'PC 웹캠',
  TERMINAL: '게이트 단말',
};
export const ACTION_LABEL: Record<string, string> = {
  ADMIN_CREATE: '관리자 추가',
  ADMIN_ENABLE: '관리자 다시 사용',
  ADMIN_DISABLE: '관리자 사용 중지',
  PASSWORD_CHANGE: '비밀번호 변경',
  CREDENTIALS_CONFIRM: '계정 정보 확인',
  CREDENTIALS_CHANGE: '계정 정보 변경',
  LOGIN: '로그인',
  LOGIN_FAILED: '로그인 실패',
  LOGIN_LOCKED: '로그인 잠김',
  LOGOUT: '로그아웃',
  TERMINAL_LOGIN: '단말 로그인',
  TERMINAL_LOGIN_FAILED: '단말 로그인 실패',
  EMPLOYEE_REGISTER: '직원 등록',
  EMPLOYEE_UPDATE: '직원 수정',
  EMPLOYEE_RETIRE: '퇴사 처리',
  FACE_ADD: '얼굴 사진 추가',
  FACE_DELETE: '얼굴 사진 삭제',
  INGEST_KEY_ISSUE: 'AI 연동 키 발급',
  SETTINGS_UPDATE: '설정 변경',
  ORG_CREATE: '소속 추가',
  ORG_UPDATE: '소속 수정',
  ORG_DELETE: '소속 삭제',
  ACCESS_RULE_UPDATE: '출입 권한 변경',
  ACCESS_GROUP_CREATE: '권한 그룹 추가',
  ACCESS_GROUP_UPDATE: '권한 그룹 변경',
  ACCESS_GROUP_DELETE: '권한 그룹 삭제',
  SCHEDULE_CREATE: '시간표 추가',
  SCHEDULE_UPDATE: '시간표 변경',
  SCHEDULE_DELETE: '시간표 삭제',
  HOLIDAY_ADD: '휴일 추가',
  HOLIDAY_DELETE: '휴일 삭제',
  REMOTE_OPEN: '원격 개방',
  PHONE_INVITE: '핸드폰 등록 링크',
  PHONE_REVOKE: '핸드폰 해제',
  PHOTO_PURGE: '사진 자동 삭제',
  GATE_CREATE: '게이트 추가',
  GATE_UPDATE: '게이트 수정',
  GATE_DELETE: '게이트 삭제',
  TERMINAL_PAIR: '단말 연결',
  TERMINAL_UPDATE: '단말 수정',
  TERMINAL_UNPAIR: '단말 연결 해제',
  PAIR_CODE_ISSUE: '단말 연결 코드 발급',
  VISITOR_CALL: '방문객 호출',
  VISITOR_CALL_ACK: '방문객 호출 확인',
};

export const ORG_KIND_LABEL: Record<string, string> = { DEPARTMENT: '부서', TENANT: '입주사' };

// 단말 불빛이 낼 수 있는 색 (서버 LIGHT_COLORS)
export const LIGHT_COLORS = [
  { value: 'WHITE', label: '하양' },
  { value: 'GREEN', label: '초록' },
  { value: 'RED', label: '빨강' },
  { value: 'BLUE', label: '파랑' },
  { value: 'YELLOW', label: '노랑' },
  { value: 'PURPLE', label: '보라' },
  { value: 'CYAN', label: '하늘' },
  { value: 'OFF', label: '끄기' },
] as const;
