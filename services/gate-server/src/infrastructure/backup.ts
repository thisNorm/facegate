import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 매일 백업 (P6). DB는 날짜별 사본을 keepDays일 남기고, 등록 얼굴 사진은 거울 폴더 하나로 맞춘다.
 * 사진을 날짜별로 쌓지 않는 까닭: 퇴사·동의 철회로 지운 얼굴이 백업에 오래 남지 않게 (동의서 4항)
 * 출입 사진(events)과 방문객 사진은 보존 기간 뒤 지우는 자료라 백업하지 않는다
 */
export function createBackup({
  sql,
  fileDir,
  backupDir,
  keepDays,
}: {
  sql: DatabaseSync;
  fileDir: string;
  backupDir: string;
  keepDays: number;
}) {
  const dbFile = (day: string) => path.join(backupDir, 'db', `${day}.db`);

  function mirrorFaces(): number {
    const from = path.resolve(fileDir, 'faces');
    const to = path.join(backupDir, 'faces');
    fs.mkdirSync(to, { recursive: true });
    const wanted = new Set<string>();
    let copied = 0;
    if (fs.existsSync(from))
      for (const rel of fs.readdirSync(from, { recursive: true }) as string[]) {
        const src = path.join(from, rel);
        if (!fs.statSync(src).isFile()) continue;
        wanted.add(rel);
        const dst = path.join(to, rel);
        // 얼굴 파일은 이름이 UUID라 한 번 쓰면 바뀌지 않는다
        if (fs.existsSync(dst)) continue;
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
        copied++;
      }
    for (const rel of fs.readdirSync(to, { recursive: true }) as string[]) {
      const dst = path.join(to, rel);
      if (fs.statSync(dst).isFile() && !wanted.has(rel)) fs.rmSync(dst);
    }
    return copied;
  }

  return {
    /** 오늘 백업이 이미 있으면 DB 사본은 건너뛴다. 돌려준 값은 기록용 */
    run(today: string): { db: string | null; facesCopied: number; removed: string[] } {
      fs.mkdirSync(path.join(backupDir, 'db'), { recursive: true });
      let db: string | null = null;
      if (!fs.existsSync(dbFile(today))) {
        db = dbFile(today);
        // 쓰는 중에도 일관된 사본을 만든다 (SQLite VACUUM INTO)
        sql.exec(`VACUUM INTO '${db.replaceAll("'", "''")}'`);
      }
      const days = fs
        .readdirSync(path.join(backupDir, 'db'))
        .map((f) => f.replace(/\.db$/, ''))
        .filter((d) => DAY.test(d))
        .sort();
      const removed = days.slice(0, Math.max(0, days.length - keepDays));
      for (const day of removed) fs.rmSync(dbFile(day));
      return { db, facesCopied: mirrorFaces(), removed };
    },
  };
}
