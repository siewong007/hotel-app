import type { GuestType, TourismType } from '../types/guest.types';

/**
 * Presentation metadata per enum value. Labels are `guests:` namespace keys —
 * resolve them with `t()` at render time so they follow the active locale.
 * Colors stay literal (they are not locale-sensitive).
 */
export const GUEST_TYPE_CONFIG: Record<
  GuestType,
  { labelKey: string; color: string; discountLabelKey: string }
> = {
  member: { labelKey: 'guestType.member', color: 'var(--hotel-success)', discountLabelKey: 'guestType.memberDiscount' },
  non_member: { labelKey: 'guestType.nonMember', color: 'var(--hotel-neutral)', discountLabelKey: 'guestType.standardRate' },
};

export const TOURISM_TYPE_CONFIG: Record<
  TourismType,
  { labelKey: string; color: string; taxLabelKey: string }
> = {
  local: { labelKey: 'tourismType.local', color: 'var(--hotel-info)', taxLabelKey: 'tourismType.noTax' },
  foreign: { labelKey: 'tourismType.foreign', color: 'var(--hotel-warning)', taxLabelKey: 'tourismType.taxApplies' },
};
