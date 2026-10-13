import type { BookingWithDetails } from '../../../types';

/**
 * Settlement lock — mirrors `hotel-app-be/src/modules/payments/settlement_lock.rs`.
 *
 * A booking taken through an online channel (source `online`/`website`, or a
 * linked channel of type `ota`/`website`) is settled by that channel: its
 * room charge (`payment_type = 'booking'`) may only be recorded with the
 * channel's configured tender(s). Deposits and folio extras stay open. The
 * backend is the enforcement point; this helper only presets and restricts
 * the UI so staff never pick a tender the server will refuse.
 */
export type SettlementLock =
  | { kind: 'unlocked' }
  | { kind: 'locked'; platform: string; allowedMethods: string[] }
  | { kind: 'missing_channel' }
  | { kind: 'unconfigured'; platform: string };

export const WEBSITE_DEFAULT_METHODS = ['Bank Transfer', 'PayPal'];

type LockFields = Pick<
  BookingWithDetails,
  'source' | 'booking_channel_name' | 'booking_channel_type' | 'booking_channel_settlement_methods'
>;

/**
 * Lower-case, keep letters/digits, drop a trailing `com` (same rule as the
 * backend): `Booking.Com` → `booking`, `Traveloka.Com` → `traveloka`,
 * `bank_transfer` → `banktransfer`.
 */
export const normalizePaymentMethod = (method: string | null | undefined): string => {
  const compact = (method ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return compact.length > 3 && compact.endsWith('com') ? compact.slice(0, -3) : compact;
};

export const paymentMethodsMatch = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const left = normalizePaymentMethod(a);
  return left.length > 0 && left === normalizePaymentMethod(b);
};

const isToken = (value: string | null | undefined, token: string) =>
  (value ?? '').trim().toLowerCase() === token;

export const getSettlementLock = (booking: Partial<LockFields> | null | undefined): SettlementLock => {
  if (!booking) return { kind: 'unlocked' };
  const sourceOnline = isToken(booking.source, 'online');
  const sourceWebsite = isToken(booking.source, 'website');
  const channelOta = isToken(booking.booking_channel_type, 'ota');
  const channelWebsite = isToken(booking.booking_channel_type, 'website');
  if (!(sourceOnline || sourceWebsite || channelOta || channelWebsite)) return { kind: 'unlocked' };

  const configured = (booking.booking_channel_settlement_methods ?? [])
    .map((m) => m.trim())
    .filter(Boolean);
  const channelName = booking.booking_channel_name?.trim();

  if (channelName) {
    if (configured.length > 0) return { kind: 'locked', platform: channelName, allowedMethods: configured };
    if (channelWebsite) return { kind: 'locked', platform: channelName, allowedMethods: WEBSITE_DEFAULT_METHODS };
    return { kind: 'unconfigured', platform: channelName };
  }
  if (sourceWebsite) return { kind: 'locked', platform: 'Direct Website', allowedMethods: WEBSITE_DEFAULT_METHODS };
  return { kind: 'missing_channel' };
};

export const isSettlementLocked = (lock: SettlementLock) => lock.kind !== 'unlocked';

/** Whether `method` may settle the room charge under `lock`. */
export const isRoomMethodAllowed = (lock: SettlementLock, method: string): boolean => {
  if (lock.kind === 'unlocked') return true;
  if (lock.kind !== 'locked') return false;
  return lock.allowedMethods.some((allowed) => paymentMethodsMatch(allowed, method));
};

/**
 * Room-charge tender options for a dialog: every configured method when
 * unlocked; otherwise only the allowed tenders, spelled the way the hotel's
 * configured payment-method list spells them (so reports stay consistent).
 */
export const getRoomMethodOptions = (lock: SettlementLock, configuredMethods: readonly string[]): string[] => {
  if (lock.kind === 'unlocked') return [...configuredMethods];
  if (lock.kind !== 'locked') return [];
  return lock.allowedMethods.map(
    (allowed) => configuredMethods.find((m) => paymentMethodsMatch(m, allowed)) ?? allowed,
  );
};

/** The method a dialog should preset: `current` when allowed, else the first allowed option. */
export const presetRoomMethod = (
  lock: SettlementLock,
  configuredMethods: readonly string[],
  current: string,
): string => {
  if (lock.kind === 'unlocked') return current;
  const options = getRoomMethodOptions(lock, configuredMethods);
  return options.find((m) => paymentMethodsMatch(m, current)) ?? options[0] ?? current;
};
