import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../src/infrastructure/database/database.ts';
import { createRepositories } from '../../src/app/repositories.ts';
import { createFileStore } from '../../src/infrastructure/filesystem/file-store.ts';
import { createSettingService } from '../../src/modules/setting/setting.service.ts';
import { createAuditService } from '../../src/modules/audit/audit.service.ts';
import { createRetentionService } from '../../src/modules/access/access.retention.ts';

test('purge deletes event photos older than the retention period and keeps the rows', async () => {
  const repos = createRepositories(openDatabase(':memory:'));
  const fileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'facegate-retention-'));
  const files = createFileStore(fileDir);
  const now = () => new Date('2026-11-03T18:00:00.000Z'); // 2026-11-04 03:00 KST
  const settings = createSettingService({ settings: repos.settings, now });
  settings.updateGeneralSettings({ photoRetentionDays: 7 });
  const audit = createAuditService({ audits: repos.audits, now });

  const addEvent = async (receivedAt: string) => {
    const eventKey = repos.accessLogs.insertAccessLog({
      terminalKey: 101,
      gateKey: 1,
      employeeKey: null,
      aiTrackKey: 1,
      method: 'FACE',
      result: 'UNREGISTERED',
      appearTime: receivedAt.slice(0, 19),
      receivedAt,
      openedAt: null,
    });
    const full = await files.saveEventImage(eventKey, 'appear_full', Buffer.from('jpg'));
    await files.saveEventImage(eventKey, 'disappear_crop', Buffer.from('jpg'));
    repos.accessLogs.updateAccessLog(eventKey, { fullImage: full });
    return eventKey;
  };
  const old = await addEvent('2026-10-27 09:00:00.000'); // 8일 전
  const edge = await addEvent('2026-10-28 03:00:00.000'); // 정확히 7일 전 → 보존
  const recent = await addEvent('2026-11-03 09:00:00.000');

  const service = createRetentionService({
    accessLogs: repos.accessLogs,
    files,
    settings,
    audit,
    now,
  });
  assert.equal(service.purge(), 1);
  assert.equal(fs.existsSync(path.join(fileDir, 'events', String(old))), false);
  assert.equal(fs.existsSync(path.join(fileDir, 'events', String(edge))), true);
  assert.equal(fs.existsSync(path.join(fileDir, 'events', String(recent))), true);
  const row = repos.accessLogs.getAccessLog(old);
  assert.equal(row?.result, 'UNREGISTERED'); // 기록은 남음
  assert.equal(row?.fullImage, null);
  assert.equal(service.purge(), 0); // 두 번 지우지 않음
  const [log] = repos.audits.list(1);
  assert.equal(log.action, 'PHOTO_PURGE');
  assert.deepEqual(log.detail, { events: 1, before: '2026-10-28 03:00:00.000' });
});
