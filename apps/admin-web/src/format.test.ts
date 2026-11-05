import { describe, expect, it } from 'vitest';
import { timeText, todayKst } from './format';

describe('format', () => {
  it('shows server times as month/day and time', () => {
    expect(timeText('2026-11-03 09:00:00.120')).toBe('11/03 09:00:00');
    expect(timeText(null)).toBe('');
  });

  it('gives the Korean date', () => {
    expect(todayKst(new Date('2026-11-03T16:00:00Z'))).toBe('2026-11-04'); // KST 01:00
  });
});
