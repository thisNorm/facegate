export type DecisionResult =
  'UNREGISTERED' | 'DENIED_INACTIVE' | 'DENIED_GATE' | 'DENIED_TIME' | 'DUPLICATE' | 'GRANTED';
export type AccessResult = DecisionResult | 'GATE_ERROR';
export type AccessMethod = 'FACE' | 'REMOTE' | 'PHONE';
export type RemoteReason = 'VISITOR' | 'RECOGNITION_FAILED' | 'OTHER';

export type NewAccessLog = {
  terminalKey: number;
  gateKey: number;
  employeeKey: number | null;
  aiTrackKey: number | null;
  method: AccessMethod;
  result: AccessResult;
  appearTime: string;
  receivedAt: string;
  openedAt: string | null;
};

export type RemoteOpenLog = {
  gateKey: number;
  result: 'GRANTED' | 'GATE_ERROR';
  receivedAt: string;
  openedAt: string | null;
  remoteReason: RemoteReason;
  remoteNote: string | null;
  visitorName: string | null;
  visitorCompany: string | null;
  visitTargetKey: number | null;
  /** 단말 관리자 번호로 열면 계정이 없어 null */
  adminKey: number | null;
};

export type AccessLogRow = Omit<NewAccessLog, 'terminalKey' | 'appearTime'> & {
  eventKey: number;
  terminalKey: number | null;
  appearTime: string | null;
  disappearTime: string | null;
  durationSec: number | null;
  fullImage: string | null;
  cropImage: string | null;
  remoteReason: RemoteReason | null;
  remoteNote: string | null;
  visitorName: string | null;
  visitorCompany: string | null;
  visitTargetKey: number | null;
  adminKey: number | null;
};

export type AccessFilter = {
  from?: string;
  to?: string;
  gateKey?: number;
  result?: AccessResult;
  method?: AccessMethod;
  q?: string;
  beforeEventKey?: number;
  limit: number;
};

export type AccessLogView = AccessLogRow & {
  employeeNo: string | null;
  employeeName: string | null;
  department: string | null;
};
