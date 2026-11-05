/** 서버의 한국 시간 문자열 → '11/03 09:00:00' */
export function timeText(kst: string | null): string {
  if (!kst) return '';
  return `${kst.slice(5, 7)}/${kst.slice(8, 10)} ${kst.slice(11, 19)}`;
}

export function todayKst(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
