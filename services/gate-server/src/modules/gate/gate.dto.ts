import type { RemoteReason } from '../access/access.types.ts';
import type { GateAdapter } from './gate.types.ts';

const REASONS: RemoteReason[] = ['VISITOR', 'RECOGNITION_FAILED', 'OTHER'];
const MAX_TEXT = 100;

export type RemoteOpenDto = {
  reason: RemoteReason;
  note: string | null;
  visitor: { name: string; company: string | null; targetEmployeeKey: number | null } | null;
};

const text = (value: unknown): string | null | false => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > MAX_TEXT) return false;
  return value.trim() || null;
};

/** 방문객은 이름 필수, 기타는 메모 필수 (FR-A-09). 규칙을 어기면 null */
export function parseRemoteOpen(body: unknown): RemoteOpenDto | null {
  const b = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  if (!REASONS.includes(b.reason as RemoteReason)) return null;
  const note = text(b.note);
  if (note === false) return null;

  let visitor: RemoteOpenDto['visitor'] = null;
  if (b.visitor !== undefined) {
    const v =
      typeof b.visitor === 'object' && b.visitor !== null
        ? (b.visitor as Record<string, unknown>)
        : {};
    const name = text(v.name);
    const company = text(v.company);
    const target = v.targetEmployeeKey;
    if (name === false || company === false) return null;
    if (target !== undefined && !(Number.isInteger(target) && (target as number) > 0)) return null;
    if (name)
      visitor = { name, company, targetEmployeeKey: (target as number | undefined) ?? null };
  }
  if (b.reason === 'VISITOR' && !visitor) return null;
  if (b.reason === 'OTHER' && !note) return null;
  return { reason: b.reason as RemoteReason, note, visitor };
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
export const isIpv4 = (value: unknown): value is string =>
  typeof value === 'string' && IPV4.test(value);

const name = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 40 ? trimmed : null;
};

/** 없으면 기본값, 있으면 정수이고 범위 안이어야 함. 틀리면 null */
const intIn = (value: unknown, min: number, max: number, fallback: number): number | null => {
  if (value === undefined) return fallback;
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max
    ? (value as number)
    : null;
};

/** 게이트 추가·수정 입력 (D-57, D-59). 규칙을 어기면 null */
export function parseGateInput(body: unknown): {
  name: string;
  adapter: GateAdapter;
  floor: number | null;
  openToAll: boolean;
} | null {
  const b = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const gateName = name(b.name);
  const a =
    typeof b.adapter === 'object' && b.adapter !== null
      ? (b.adapter as Record<string, unknown>)
      : {};
  if (!gateName) return null;
  const floor = b.floor === undefined || b.floor === null ? null : b.floor;
  if (
    floor !== null &&
    (!Number.isInteger(floor) || (floor as number) < -10 || (floor as number) > 200)
  )
    return null;
  if (b.openToAll !== undefined && typeof b.openToAll !== 'boolean') return null;
  const place = { floor: floor as number | null, openToAll: b.openToAll === true };
  if (a.type === 'MOCK') return { name: gateName, adapter: { type: 'MOCK' }, ...place };
  if (a.type !== 'DRY_CONTACT' || !isIpv4(a.host)) return null;
  const port = intIn(a.port, 1, 65535, 502);
  const unitId = intIn(a.unitId, 0, 255, 1);
  const coil = intIn(a.coil, 0, 65535, 0);
  const pulseMs = intIn(a.pulseMs, 100, 5000, 500);
  if (port === null || unitId === null || coil === null || pulseMs === null) return null;
  return {
    name: gateName,
    adapter: { type: 'DRY_CONTACT', host: a.host, port, unitId, coil, pulseMs },
    ...place,
  };
}

/** 단말 이름 바꾸기·게이트 옮기기. 하나 이상 있어야 함 */
export function parseTerminalChange(body: unknown): { name?: string; gateKey?: number } | null {
  const b = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const change: { name?: string; gateKey?: number } = {};
  if (b.name !== undefined) {
    const n = name(b.name);
    if (!n) return null;
    change.name = n;
  }
  if (b.gateKey !== undefined) {
    if (!Number.isSafeInteger(b.gateKey) || (b.gateKey as number) < 1) return null;
    change.gateKey = b.gateKey as number;
  }
  return Object.keys(change).length ? change : null;
}
