import { formatStatusLabel } from '../../utils/formatters';
import { dateFormatter, formatNumber, type UseTranslationResult } from '../../i18n';
import type {
  Promotion,
  PromotionDiscountType,
  Voucher,
  VoucherDisplayStatus,
} from './types';

export function formatPromotionDiscount(
  promotion: Promotion,
  t: UseTranslationResult['t'],
): string {
  if (promotion.discount_type === 'percentage') {
    return t('promotions:discount.percentOff', { value: promotion.discount_value });
  }

  return formatCurrencyAmount(promotion.discount_value, promotion.currency || 'USD');
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

export function discountValueLabel(
  type: PromotionDiscountType,
  t: UseTranslationResult['t'],
): string {
  return type === 'percentage' ? t('promotions:editor.discountPercentage') : t('promotions:editor.discountAmount');
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
  expiresAt: string | null | undefined,
  t: UseTranslationResult['t'],
  nowMs: number = Date.now(),
): string | null {
  if (!expiresAt) return t('promotions:vouchers.noExpiry');
  const ms = new Date(expiresAt).getTime();
  if (Number.isNaN(ms)) return null;
  const diff = ms - nowMs;
  const days = Math.abs(Math.round(diff / DAY_MS));
  if (diff < 0) {
    return days === 0
      ? t('promotions:vouchers.expiredToday')
      : t('promotions:vouchers.expiredDaysAgo', { count: days });
  }
  if (diff < DAY_MS) return t('promotions:vouchers.expiresToday');
  return t('promotions:vouchers.expiresInDays', { count: days });
}

export function voucherSourceLabel(
  source: string,
  tOr: UseTranslationResult['tOr'],
): string {
  return tOr(`promotions:vouchers.source.${source}`, formatStatusLabel(source));
}

/** Why a promotion can't issue a voucher right now — mirrors the backend
 *  `ensure_admin_issueable` check so the dialog never offers dead options. */
export function promotionClaimIssue(
  promotion: Promotion,
  t: UseTranslationResult['t'],
  nowMs: number = Date.now(),
): string | null {
  if (promotion.status !== 'published') return t('promotions:issue.blockers.notPublished');
  if (
    promotion.claim_starts_at &&
    new Date(promotion.claim_starts_at).getTime() > nowMs
  ) {
    return t('promotions:issue.blockers.notOpen');
  }
  if (
    promotion.claim_ends_at &&
    new Date(promotion.claim_ends_at).getTime() < nowMs
  ) {
    return t('promotions:issue.blockers.windowClosed');
  }
  if (
    promotion.claim_limit != null &&
    promotion.claimed_count >= promotion.claim_limit
  ) {
    return t('promotions:issue.blockers.limitReached');
  }
  return null;
}

export function formatCurrencyAmount(amount: number, currency: string): string {
  try {
    return formatNumber(amount, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    });
  } catch {
    return `${currency} ${amount}`;
  }
}

export function guestDisplayName(
  voucher: Voucher,
  t: UseTranslationResult['t'],
): string {
  const name = voucher.guest_name?.trim();
  if (name) return name;
  return voucher.guest_id != null ? t('promotions:vouchers.guestNumber', { id: voucher.guest_id }) : '—';
}

/** Staff see the masked code; a raw code only exists where the API exposed it
 *  (e.g. a fresh issue response). */
export function voucherCodeLabel(voucher: Voucher): string {
  return voucher.code_masked ?? voucher.code ?? `#${voucher.id}`;
}
