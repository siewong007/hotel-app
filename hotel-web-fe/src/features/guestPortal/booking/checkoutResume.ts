import type { AnonymousGuestDetails, SmokingPreference } from './types';

/**
 * Carries a signed-out guest's checkout across the sign-in round trip.
 *
 * The cart itself already lives in sessionStorage (cart.ts). This holds the
 * rest of the checkout: the details typed into the form and the stay
 * preferences, and the fact that the guest was at checkout. The booking page
 * writes it while a signed-out guest is checking out and consumes it once,
 * when it loads signed in with `?resume=checkout`.
 *
 * Same tab only (sessionStorage), and it expires, so stale details never
 * reappear on a later visit.
 */
export const CHECKOUT_RESUME_KEY = 'portal-booking-checkout-resume-v1';
export const CHECKOUT_RESUME_PARAM = 'resume';
export const CHECKOUT_RESUME_VALUE = 'checkout';
const MAX_AGE_MS = 60 * 60 * 1000;

export interface CheckoutResume {
  details: AnonymousGuestDetails;
  specialRequests: string;
  cleaningPreference: boolean;
  smokingPreference: SmokingPreference | '';
  savedAt: number;
}

function sessionStore(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

const str = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '');

export function saveCheckoutResume(
  value: Omit<CheckoutResume, 'savedAt'>,
  storage: Pick<Storage, 'setItem'> | undefined = sessionStore(),
  now: number = Date.now(),
): void {
  try {
    storage?.setItem(CHECKOUT_RESUME_KEY, JSON.stringify({ ...value, savedAt: now }));
  } catch {
    // Storage full or blocked: the guest simply re-enters their details.
  }
}

export function clearCheckoutResume(storage: Pick<Storage, 'removeItem'> | undefined = sessionStore()): void {
  try {
    storage?.removeItem(CHECKOUT_RESUME_KEY);
  } catch {
    // ignore
  }
}

/** The saved checkout, or null when missing, malformed or expired. */
export function loadCheckoutResume(
  storage: Pick<Storage, 'getItem'> | undefined = sessionStore(),
  now: number = Date.now(),
): CheckoutResume | null {
  try {
    const raw = storage?.getItem(CHECKOUT_RESUME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const savedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : 0;
    if (now - savedAt > MAX_AGE_MS || savedAt > now + 60_000) return null;
    const d = (parsed.details ?? {}) as Record<string, unknown>;
    const tourism = d.tourism_type === 'local' || d.tourism_type === 'foreign' ? d.tourism_type : '';
    const smoking = parsed.smokingPreference;
    return {
      details: { first_name: str(d.first_name, 100), email: str(d.email, 254), phone: str(d.phone, 20), tourism_type: tourism } as AnonymousGuestDetails,
      specialRequests: str(parsed.specialRequests, 2000),
      cleaningPreference: parsed.cleaningPreference === true,
      smokingPreference: smoking === 'smoking' || smoking === 'non_smoking' ? smoking : '',
      savedAt,
    };
  } catch {
    return null;
  }
}

/** True when the page URL asks to resume a checkout after sign-in. */
export function wantsCheckoutResume(search: string): boolean {
  return new URLSearchParams(search).get(CHECKOUT_RESUME_PARAM) === CHECKOUT_RESUME_VALUE;
}
