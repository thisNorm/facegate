import type { DatabaseSync } from 'node:sqlite';

export type SettingRepository = ReturnType<typeof createSettingRepository>;

export function createSettingRepository(sql: DatabaseSync) {
  return {
    get(name: string): { value: string; updatedAt: string } | undefined {
      return sql
        .prepare('SELECT value, updated_at AS updatedAt FROM setting WHERE name = ?')
        .get(name) as { value: string; updatedAt: string } | undefined;
    },

    set(name: string, value: string, updatedAt: string): void {
      sql
        .prepare(
          `INSERT INTO setting (name, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .run(name, value, updatedAt);
    },
  };
}
