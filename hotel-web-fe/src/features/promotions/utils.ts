import { formatStatusLabel } from '../../utils/formatters';
import type {
  Promotion,
  PromotionDiscountType,
  Voucher,
  VoucherDisplayStatus,
} from './types';

export function formatPromotionDiscount(promotion: Promotion): string {
  if (promotion.discount_type === 'percentage') {
    return `${promotion.discount_value}% off`;
  }

  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: promotion.currency || 'USD',
    maximumFractionDigits: 2,
  }).format(promotion.discount_value);
}

export function formatPromotionDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function slugifyPromotionName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function portalSessionScope(token?: string | null): string {
  if (!token) return 'anonymous';
  let hash = 5381;
  for (let index = 0; index < token.length; index += 1) {
    hash = (hash * 33) ^ token.charCodeAt(index);
  }
  return `portal-${hash >>> 0}`;
}

export function discountValueLabel(type: PromotionDiscountType): string {
  return type === 'percentage' ? 'Discount percentage' : 'Discount amount';
}

/** The status staff see: a still-`available` voucher past `expires_at` reads
 *  as expired — matching the backend `status=expired` query alias. */
export function voucherDisplayStatus(
  voucher: Pick<Voucher, 'status' | 'expires_at'>,
  nowMs: number = Date.now(),
): VoucherDisplayStatus {
  if (
    voucher.status === 'available' &&
    voucher.expires_at &&
    new Date(voucher.expires_at).getTime() < nowMs
  ) {
    return 'expired';
  }
  return voucher.status;
}

const DAY_MS = 86_400_000;

/** Short operational expiry line for tables/drawers. */
export function relativeExpiryLabel(
  expiresAt?: string | null,
  nowMs: number = Date.now(),
): string | null {
  if (!expiresAt) return 'No expiry';
  const ms = new Date(expiresAt).getTime();
  if (Number.isNaN(ms)) return null;
  const diff = ms - nowMs;
  const days = Math.abs(Math.round(diff / DAY_MS));
  if (diff < 0) return days === 0 ? 'Expired today' : `Expired ${days}d ago`;
  if (diff < DAY_MS) return 'Expires today';
  return `Expires in ${days}d`;
}

export function voucherSourceLabel(source: string): string {
  if (source === 'guest_claim') return 'Guest claim';
  if (source === 'admin_issue') return 'Issued by staff';
  return formatStatusLabel(source);
}

/** Why a promotion can't issue a voucher right now — mirrors the backend
 *  `ensure_admin_issueable` check so the dialog never offers dead options. */
export function promotionClaimIssue(
  promotion: Promotion,
  nowMs: number = Date.now(),
): string | null {
  if (promotion.status !== 'published') return 'Not published';
  if (
    promotion.claim_starts_at &&
    new Date(promotion.claim_starts_at).getTime() > nowMs
  ) {
    return 'Claims not open yet';
  }
  if (
    promotion.claim_ends_at &&
    new Date(promotion.claim_ends_at).getTime() < nowMs
  ) {
    return 'Claim window closed';
  }
  if (
    promotion.claim_limit != null &&
    promotion.claimed_count >= promotion.claim_limit
  ) {
    return 'Claim limit reached';
  }
  return null;
}

export function formatCurrencyAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

export function guestDisplayName(voucher: Voucher): string {
  const name = voucher.guest_name?.trim();
  if (name) return name;
  return voucher.guest_id != null ? `Guest #${voucher.guest_id}` : '—';
}
