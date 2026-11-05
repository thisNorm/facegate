import { AsyncLocalStorage } from 'node:async_hooks';
import { kst } from '../../shared/time.ts';
import type { AuditRepository } from './audit.repository.ts';
import type { AuditAction } from './audit.types.ts';

/** 요청이 관리자 웹에서 왔는지 단말에서 왔는지. server.ts가 경로마다 정함 */
export const auditVia = new AsyncLocalStorage<string>();

export type AuditService = ReturnType<typeof createAuditService>;

export function createAuditService({
  audits,
  now = () => new Date(),
}: {
  audits: AuditRepository;
  now?: () => Date;
}) {
  return {
    record(
      adminKey: number | null,
      action: AuditAction,
      target: string | null = null,
      detail: Record<string, unknown> | null = null,
    ): void {
      audits.add({ adminKey, action, target, detail }, kst(now()), auditVia.getStore() ?? null);
    },
  };
}
