import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatPortalCurrency } from './dashboardUtils';

describe('formatPortalCurrency', () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      clear: () => values.clear(),
    });
  });

  it('uses the currency selected in system configuration', () => {
    localStorage.setItem('hotelCurrency', 'MYR');

    expect(formatPortalCurrency(125.5)).toBe('RM 125.50');
  });

  it('updates when the configured currency changes', () => {
    localStorage.setItem('hotelCurrency', 'EUR');
    expect(formatPortalCurrency(125.5)).toBe('€125.50');

    localStorage.setItem('hotelCurrency', 'GBP');
    expect(formatPortalCurrency(125.5)).toBe('£125.50');
  });

  it('keeps missing amounts blank', () => {
    expect(formatPortalCurrency(null)).toBe('—');
  });
});
