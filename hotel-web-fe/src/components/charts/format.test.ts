import { describe, expect, it } from 'vitest';

import { fmtCompactMoney, fmtInt, fmtPct, fmtShortDate, thinTicks } from './format';

describe('chart formatters', () => {
  it('fmtCompactMoney abbreviates thousands and millions', () => {
    expect(fmtCompactMoney(0)).toMatch(/^\D*0$/);
    expect(fmtCompactMoney(950)).toMatch(/950$/);
    expect(fmtCompactMoney(1200)).toMatch(/1k$/);
    expect(fmtCompactMoney(3_400_000)).toMatch(/3\.4M$/);
    expect(fmtCompactMoney(-2_600)).toMatch(/-3k$/);
  });

  it('fmtPct formats with one decimal by default', () => {
    expect(fmtPct(68.64)).toBe('68.6%');
    expect(fmtPct(72, 0)).toBe('72%');
  });

  it('fmtInt groups thousands and rounds', () => {
    expect(fmtInt(1234.6)).toBe('1,235');
    expect(fmtInt(0)).toBe('0');
  });

  it('fmtShortDate renders day + short month', () => {
    // Interface-locale output: en-US orders month before day.
    expect(fmtShortDate('2026-09-14')).toBe('Sep 14');
    expect(fmtShortDate('not-a-date')).toBe('not-a-date');
  });

  it('thinTicks keeps first/last and caps the count', () => {
    const days = Array.from({ length: 90 }, (_, i) => `d${i}`);
    const ticks = thinTicks(days);
    expect(ticks.length).toBeLessThanOrEqual(8);
    expect(ticks[0]).toBe('d0');
    expect(ticks[ticks.length - 1]).toBe('d89');
    expect(thinTicks(['a', 'b'])).toEqual(['a', 'b']);
    expect(thinTicks([])).toEqual([]);
  });
});
