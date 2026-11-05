import { kstMs } from '../../shared/time.ts';
import type { FileStore } from '../../infrastructure/filesystem/file-store.ts';
import type { AuditService } from '../audit/audit.service.ts';
import type { SettingService } from '../setting/setting.service.ts';
import type { VisitorRepository } from '../visitor/visitor.ts';
import type { AccessRepository } from './access.repository.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** NFR-10: 보존 기간이 지난 출입 사진 파일만 지우고 기록 행은 남김 */
export function createRetentionService({
  accessLogs,
  visitors,
  files,
  settings,
  audit,
  now = () => new Date(),
}: {
  accessLogs: AccessRepository;
  visitors?: Pick<VisitorRepository, 'purgePhotos'>;
  files: Pick<FileStore, 'removeEventImages' | 'removeVisitorPhoto'>;
  settings: Pick<SettingService, 'generalSettings'>;
  audit: AuditService;
  now?: () => Date;
}) {
  return {
    purge(): number {
      const days = settings.generalSettings().photoRetentionDays;
      const before = kstMs(new Date(now().getTime() - days * DAY_MS));
      const eventKeys = accessLogs.eventsToPurge(before);
      for (const eventKey of eventKeys) files.removeEventImages(eventKey);
      accessLogs.markImagesPurged(eventKeys);
      // 방문객 호출 사진도 같은 보존 기간 (D-58)
      for (const callKey of visitors?.purgePhotos(before.slice(0, 19)) ?? [])
        files.removeVisitorPhoto(callKey);
      if (eventKeys.length)
        audit.record(null, 'PHOTO_PURGE', null, { events: eventKeys.length, before });
      return eventKeys.length;
    },
  };
}
