import type { DatabaseSync } from 'node:sqlite';

/** 소속: 우리 회사 부서 또는 임대 층 입주사 (D-59). 직원과는 employee.department = org.name으로 잇는다.
 * 출입 권한은 권한 그룹이 소속을 구성원으로 넣어 준다 (D-61) */
export type OrgKind = 'DEPARTMENT' | 'TENANT';
export type OrgView = { orgKey: number; name: string; kind: OrgKind; employeeCount: number };
export type OrgRepository = ReturnType<typeof createOrgRepository>;

const VIEW = `SELECT o.org_key AS orgKey, o.name, o.kind,
  (SELECT COUNT(*) FROM employee e WHERE e.department = o.name) AS employeeCount FROM org o`;

export function createOrgRepository(sql: DatabaseSync) {
  const repo = {
    list(): OrgView[] {
      return sql.prepare(`${VIEW} ORDER BY o.kind, o.name`).all() as OrgView[];
    },

    get(orgKey: number): OrgView | undefined {
      return sql.prepare(`${VIEW} WHERE o.org_key = ?`).get(orgKey) as OrgView | undefined;
    },

    getByName(name: string): OrgView | undefined {
      return sql.prepare(`${VIEW} WHERE o.name = ?`).get(name) as OrgView | undefined;
    },

    create(o: { name: string; kind: OrgKind }, at: string): number {
      return Number(
        sql
          .prepare('INSERT INTO org (name, kind, created_at) VALUES (?, ?, ?)')
          .run(o.name, o.kind, at).lastInsertRowid,
      );
    },

    /** 이름을 바꾸면 그 소속 직원의 department도 함께 바꾼다 */
    update(orgKey: number, o: { name?: string; kind?: OrgKind }): boolean {
      const before = repo.get(orgKey);
      if (!before) return false;
      sql.exec('BEGIN');
      try {
        sql
          .prepare(
            'UPDATE org SET name = COALESCE(?, name), kind = COALESCE(?, kind) WHERE org_key = ?',
          )
          .run(o.name ?? null, o.kind ?? null, orgKey);
        if (o.name !== undefined && o.name !== before.name)
          sql
            .prepare('UPDATE employee SET department = ? WHERE department = ?')
            .run(o.name, before.name);
        sql.exec('COMMIT');
        return true;
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },

    remove(orgKey: number): 'OK' | 'NOT_FOUND' | 'HAS_EMPLOYEES' {
      const org = repo.get(orgKey);
      if (!org) return 'NOT_FOUND';
      if (org.employeeCount > 0) return 'HAS_EMPLOYEES';
      sql.prepare('DELETE FROM org WHERE org_key = ?').run(orgKey);
      return 'OK';
    },

    /** 서버를 켤 때: 소속 목록에 없는 부서 글자를 부서 소속으로 만든다. 만든 수 */
    seedFromDepartments(at: string): number {
      return Number(
        sql
          .prepare(
            `INSERT INTO org (name, kind, created_at)
             SELECT DISTINCT department, 'DEPARTMENT', ? FROM employee
             WHERE department <> '' AND department NOT IN (SELECT name FROM org)`,
          )
          .run(at).changes,
      );
    },
  };
  return repo;
}
