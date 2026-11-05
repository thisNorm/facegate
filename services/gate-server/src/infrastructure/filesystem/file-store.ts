import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type FileStore = ReturnType<typeof createFileStore>;

// 생체정보 사진은 지금 폴더 권한으로만 보호한다. 서버가 직접 암호화하는 일은 다음 차례 (docs/11 2장). 파일과 폴더 이름에 직원 이름을 쓰지 않는다
export function createFileStore(fileDir: string) {
  const faceDir = (employeeKey: number) => path.resolve(fileDir, 'faces', String(employeeKey));

  return {
    facePath(employeeKey: number, fileName: string): string {
      return path.join(faceDir(employeeKey), path.basename(fileName));
    },

    saveFace(employeeKey: number, jpeg: Buffer): string {
      const fileName = `${crypto.randomUUID()}.jpg`;
      fs.mkdirSync(faceDir(employeeKey), { recursive: true });
      fs.writeFileSync(path.join(faceDir(employeeKey), fileName), jpeg);
      return fileName;
    },

    removeFace(employeeKey: number, fileName: string): void {
      fs.rmSync(path.join(faceDir(employeeKey), path.basename(fileName)), { force: true });
    },

    async saveEventImage(eventKey: number, name: string, jpeg: Buffer): Promise<string> {
      const dir = path.resolve(fileDir, 'events', String(eventKey));
      await fs.promises.mkdir(dir, { recursive: true });
      const file = path.join(dir, `${name}.jpg`);
      await fs.promises.writeFile(file, jpeg);
      return file;
    },

    visitorPhotoPath(callKey: number): string {
      return path.resolve(fileDir, 'visitors', `${callKey}.jpg`);
    },

    async saveVisitorPhoto(callKey: number, jpeg: Buffer): Promise<void> {
      await fs.promises.mkdir(path.resolve(fileDir, 'visitors'), { recursive: true });
      await fs.promises.writeFile(path.resolve(fileDir, 'visitors', `${callKey}.jpg`), jpeg);
    },

    removeVisitorPhoto(callKey: number): void {
      fs.rmSync(path.resolve(fileDir, 'visitors', `${callKey}.jpg`), { force: true });
    },

    /** 출입 기록 하나의 사진(appear·disappear) 폴더를 통째로 지움 */
    removeEventImages(eventKey: number): void {
      fs.rmSync(path.resolve(fileDir, 'events', String(eventKey)), {
        recursive: true,
        force: true,
      });
    },
  };
}
