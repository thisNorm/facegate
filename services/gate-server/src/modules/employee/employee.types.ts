export type Employee = {
  employeeKey: number;
  employeeNo: string;
  name: string;
  department: string;
  status: 'ACTIVE' | 'RETIRED';
};

export type EmployeeSummary = Employee & { faceCount: number };

export type EmployeeFilter = {
  q?: string;
  status?: 'ACTIVE' | 'RETIRED';
  noFace?: boolean;
  /** 소속 이름과 정확히 같은 직원만 (D-59) */
  department?: string;
};

export type FaceSource = 'WEB_UPLOAD' | 'WEBCAM' | 'TERMINAL';

export type FaceInfo = {
  faceImageKey: number;
  source: FaceSource;
  registeredBy: string | null;
  createdAt: string;
};

export type EmployeeDetail = Employee & {
  createdAt: string;
  consentAt: string | null;
  /** 동의한 동의서 판 (consent.ts CONSENT_VERSION). 판을 남기기 전 동의는 null */
  consentVersion: string | null;
  faces: FaceInfo[];
};
