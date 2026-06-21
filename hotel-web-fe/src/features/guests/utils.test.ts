import { describe, expect, it } from 'vitest';
import {
  getGuestSegmentCounts,
  getGuestSegmentQueryParams,
  guestHasMissingProfileInfo,
} from './utils';

describe('guest segment utilities', () => {
  it('maps segment chips to the API filters used by the Guests page', () => {
    expect(getGuestSegmentQueryParams('all')).toEqual({});
    expect(getGuestSegmentQueryParams('member')).toEqual({ guest_type: 'member' });
    expect(getGuestSegmentQueryParams('non')).toEqual({ guest_type: 'non_member' });
    expect(getGuestSegmentQueryParams('incomplete')).toEqual({ missing_info: true });
    expect(getGuestSegmentQueryParams('tourist')).toEqual({ tourism_type: 'foreign' });
  });

  it('derives chip tallies from full dataset stats instead of the visible page', () => {
    expect(getGuestSegmentCounts({
      total: 1228,
      members: 11,
      missingInfo: 49,
      tourists: 7,
    })).toEqual({
      all: 1228,
      member: 11,
      non: 1217,
      incomplete: 49,
      tourist: 7,
    });
  });

  it('treats blank required profile fields as missing info', () => {
    expect(guestHasMissingProfileInfo({
      email: 'guest@example.com',
      phone: '60123456789',
      ic_number: 'A123',
    })).toBe(false);

    const guestWithoutCompany = {
      email: 'guest@example.com',
      phone: '60123456789',
      ic_number: 'A123',
      company_name: '',
    };
    expect(guestHasMissingProfileInfo(guestWithoutCompany)).toBe(false);

    expect(guestHasMissingProfileInfo({
      email: ' ',
      phone: '60123456789',
      ic_number: 'A123',
    })).toBe(false);

    expect(guestHasMissingProfileInfo({
      email: ' ',
      phone: ' ',
      ic_number: 'A123',
    })).toBe(true);

    expect(guestHasMissingProfileInfo({
      email: 'guest@example.com',
      phone: ' ',
      ic_number: ' ',
    })).toBe(true);
  });
});
