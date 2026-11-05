import { jamoLike } from '../../shared/jamo.ts';
import type { DatabaseSync } from 'node:sqlite';
import { kst } from '../../shared/time.ts';
import type {
  Employee,
  EmployeeFilter,
  EmployeeSummary,
  FaceInfo,
  FaceSource,
} from './employee.types.ts';

export type EmployeeRepository = ReturnType<typeof createEmployeeRepository>;

const EDITABLE = { employeeNo: 'employee_no', name: 'name', department: 'department' } as const;

export function createEmployeeRepository(sql: DatabaseSync) {
  return {
    addEmployee({
      employeeNo,
      name,
      department = '',
    }: {
      employeeNo: string;
      name: string;
      department?: string;
    }): number {
      const result = sql
        .prepare(
          'INSERT INTO employee (employee_no, name, department, created_at) VALUES (?, ?, ?, ?)',
        )
        .run(employeeNo, name, department, kst());
      return Number(result.lastInsertRowid);
    },

    getEmployee(employeeKey: number): Employee | undefined {
      return sql
        .prepare(
          `SELECT employee_key AS employeeKey, employee_no AS employeeNo, name, department, status
           FROM employee WHERE employee_key = ?`,
        )
        .get(employeeKey) as Employee | undefined;
    },

    listEmployees(filter: EmployeeFilter): EmployeeSummary[] {
      const like = filter.q ? jamoLike(filter.q) : null;
      return sql
        .prepare(
          `SELECT e.employee_key AS employeeKey, e.employee_no AS employeeNo, e.name, e.department,
                  e.status, COUNT(f.face_image_key) AS faceCount
           FROM employee e LEFT JOIN face_image f ON f.employee_key = e.employee_key
           WHERE (?1 IS NULL OR jamo(e.name) LIKE ?1 ESCAPE '\\' OR jamo(e.employee_no) LIKE ?1 ESCAPE '\\'
                  OR jamo(e.department) LIKE ?1 ESCAPE '\\')
             AND (?2 IS NULL OR e.status = ?2)
             AND (?4 IS NULL OR e.department = ?4)
           GROUP BY e.employee_key
           HAVING ?3 = 0 OR COUNT(f.face_image_key) = 0
           ORDER BY e.employee_no`,
        )
        .all(
          like,
          filter.status ?? null,
          filter.noFace ? 1 : 0,
          filter.department ?? null,
        ) as EmployeeSummary[];
    },

    employeeNoTaken(employeeNo: string, exceptKey?: number): boolean {
      return (
        sql
          .prepare('SELECT 1 FROM employee WHERE employee_no = ? AND employee_key IS NOT ?')
          .get(employeeNo, exceptKey ?? null) !== undefined
      );
    },

    updateEmployee(
      employeeKey: number,
      fields: { employeeNo?: string; name?: string; department?: string },
    ): void {
      const names = (Object.keys(fields) as (keyof typeof EDITABLE)[]).filter(
        (name) => name in EDITABLE,
      );
      if (names.length === 0) return;
      sql
        .prepare(
          `UPDATE employee SET ${names.map((name) => `${EDITABLE[name]} = ?`).join(', ')} WHERE employee_key = ?`,
        )
        .run(...names.map((name) => fields[name] as string), employeeKey);
    },

    retireEmployee(employeeKey: number): string[] {
      sql.exec('BEGIN');
      try {
        const rows = sql
          .prepare(
            'SELECT file_name AS fileName FROM face_image WHERE employee_key = ? ORDER BY face_image_key',
          )
          .all(employeeKey) as { fileName: string }[];
        sql.prepare('DELETE FROM face_image WHERE employee_key = ?').run(employeeKey);
        sql
          .prepare("UPDATE employee SET status = 'RETIRED' WHERE employee_key = ?")
          .run(employeeKey);
        sql.exec('COMMIT');
        return rows.map((row) => row.fileName);
      } catch (error) {
        sql.exec('ROLLBACK');
        throw error;
      }
    },

    addFace(
      employeeKey: number,
      fileName: string,
      source: FaceSource = 'WEB_UPLOAD',
      registeredBy: number | null = null,
    ): number {
      return Number(
        sql
          .prepare(
            'INSERT INTO face_image (employee_key, file_name, source, registered_by, created_at) VALUES (?, ?, ?, ?, ?)',
          )
          .run(employeeKey, fileName, source, registeredBy, kst()).lastInsertRowid,
      );
    },

    consentAt(employeeKey: number): string | null {
      return (
        (
          sql
            .prepare('SELECT consent_at AS c FROM employee WHERE employee_key = ?')
            .get(employeeKey) as { c: string | null } | undefined
        )?.c ?? null
      );
    },

    consentVersion(employeeKey: number): string | null {
      return (
        (
          sql
            .prepare('SELECT consent_version AS v FROM employee WHERE employee_key = ?')
            .get(employeeKey) as { v: string | null } | undefined
        )?.v ?? null
      );
    },

    setConsent(employeeKey: number, at: string, version: string): void {
      sql
        .prepare(
          'UPDATE employee SET consent_at = ?, consent_version = ? WHERE employee_key = ? AND consent_at IS NULL',
        )
        .run(at, version, employeeKey);
    },

    createdAt(employeeKey: number): string | undefined {
      return (
        sql
          .prepare('SELECT created_at AS createdAt FROM employee WHERE employee_key = ?')
          .get(employeeKey) as { createdAt: string } | undefined
      )?.createdAt;
    },

    listFaces(employeeKey: number): (FaceInfo & { fileName: string })[] {
      return sql
        .prepare(
          `SELECT f.face_image_key AS faceImageKey, f.file_name AS fileName, f.source,
                  a.name AS registeredBy, f.created_at AS createdAt
           FROM face_image f LEFT JOIN admin_user a ON a.admin_key = f.registered_by
           WHERE f.employee_key = ? ORDER BY f.face_image_key`,
        )
        .all(employeeKey) as (FaceInfo & { fileName: string })[];
    },

    /** 그 직원의 사진일 때만 */
    getFace(employeeKey: number, faceImageKey: number): { fileName: string } | undefined {
      return sql
        .prepare(
          'SELECT file_name AS fileName FROM face_image WHERE employee_key = ? AND face_image_key = ?',
        )
        .get(employeeKey, faceImageKey) as { fileName: string } | undefined;
    },

    deleteFace(faceImageKey: number): void {
      sql.prepare('DELETE FROM face_image WHERE face_image_key = ?').run(faceImageKey);
    },

    faceDataset(): { employeeKey: number; fileNames: string[] }[] {
      const rows = sql
        .prepare(
          `SELECT f.employee_key AS employeeKey, f.file_name AS fileName
           FROM face_image f JOIN employee e USING (employee_key)
           WHERE e.status = 'ACTIVE' ORDER BY f.employee_key, f.face_image_key`,
        )
        .all() as { employeeKey: number; fileName: string }[];
      const byEmployee = new Map<number, string[]>();
      for (const row of rows) {
        const fileNames = byEmployee.get(row.employeeKey) ?? [];
        fileNames.push(row.fileName);
        byEmployee.set(row.employeeKey, fileNames);
      }
      return [...byEmployee].map(([employeeKey, fileNames]) => ({ employeeKey, fileNames }));
    },
  };
}
