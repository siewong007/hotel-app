import type { Promotion, PromotionDiscountType } from './types';

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
