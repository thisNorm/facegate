import { describe, expect, it } from 'vitest';
import { byFloor, floorName } from './floor';

describe('floor', () => {
  it('names floors and basements', () => {
    expect([floorName(3), floorName(-1), floorName(null)]).toEqual(['3층', 'B1층', '층 없음']);
  });

  it('groups by floor, lowest first, no floor last', () => {
    const g = (gateKey: number, floor: number | null) => ({ gateKey, floor });
    expect(
      byFloor([g(1, null), g(2, 3), g(3, -1), g(4, 3)]).map((f) => [
        f.floor,
        f.items.map((i) => i.gateKey),
      ]),
    ).toEqual([
      [-1, [3]],
      [3, [2, 4]],
      [null, [1]],
    ]);
  });
});
