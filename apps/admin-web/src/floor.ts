/** 층 이름. 지하는 음수 (-1 → B1층) */
export const floorName = (floor: number | null) =>
  floor === null ? '층 없음' : floor < 0 ? `B${-floor}층` : `${floor}층`;

/** 낮은 층부터, 층 없는 것은 끝에 */
export function byFloor<T extends { floor: number | null }>(items: T[]) {
  const groups = new Map<number | null, T[]>();
  for (const item of items) groups.set(item.floor, [...(groups.get(item.floor) ?? []), item]);
  return [...groups.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a - b))
    .map(([floor, list]) => ({ floor, items: list }));
}
