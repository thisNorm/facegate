import type { FileStore } from '../../infrastructure/filesystem/file-store.ts';
import { kst } from '../../shared/time.ts';
import type { RegisterEmployeeDto, UpdateEmployeeDto } from './employee.dto.ts';
import { CONSENT_VERSION } from './consent.ts';
import type { EmployeeRepository } from './employee.repository.ts';
import type { Employee, EmployeeDetail, EmployeeFilter, FaceSource } from './employee.types.ts';

export const MAX_FACES_PER_EMPLOYEE = 10;

export type EmployeeService = ReturnType<typeof createEmployeeService>;

export function createEmployeeService({
  employees,
  files,
  now = () => new Date(),
  knownDepartment = () => true,
}: {
  employees: EmployeeRepository;
  files: FileStore;
  now?: () => Date;
  /** 소속 목록에 있는 이름인지 (D-59). 빈 글자(소속 없음)는 묻지 않는다 */
  knownDepartment?: (name: string) => boolean;
}) {
  const unknown = (department: string | undefined) => !!department && !knownDepartment(department);
  return {
    register(
      dto: RegisterEmployeeDto,
      adminKey: number | null = null,
    ): number | 'DUPLICATE_NO' | 'UNKNOWN_DEPARTMENT' {
      if (unknown(dto.department)) return 'UNKNOWN_DEPARTMENT';
      if (employees.employeeNoTaken(dto.employeeNo)) return 'DUPLICATE_NO';
      const employeeKey = employees.addEmployee(dto);
      employees.setConsent(employeeKey, kst(now()), CONSENT_VERSION);
      for (const jpeg of dto.photos)
        employees.addFace(employeeKey, files.saveFace(employeeKey, jpeg), dto.source, adminKey);
      return employeeKey;
    },

    detail(employeeKey: number): EmployeeDetail | null {
      const employee = employees.getEmployee(employeeKey);
      if (!employee) return null;
      const faces = employees
        .listFaces(employeeKey)
        .map(({ faceImageKey, source, registeredBy, createdAt }) => ({
          faceImageKey,
          source,
          registeredBy,
          createdAt,
        }));
      return {
        ...employee,
        createdAt: employees.createdAt(employeeKey) ?? '',
        consentAt: employees.consentAt(employeeKey),
        consentVersion: employees.consentVersion(employeeKey),
        faces,
      };
    },

    addPhotos(
      employeeKey: number,
      photos: Buffer[],
      source: FaceSource,
      adminKey: number,
      consent = false,
    ): number[] | 'NOT_FOUND' | 'RETIRED' | 'TOO_MANY' | 'NO_CONSENT' {
      const employee = employees.getEmployee(employeeKey);
      if (!employee) return 'NOT_FOUND';
      if (employee.status !== 'ACTIVE') return 'RETIRED';
      if (employees.listFaces(employeeKey).length + photos.length > MAX_FACES_PER_EMPLOYEE)
        return 'TOO_MANY';
      if (!employees.consentAt(employeeKey)) {
        if (!consent) return 'NO_CONSENT';
        employees.setConsent(employeeKey, kst(now()), CONSENT_VERSION);
      }
      return photos.map((jpeg) =>
        employees.addFace(employeeKey, files.saveFace(employeeKey, jpeg), source, adminKey),
      );
    },

    deletePhoto(employeeKey: number, faceImageKey: number): boolean {
      const face = employees.getFace(employeeKey, faceImageKey);
      if (!face) return false;
      employees.deleteFace(faceImageKey);
      files.removeFace(employeeKey, face.fileName);
      return true;
    },

    photoPath(employeeKey: number, faceImageKey: number): string | null {
      const face = employees.getFace(employeeKey, faceImageKey);
      return face ? files.facePath(employeeKey, face.fileName) : null;
    },

    list(filter: EmployeeFilter) {
      return employees.listEmployees(filter);
    },

    update(
      employeeKey: number,
      dto: UpdateEmployeeDto,
    ): Employee | 'NOT_FOUND' | 'DUPLICATE_NO' | 'UNKNOWN_DEPARTMENT' {
      if (!employees.getEmployee(employeeKey)) return 'NOT_FOUND';
      if (unknown(dto.department)) return 'UNKNOWN_DEPARTMENT';
      if (dto.employeeNo !== undefined && employees.employeeNoTaken(dto.employeeNo, employeeKey))
        return 'DUPLICATE_NO';
      employees.updateEmployee(employeeKey, dto);
      return employees.getEmployee(employeeKey) as Employee;
    },

    /** 없는 직원이면 false. 퇴사 시 얼굴 사진 파기 (FR-A-04) */
    retire(employeeKey: number): boolean {
      if (!employees.getEmployee(employeeKey)) return false;
      for (const fileName of employees.retireEmployee(employeeKey))
        files.removeFace(employeeKey, fileName);
      return true;
    },
  };
}
