import { decodeJpeg } from '../../shared/image.ts';
import type { EmployeeFilter, FaceSource } from './employee.types.ts';

export type RegisterEmployeeDto = {
  employeeNo: string;
  name: string;
  department: string;
  photos: Buffer[];
  source: FaceSource;
  consent: boolean;
};
/** 신규 등록 때 받는 얼굴 사진 최대 수 (정면 2장과 상하좌우 각 1장). 1장 이상이면 등록 가능 (D-50) */
export const ENROLL_PHOTO_COUNT = 6;

export type AddPhotosDto = { photos: Buffer[]; source: FaceSource; consent: boolean };

/** 웹 API가 받는 등록 경로. TERMINAL은 단말 API(P4) 전용 */
function parseWebSource(value: unknown): FaceSource | null {
  if (value === undefined) return 'WEB_UPLOAD';
  return value === 'WEB_UPLOAD' || value === 'WEBCAM' ? value : null;
}

export function parseAddPhotos(body: unknown): AddPhotosDto | null {
  const b = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const photos = Array.isArray(b.photos) ? b.photos.map(decodeJpeg) : [];
  const source = parseWebSource(b.source);
  if (!source || photos.length === 0 || photos.some((photo) => photo === null)) return null;
  return { photos: photos as Buffer[], source, consent: b.consent === true };
}

export function parseRegisterEmployee(body: unknown): RegisterEmployeeDto | null {
  const b = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  if (typeof b.employeeNo !== 'string' || !b.employeeNo.trim()) return null;
  if (typeof b.name !== 'string' || !b.name.trim() || b.consent !== true) return null;
  const source = parseWebSource(b.source);
  if (!source) return null;
  const photos = Array.isArray(b.photos) ? b.photos.map(decodeJpeg) : [];
  if (
    photos.length === 0 ||
    photos.length > ENROLL_PHOTO_COUNT ||
    photos.some((photo) => photo === null)
  )
    return null;
  // 같은 사진을 여러 자세 칸에 넣으면 등록 품질이 떨어진다.
  if (new Set(photos.map((photo) => photo!.toString('base64'))).size !== photos.length) return null;
  return {
    employeeNo: b.employeeNo.trim(),
    name: b.name.trim(),
    department: typeof b.department === 'string' ? b.department.trim() : '',
    photos: photos as Buffer[],
    source,
    consent: true,
  };
}

export type UpdateEmployeeDto = { employeeNo?: string; name?: string; department?: string };

/** 보낸 항목만. 사번·이름은 빈 문자열 불가, 하나도 없으면 null */
export function parseUpdateEmployee(body: unknown): UpdateEmployeeDto | null {
  const b = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const dto: UpdateEmployeeDto = {};
  for (const key of ['employeeNo', 'name', 'department'] as const) {
    if (b[key] === undefined) continue;
    const value = b[key];
    if (typeof value !== 'string') return null;
    if (key !== 'department' && !value.trim()) return null;
    dto[key] = value.trim();
  }
  return Object.keys(dto).length ? dto : null;
}

const STATUSES = ['ACTIVE', 'RETIRED'] as const;

/** 쿼리 문자열 → 필터. status가 알 수 없는 값이면 null */
export function parseEmployeeFilter(query: Record<string, unknown>): EmployeeFilter | null {
  const status = query.status;
  if (status !== undefined && !STATUSES.includes(status as (typeof STATUSES)[number])) return null;
  return {
    q: typeof query.q === 'string' && query.q.trim() ? query.q.trim() : undefined,
    status: status as EmployeeFilter['status'],
    noFace: query.noFace === '1',
    department:
      typeof query.department === 'string' && query.department ? query.department : undefined,
  };
}
