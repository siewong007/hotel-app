import type { Guest, GuestType, TourismType } from '../../types';

export type GuestSegment = 'all' | 'member' | 'non' | 'incomplete' | 'tourist';

export type GuestSegmentQueryParams = {
  guest_type?: GuestType;
  tourism_type?: TourismType;
  missing_info?: boolean;
};

type GuestSegmentTotals = {
  total: number;
  members: number;
  missingInfo: number;
  tourists: number;
};

const hasValue = (value?: string | null) => Boolean(value?.trim());

export const guestHasMissingProfileInfo = (guest: Pick<Guest, 'email' | 'phone' | 'ic_number' | 'company_name'>) => (
  !hasValue(guest.email)
  || !hasValue(guest.phone)
  || !hasValue(guest.ic_number)
  || !hasValue(guest.company_name)
);

export const getGuestSegmentQueryParams = (segment: GuestSegment): GuestSegmentQueryParams => {
  switch (segment) {
    case 'member':
      return { guest_type: 'member' };
    case 'non':
      return { guest_type: 'non_member' };
    case 'incomplete':
      return { missing_info: true };
    case 'tourist':
      return { tourism_type: 'foreign' };
    case 'all':
    default:
      return {};
  }
};

export const getGuestSegmentCounts = ({ total, members, missingInfo, tourists }: GuestSegmentTotals) => ({
  all: total,
  member: members,
  non: Math.max(total - members, 0),
  incomplete: missingInfo,
  tourist: tourists,
} satisfies Record<GuestSegment, number>);
