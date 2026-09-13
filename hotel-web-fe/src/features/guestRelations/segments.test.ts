import { describe, it, expect } from 'vitest';
import type { Guest } from '../../types';
import {
  GUEST_RELATIONS_SEGMENTS,
  getGuestRelationsSegmentCounts,
  getGuestRelationsSegmentQueryParams,
  guestMatchesSegment,
  type GuestRelationsSegment,
} from './segments';

function buildGuest(overrides: Partial<Guest> = {}): Guest {
  return {
    id: 1,
    nick_name: 'Jane Doe',
    is_active: true,
    guest_type: 'non_member',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('getGuestRelationsSegmentQueryParams', () => {
  it('maps every declared segment to its API filter', () => {
    const expected: Record<GuestRelationsSegment, Record<string, unknown>> = {
      all: {},
      member: { guest_type: 'member' },
      non: { guest_type: 'non_member' },
      incomplete: { missing_info: true },
      tourist: { tourism_type: 'foreign' },
      missingTourism: { missing_tourism: true },
      vip: { vip: true },
      blacklisted: { blacklisted: true },
      openRequests: { has_open_support: true },
    };
    for (const { key } of GUEST_RELATIONS_SEGMENTS) {
      expect(getGuestRelationsSegmentQueryParams(key)).toEqual(expected[key]);
    }
  });

  it('only ever emits `true` for boolean filters — absent means "no filter"', () => {
    for (const { key } of GUEST_RELATIONS_SEGMENTS) {
      const params = getGuestRelationsSegmentQueryParams(key);
      for (const flag of ['missing_info', 'missing_tourism', 'vip', 'blacklisted', 'has_open_support'] as const) {
        expect(params[flag] === undefined || params[flag] === true).toBe(true);
      }
    }
  });
});

describe('guestMatchesSegment', () => {
  it('matches members and non-members on guest_type', () => {
    expect(guestMatchesSegment(buildGuest({ guest_type: 'member' }), 'member')).toBe(true);
    expect(guestMatchesSegment(buildGuest({ guest_type: 'non_member' }), 'member')).toBe(false);
    expect(guestMatchesSegment(buildGuest({ guest_type: 'non_member' }), 'non')).toBe(true);
    expect(guestMatchesSegment(buildGuest({ guest_type: 'member' }), 'non')).toBe(false);
  });

  it('matches incomplete when contact info AND ic_number are missing', () => {
    expect(guestMatchesSegment(buildGuest({}), 'incomplete')).toBe(true);
    expect(guestMatchesSegment(buildGuest({ email: 'a@b.com', ic_number: 'IC1' }), 'incomplete')).toBe(false);
    // Email OR phone alone satisfies contact; ic_number is still required.
    expect(guestMatchesSegment(buildGuest({ phone: '123', ic_number: 'IC1' }), 'incomplete')).toBe(false);
    expect(guestMatchesSegment(buildGuest({ email: 'a@b.com' }), 'incomplete')).toBe(true);
  });

  it('matches tourist on tourism_type foreign and missingTourism when unset', () => {
    expect(guestMatchesSegment(buildGuest({ tourism_type: 'foreign' }), 'tourist')).toBe(true);
    expect(guestMatchesSegment(buildGuest({ tourism_type: 'local' }), 'tourist')).toBe(false);
    expect(guestMatchesSegment(buildGuest({ tourism_type: undefined }), 'missingTourism')).toBe(true);
    expect(guestMatchesSegment(buildGuest({ tourism_type: 'local' }), 'missingTourism')).toBe(false);
  });

  it('matches vip on a non-blank vip_status string', () => {
    expect(guestMatchesSegment(buildGuest({ vip_status: 'vvip' }), 'vip')).toBe(true);
    expect(guestMatchesSegment(buildGuest({ vip_status: '   ' }), 'vip')).toBe(false);
    expect(guestMatchesSegment(buildGuest({}), 'vip')).toBe(false);
  });

  it('matches blacklisted only on an explicit true flag', () => {
    expect(guestMatchesSegment(buildGuest({ is_blacklisted: true }), 'blacklisted')).toBe(true);
    expect(guestMatchesSegment(buildGuest({ is_blacklisted: false }), 'blacklisted')).toBe(false);
    expect(guestMatchesSegment(buildGuest({}), 'blacklisted')).toBe(false);
  });

  it('treats openRequests as a server-side-only filter — every returned row matches', () => {
    expect(guestMatchesSegment(buildGuest({}), 'openRequests')).toBe(true);
    expect(guestMatchesSegment(buildGuest({}), 'all')).toBe(true);
  });
});

describe('getGuestRelationsSegmentCounts', () => {
  it('derives the non-member count as total minus members, floored at zero', () => {
    const counts = getGuestRelationsSegmentCounts({
      total: 10,
      members: 4,
      missingInfo: 2,
      missingTourism: 3,
      tourists: 5,
      vip: 1,
      blacklisted: 1,
      openRequests: 6,
    });
    expect(counts).toEqual({
      all: 10,
      member: 4,
      non: 6,
      incomplete: 2,
      tourist: 5,
      missingTourism: 3,
      vip: 1,
      blacklisted: 1,
      openRequests: 6,
    });
  });

  it('never reports a negative non-member count when members exceed total', () => {
    const counts = getGuestRelationsSegmentCounts({
      total: 2,
      members: 5,
      missingInfo: 0,
      missingTourism: 0,
      tourists: 0,
      vip: 0,
      blacklisted: 0,
      openRequests: 0,
    });
    expect(counts.non).toBe(0);
  });
});
