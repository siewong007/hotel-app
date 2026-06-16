import { describe, expect, it } from 'vitest';
import { formatLocalDate, parseLocalDate, addLocalDays } from './date';

describe('date utilities', () => {
  it('formats dates to YYYY-MM-DD string', () => {
    expect(formatLocalDate(new Date(2026, 5, 15))).toBe('2026-06-15');
    expect(formatLocalDate(new Date(2026, 0, 1))).toBe('2026-01-01');
  });

  it('parses date strings', () => {
    const d = parseLocalDate('2026-06-15');
    expect(d).toBeDefined();
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(15);
  });

  it('adds days to a date', () => {
    const result = addLocalDays(new Date(2026, 5, 15), 3);
    expect(result.getDate()).toBe(18);
    expect(result.getMonth()).toBe(5);
  });

  it('adds days from a string date', () => {
    const result = addLocalDays('2026-06-15', 3);
    expect(result.getDate()).toBe(18);
    expect(result.getMonth()).toBe(5);
  });

  it('handles month overflow when adding days', () => {
    const result = addLocalDays(new Date(2026, 5, 29), 5);
    expect(result.getMonth()).toBe(6); // July
    expect(result.getDate()).toBe(4);
  });

  it('handles negative day addition', () => {
    const result = addLocalDays(new Date(2026, 5, 15), -3);
    expect(result.getDate()).toBe(12);
    expect(result.getMonth()).toBe(5);
  });

  it('formats current date when no argument provided', () => {
    const result = formatLocalDate();
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(result).toBe(expected);
  });
});