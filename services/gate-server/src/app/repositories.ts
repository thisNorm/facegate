import type { DatabaseSync } from 'node:sqlite';
import { createAccessRepository } from '../modules/access/access.repository.ts';
import { createAdminRepository } from '../modules/admin/admin.repository.ts';
import { createAiRepository } from '../modules/ai/ai.repository.ts';
import { createAuditRepository } from '../modules/audit/audit.repository.ts';
import { createEmployeeRepository } from '../modules/employee/employee.repository.ts';
import { createGateRepository } from '../modules/gate/gate.repository.ts';
import { createOrgRepository } from '../modules/org/org.repository.ts';
import { createPhoneRepository } from '../modules/phone/phone.ts';
import { createPermissionRepository } from '../modules/permission/permission.repository.ts';
import { createVisitorRepository } from '../modules/visitor/visitor.ts';
import { createSettingRepository } from '../modules/setting/setting.repository.ts';

export type Repositories = ReturnType<typeof createRepositories>;

export function createRepositories(sql: DatabaseSync) {
  return {
    employees: createEmployeeRepository(sql),
    accessLogs: createAccessRepository(sql),
    aiStatus: createAiRepository(sql),
    settings: createSettingRepository(sql),
    admins: createAdminRepository(sql),
    audits: createAuditRepository(sql),
    gates: createGateRepository(sql),
    visitors: createVisitorRepository(sql),
    orgs: createOrgRepository(sql),
    permissions: createPermissionRepository(sql),
    phones: createPhoneRepository(sql),
  };
}
