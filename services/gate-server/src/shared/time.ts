const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function kstMs(date: Date = new Date()): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().replace('T', ' ').slice(0, 23);
}

export function kst(date: Date = new Date()): string {
  return kstMs(date).slice(0, 19);
}

export function parseKst(text: unknown): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d{3})?)$/.exec(String(text));
  if (!match) return null;
  const date = new Date(`${match[1]}T${match[2]}+09:00`);
  if (Number.isNaN(date.getTime())) return null;
  // 2026-02-31 같은 날짜는 넘어가서 값이 달라지므로 되돌려 비교
  const back = match[2].length > 8 ? kstMs(date) : kst(date);
  return back === `${match[1]} ${match[2]}` ? date : null;
}
