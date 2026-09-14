import type { Guest, GuestListSegment } from '../../types';
import {
  getGuestSegmentQueryParams,
  guestHasMissingProfileInfo,
  guestHasMissingTourismType,
  type GuestSegment,
  type GuestSegmentQueryParams,
} from '../guests/utils';

/**
 * Guest Relations list segments — the legacy guests segment set plus the CRM
 * filters the list endpoint now supports (`vip`, `blacklisted`,
 * `has_open_support`) and the booking-derived `segment` filter (`returning`,
 * `in_house`, `upcoming`, `inactive`). Boolean filters are only ever sent as
 * `true`; an absent key means "no filter" (the backend treats `false` the
 * same, but keeping it out of the query string keeps URLs and query keys
 * clean).
 */
export type GuestRelationsSegment =
  | GuestSegment
  | 'vip'
  | 'blacklisted'
  | 'openRequests'
  | 'returning'
  | 'inHouse'
  | 'upcoming'
  | 'inactive';

export interface GuestRelationsSegmentQueryParams extends GuestSegmentQueryParams {
  vip?: boolean;
  blacklisted?: boolean;
  has_open_support?: boolean;
  segment?: GuestListSegment;
}

export const getGuestRelationsSegmentQueryParams = (
  segment: GuestRelationsSegment,
): GuestRelationsSegmentQueryParams => {
  switch (segment) {
    case 'vip':
      return { vip: true };
    case 'blacklisted':
      return { blacklisted: true };
    case 'openRequests':
      // Backend "open" mirrors the staff inbox: every status but 'closed'
      // ('resolved' stays reopenable, so it still counts).
      return { has_open_support: true };
    case 'returning':
      return { segment: 'returning' };
    case 'inHouse':
      return { segment: 'in_house' };
    case 'upcoming':
      return { segment: 'upcoming' };
    case 'inactive':
      return { segment: 'inactive' };
    default:
      return getGuestSegmentQueryParams(segment);
  }
};

/**
 * Defensive client-side mirror of the API filter so stale placeholder rows
 * never leak between segment transitions (same role the monolith's
 * `visibleGuests` filter played).
 */
export const guestMatchesSegment = (guest: Guest, segment: GuestRelationsSegment): boolean => {
  switch (segment) {
    case 'member':
      return guest.guest_type === 'member';
    case 'non':
      return guest.guest_type === 'non_member';
    case 'incomplete':
      return guestHasMissingProfileInfo(guest);
    case 'tourist':
      return guest.tourism_type === 'foreign';
    case 'missingTourism':
      return guestHasMissingTourismType(guest);
    case 'vip':
      return Boolean(guest.vip_status?.trim());
    case 'blacklisted':
      return guest.is_blacklisted === true;
    case 'openRequests':
      return guest.has_open_support === true;
    case 'returning':
    case 'inHouse':
    case 'upcoming':
    case 'inactive':
      // Derived from booking history on the backend — the list payload
      // carries no per-row segment field, so every returned row is a match
      // by definition.
      return true;
    case 'all':
    default:
      return true;
  }
};

export type GuestRelationsSegmentCounts = Record<GuestRelationsSegment, number>;

/** Inputs are the `total` values of `page_size=1` queries per filter. */
export const getGuestRelationsSegmentCounts = ({
  total,
  members,
  missingInfo,
  missingTourism,
  tourists,
  vip,
  blacklisted,
  openRequests,
  returning,
  inHouse,
  upcoming,
  inactive,
}: {
  total: number;
  members: number;
  missingInfo: number;
  missingTourism: number;
  tourists: number;
  vip: number;
  blacklisted: number;
  openRequests: number;
  returning: number;
  inHouse: number;
  upcoming: number;
  inactive: number;
}): GuestRelationsSegmentCounts => ({
  all: total,
  member: members,
  non: Math.max(total - members, 0),
  incomplete: missingInfo,
  tourist: tourists,
  missingTourism,
  vip,
  blacklisted,
  openRequests,
  returning,
  inHouse,
  upcoming,
  inactive,
});

export const GUEST_RELATIONS_SEGMENTS: ReadonlyArray<{
  key: GuestRelationsSegment;
  label: string;
}> = [
  { key: 'all', label: 'All guests' },
  { key: 'member', label: 'Members' },
  { key: 'non', label: 'Non-members' },
  { key: 'tourist', label: 'Tourists' },
  { key: 'incomplete', label: 'Missing info' },
  { key: 'missingTourism', label: 'Missing tourism' },
  { key: 'vip', label: 'VIP' },
  { key: 'blacklisted', label: 'Blacklisted' },
  { key: 'openRequests', label: 'Open requests' },
  { key: 'returning', label: 'Returning' },
  { key: 'inHouse', label: 'In house' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'inactive', label: 'Inactive' },
];
