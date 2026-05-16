import type { GuestType, TourismType } from '../types/guest.types';

export const GUEST_TYPE_CONFIG: Record<
  GuestType,
  { label: string; color: string; discountLabel: string }
> = {
  member: { label: 'Member', color: '#2e7d32', discountLabel: 'Member Discount' },
  non_member: { label: 'Non-Member', color: '#757575', discountLabel: 'Standard Rate' },
};

export const TOURISM_TYPE_CONFIG: Record<
  TourismType,
  { label: string; color: string; taxLabel: string }
> = {
  local: { label: 'Local', color: '#1976d2', taxLabel: 'No Tourism Tax' },
  foreign: { label: 'Foreign', color: '#ed6c02', taxLabel: 'Tourism Tax Applies' },
};
