import type { GuestType, TourismType } from '../types/guest.types';

export const GUEST_TYPE_CONFIG: Record<
  GuestType,
  { label: string; color: string; discountLabel: string }
> = {
  member: { label: 'Member', color: 'var(--hotel-success)', discountLabel: 'Member Discount' },
  non_member: { label: 'Non-Member', color: 'var(--hotel-neutral)', discountLabel: 'Standard Rate' },
};

export const TOURISM_TYPE_CONFIG: Record<
  TourismType,
  { label: string; color: string; taxLabel: string }
> = {
  local: { label: 'Local', color: 'var(--hotel-info)', taxLabel: 'No Tourism Tax' },
  foreign: { label: 'Foreign', color: 'var(--hotel-warning)', taxLabel: 'Tourism Tax Applies' },
};
