import { describe, expect, it } from 'vitest';
import { CHECKOUT_RESUME_KEY, loadCheckoutResume, saveCheckoutResume, wantsCheckoutResume } from './checkoutResume';
import { GUEST_CHECKOUT_REDIRECT, GUEST_CHECKOUT_SIGN_IN, safeGuestRedirect } from '../../auth/guestRedirect';

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
}

describe('checkout resume', () => {
  const value = { details: { first_name: 'Ana', email: 'ana@example.com', phone: '0123', tourism_type: 'foreign' as const }, specialRequests: 'Quiet room', cleaningPreference: true, smokingPreference: 'non_smoking' as const };

  it('round-trips the entered details', () => {
    const store = memory();
    saveCheckoutResume(value, store, 1000);
    expect(loadCheckoutResume(store, 2000)).toEqual({ ...value, savedAt: 1000 });
  });

  it('expires after an hour and ignores malformed data', () => {
    const store = memory();
    saveCheckoutResume(value, store, 0);
    expect(loadCheckoutResume(store, 60 * 60 * 1000 + 1)).toBeNull();
    store.setItem(CHECKOUT_RESUME_KEY, '{not json');
    expect(loadCheckoutResume(store, 0)).toBeNull();
  });

  it('drops unknown enum values', () => {
    const store = memory();
    store.setItem(CHECKOUT_RESUME_KEY, JSON.stringify({ savedAt: 0, details: { tourism_type: 'x', first_name: 5 }, smokingPreference: 'cigar' }));
    const loaded = loadCheckoutResume(store, 0);
    expect(loaded?.details.tourism_type).toBe('');
    expect(loaded?.details.first_name).toBe('');
    expect(loaded?.smokingPreference).toBe('');
  });

  it('only resumes on the explicit flag', () => {
    expect(wantsCheckoutResume('?view=booking&resume=checkout')).toBe(true);
    expect(wantsCheckoutResume('?view=booking')).toBe(false);
  });
});

describe('checkout return-to is not an open redirect', () => {
  it('honours the checkout path and the sign-in link carries it', () => {
    expect(safeGuestRedirect(GUEST_CHECKOUT_REDIRECT)).toBe(GUEST_CHECKOUT_REDIRECT);
    expect(new URLSearchParams(GUEST_CHECKOUT_SIGN_IN.split('?')[1]).get('redirect')).toBe(GUEST_CHECKOUT_REDIRECT);
  });

  it.each([
    'https://evil.example/guest-portal?view=booking&resume=checkout',
    '//evil.example/guest-portal?view=booking&resume=checkout',
    '/\\evil.example',
    'javascript:alert(1)',
    '/guest-portal?view=booking&resume=checkout&next=https://evil.example',
    '/guest-portal?view=booking&resume=checkout#x',
    ' /guest-portal?view=booking&resume=checkout',
  ])('rejects %s', (value) => {
    expect(safeGuestRedirect(value)).toBeNull();
  });
});
