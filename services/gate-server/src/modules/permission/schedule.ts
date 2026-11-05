/** 하루 한 구간. end는 24:00까지. 칸이 null이면 그날은 막음 */
export type DayRange = { start: string; end: string } | null;
/** 0=일 … 6=토, 7=휴일 (D-61) */
export type WeekDays = DayRange[];
export const HOLIDAY = 7;
export const ALL_DAY: WeekDays = Array.from({ length: 8 }, () => ({
  start: '00:00',
  end: '24:00',
}));

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** 한국 날짜 'YYYY-MM-DD'와 요일, 하루 중 분 */
export function kstParts(at: Date): { date: string; weekday: number; minute: number } {
  const k = new Date(at.getTime() + KST_OFFSET_MS);
  return {
    date: k.toISOString().slice(0, 10),
    weekday: k.getUTCDay(),
    minute: k.getUTCHours() * 60 + k.getUTCMinutes(),
  };
}

/** 휴일이면 휴일 칸, 아니면 요일 칸. 시작 이상 끝 미만이면 연다 */
export function isOpen(days: WeekDays, at: Date, isHoliday: (date: string) => boolean): boolean {
  const { date, weekday, minute } = kstParts(at);
  const range = days[isHoliday(date) ? HOLIDAY : weekday];
  return range !== null && minutes(range.start) <= minute && minute < minutes(range.end);
}

/** 관리자 입력 검사. 맞으면 정리한 8칸, 아니면 null */
export function parseDays(value: unknown): WeekDays | null {
  if (!Array.isArray(value) || value.length !== 8) return null;
  const days: WeekDays = [];
  for (const day of value) {
    if (day === null) {
      days.push(null);
      continue;
    }
    const { start, end } = (day ?? {}) as { start?: unknown; end?: unknown };
    if (typeof start !== 'string' || typeof end !== 'string') return null;
    if (!TIME.test(start) || !TIME.test(end) || minutes(start) >= minutes(end)) return null;
    days.push({ start, end });
  }
  return days;
}
