import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatPortalCurrency, pointsActivityContext } from './dashboardUtils';

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

describe('pointsActivityContext', () => {
  const baseActivity = {
    date: '2026-07-23T10:00:00Z',
    transaction_type: 'earned',
    points: 3_000,
    balance_after: 3_000,
    reason: null,
    booking_number: null,
    adjusted_by: null,
  };

  it('identifies points earned from a booking', () => {
    expect(pointsActivityContext({
      ...baseActivity,
      booking_number: 'BK-2026-0042',
      reason: 'Points earned from eligible stay payment',
    })).toBe('From booking BK-2026-0042');
  });

  it('shows who made an admin adjustment and the specific reason', () => {
    expect(pointsActivityContext({
      ...baseActivity,
      transaction_type: 'adjusted',
      points: 100,
      balance_after: 3_100,
      adjusted_by: 'Aisha Rahman',
      reason: 'Service recovery for delayed check-in',
    })).toBe('Adjusted by Aisha Rahman: Service recovery for delayed check-in');
  });

  it('uses a guest-friendly fallback when an older adjustment has no actor', () => {
    expect(pointsActivityContext({
      ...baseActivity,
      transaction_type: 'adjusted',
      adjusted_by: null,
      reason: 'Welcome bonus',
    })).toBe('Adjusted by hotel staff: Welcome bonus');
  });
});
