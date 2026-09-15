import { t, numberFormatter, dateFormatter } from '../../i18n';
import { formatStatusLabel } from '../../utils/formatters';
import type {
  Promotion,
  PromotionDiscountType,
  Voucher,
  VoucherDisplayStatus,
} from './types';

export function formatPromotionDiscount(promotion: Promotion): string {
  if (promotion.discount_type === 'percentage') {
    return t('promotions:discount.percentOff', {
      value: promotion.discount_value,
    });
  }

  return numberFormatter({
    style: 'currency',
    currency: promotion.currency || 'USD',
    maximumFractionDigits: 2,
  }).format(promotion.discount_value);
}

export function formatPromotionDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return dateFormatter({
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
  return type === 'percentage'
    ? t('promotions:labels.discountPercentage')
    : t('promotions:labels.discountAmount');
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
  if (!expiresAt) return t('promotions:expiry.none');
  const ms = new Date(expiresAt).getTime();
  if (Number.isNaN(ms)) return null;
  const diff = ms - nowMs;
  const days = Math.abs(Math.round(diff / DAY_MS));
  if (diff < 0) {
    return days === 0
      ? t('promotions:expiry.expiredToday')
      : t('promotions:expiry.expiredDaysAgo', { days });
  }
  if (diff < DAY_MS) return t('promotions:expiry.expiresToday');
  return t('promotions:expiry.expiresInDays', { days });
}

export function voucherSourceLabel(source: string): string {
  if (source === 'guest_claim') return t('promotions:source.guestClaim');
  if (source === 'admin_issue') return t('promotions:source.adminIssue');
  return formatStatusLabel(source);
}

/** Why a promotion can't issue a voucher right now — mirrors the backend
 *  `ensure_admin_issueable` check so the dialog never offers dead options. */
export function promotionClaimIssue(
  promotion: Promotion,
  nowMs: number = Date.now(),
): string | null {
  if (promotion.status !== 'published') {
    return t('promotions:claimIssue.notPublished');
  }
  if (
    promotion.claim_starts_at &&
    new Date(promotion.claim_starts_at).getTime() > nowMs
  ) {
    return t('promotions:claimIssue.notOpen');
  }
  if (
    promotion.claim_ends_at &&
    new Date(promotion.claim_ends_at).getTime() < nowMs
  ) {
    return t('promotions:claimIssue.windowClosed');
  }
  if (
    promotion.claim_limit != null &&
    promotion.claimed_count >= promotion.claim_limit
  ) {
    return t('promotions:claimIssue.limitReached');
  }
  return null;
}

export function formatCurrencyAmount(amount: number, currency: string): string {
  try {
    return numberFormatter({
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
  return voucher.guest_id != null
    ? t('promotions:labels.guestFallback', { id: voucher.guest_id })
    : '—';
}

/** Staff see the masked code; a raw code only exists where the API exposed it
 *  (e.g. a fresh issue response). */
export function voucherCodeLabel(voucher: Voucher): string {
  return voucher.code_masked ?? voucher.code ?? `#${voucher.id}`;
}
