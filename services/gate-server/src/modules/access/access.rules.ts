import type { Employee } from '../employee/employee.types.ts';
import type { GateCheck } from '../permission/permission.repository.ts';
import type { DecisionResult } from './access.types.ts';

// 재직 여부, 게이트 권한(권한 그룹, 모든 사람 통과), 그룹 시간표 순 (D-59, D-61)
export function decide({
  isWorker,
  employee,
  access,
  lastGrantedMs,
  nowMs,
  duplicateWindowMs,
}: {
  isWorker: boolean;
  employee: Employee | undefined;
  /** 이 게이트를 지금 다닐 수 있는지 (permission.repository check) */
  access: GateCheck;
  lastGrantedMs: number | undefined;
  nowMs: number;
  duplicateWindowMs: number;
}): DecisionResult {
  if (!isWorker || !employee) return 'UNREGISTERED';
  if (employee.status !== 'ACTIVE') return 'DENIED_INACTIVE';
  if (access === 'NO_GATE') return 'DENIED_GATE';
  if (access === 'OFF_HOURS') return 'DENIED_TIME';
  if (lastGrantedMs !== undefined && nowMs - lastGrantedMs < duplicateWindowMs) return 'DUPLICATE';
  return 'GRANTED';
}
