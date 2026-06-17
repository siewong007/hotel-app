// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { formatCurrency, formatCurrencyCustom, getCurrencySymbol, getCurrencyInfo, setCurrentCurrency, toNumber, SUPPORTED_CURRENCIES } from './currency';

// Mock hotel settings to return empty object so no-arg tests exercise
// the DEFAULT_CURRENCY='USD' fallback path (correct for CI determinism).
vi.mock('./hotelSettings', () => ({
  getHotelSettings: () => ({}),
}));

describe('currency utilities', () => {
  it('converts various values to numbers safely', () => {
    expect(toNumber(1234.50)).toBe(1234.5);
    expect(toNumber(0)).toBe(0);
    expect(toNumber('180.50')).toBe(180.5);
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber('not-a-number')).toBe(0);
  });

  it('formats numeric values as currency strings', () => {
    expect(formatCurrency(1234.50)).toBe('$1234.50');
    expect(formatCurrency(0)).toBe('$0.00');
    expect(formatCurrency(99.99)).toBe('$99.99');
  });

  it('formats string values as currency strings', () => {
    expect(formatCurrency('180.50')).toBe('$180.50');
    expect(formatCurrency('0')).toBe('$0.00');
  });

  it('handles null and undefined gracefully', () => {
    expect(formatCurrency(null)).toBe('$0.00');
    expect(formatCurrency(undefined)).toBe('$0.00');
  });

  it('formats with specific currency codes', () => {
    expect(formatCurrency(1234.50, 'MYR')).toBe('RM 1234.50');
    expect(formatCurrency(99.99, 'EUR')).toBe('€99.99');
    expect(formatCurrency(1000, 'JPY')).toBe('¥1000');
  });

  it('formats with custom decimals', () => {
    const result = formatCurrencyCustom(100, 3, 'USD');
    expect(result).toContain('100.000');
  });

  it('returns correct currency symbols', () => {
    expect(getCurrencySymbol('USD')).toBe('$');
    expect(getCurrencySymbol('MYR')).toBe('RM');
    expect(getCurrencySymbol('EUR')).toBe('€');
    expect(getCurrencySymbol('GBP')).toBe('£');
  });

  it('returns currency info by code', () => {
    const usd = getCurrencyInfo('USD');
    expect(usd.code).toBe('USD');
    expect(usd.symbol).toBe('$');
    expect(usd.name).toBe('US Dollar');

    const myr = getCurrencyInfo('MYR');
    expect(myr.code).toBe('MYR');
    expect(myr.name).toBe('Malaysian Ringgit');
  });

  it('falls back to default currency for unknown codes', () => {
    const info = getCurrencyInfo('XYZ');
    expect(info.code).toBe('USD');
  });

  it('sets currency preference in localStorage', () => {
    // Mock localStorage
    const mockSetItem = vi.fn();
    Object.defineProperty(globalThis, 'localStorage', {
      value: { setItem: mockSetItem, getItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn(), length: 0, key: vi.fn() },
      writable: true,
      configurable: true,
    });
    setCurrentCurrency('EUR');
    expect(mockSetItem).toHaveBeenCalledWith('hotelCurrency', 'EUR');
  });

  it('supports all defined currencies', () => {
    const codes = Object.keys(SUPPORTED_CURRENCIES);
    expect(codes).toContain('USD');
    expect(codes).toContain('MYR');
    expect(codes).toContain('EUR');
    expect(codes).toContain('GBP');
    expect(codes).toContain('SGD');
    expect(codes).toContain('JPY');
    expect(codes).toContain('CNY');
    expect(codes).toContain('AUD');
    expect(codes).toContain('THB');
    expect(codes).toContain('IDR');
    expect(codes.length).toBe(10);
  });
});