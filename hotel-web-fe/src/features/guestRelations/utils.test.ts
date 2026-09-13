import { describe, it, expect } from 'vitest';
import type { Guest } from '../../types';
import { AVATAR_PALETTE } from '../guests/constants';
import {
  avatarFor,
  buildGuestsCsv,
  duplicateGuestReference,
  guestDisplayName,
  guestLegalName,
  initialsOf,
} from './utils';

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

describe('initialsOf', () => {
  it('takes the first letters of the first two name parts, uppercased', () => {
    expect(initialsOf('jane doe')).toBe('JD');
    expect(initialsOf('aisha')).toBe('A');
    expect(initialsOf('madonna  ')).toBe('M');
    expect(initialsOf('Anna Maria Lee')).toBe('AM');
  });
});

describe('avatarFor', () => {
  it('picks a palette entry deterministically by guest id', () => {
    const [bg, fg] = AVATAR_PALETTE[3 % AVATAR_PALETTE.length];
    expect(avatarFor(3)).toEqual({ bg, fg });
    expect(avatarFor(3)).toEqual(avatarFor(3));
  });
});

describe('guestLegalName', () => {
  it('joins trimmed first and last name parts', () => {
    expect(guestLegalName(buildGuest({ first_name: '  Jane ', last_name: 'Doe' }))).toBe('Jane Doe');
  });

  it('returns a lone half or empty string rather than padding blanks', () => {
    expect(guestLegalName(buildGuest({ first_name: 'Jane' }))).toBe('Jane');
    expect(guestLegalName(buildGuest({ last_name: 'Doe' }))).toBe('Doe');
    expect(guestLegalName(buildGuest({}))).toBe('');
  });
});

describe('guestDisplayName', () => {
  it('prefers the legal name only when BOTH halves exist', () => {
    expect(
      guestDisplayName(buildGuest({ first_name: 'Jane', last_name: 'Doe', nick_name: 'JD' })),
    ).toBe('Jane Doe');
  });

  it('falls back to the booking nickname when either half is missing', () => {
    expect(guestDisplayName(buildGuest({ first_name: 'Jane', nick_name: 'JD' }))).toBe('JD');
    expect(guestDisplayName(buildGuest({ last_name: 'Doe', nick_name: 'JD' }))).toBe('JD');
    expect(guestDisplayName(buildGuest({ first_name: '  ', last_name: 'Doe', nick_name: 'JD' }))).toBe('JD');
    expect(guestDisplayName(buildGuest({ nick_name: 'JD' }))).toBe('JD');
  });
});

describe('buildGuestsCsv', () => {
  it('emits the legacy header with the CRM columns appended', () => {
    const csv = buildGuestsCsv([]);
    expect(csv).toBe(
      '"ID","Name","Email","Phone","IC / Passport","Guest Type","Tourism Type","VIP Status","Blacklisted","Company","Nationality","Country","Bookings","Last Stay"',
    );
  });

  it('quotes every cell and doubles embedded quotes', () => {
    const csv = buildGuestsCsv([
      buildGuest({
        id: 9,
        nick_name: 'Say "Hi" Ho',
        email: 'say@example.com',
        guest_type: 'member',
        tourism_type: 'foreign',
        vip_status: 'vvip',
        is_blacklisted: true,
        company_name: 'ACME, Inc.',
        bookings_count: 3,
        last_stay_date: '2026-09-01',
      }),
    ]);
    const row = csv.split('\n')[1];
    expect(row).toContain('"Say ""Hi"" Ho"');
    expect(row).toContain('"ACME, Inc."');
    expect(row).toContain('"vvip"');
    expect(row).toContain('"yes"');
    expect(row).toContain('"3"');
    expect(row.endsWith('"2026-09-01"')).toBe(true);
  });

  it('leaves Blacklisted empty for non-blacklisted guests and defaults bookings to 0', () => {
    const csv = buildGuestsCsv([buildGuest({ id: 4 })]);
    const cells = csv.split('\n')[1].split(',');
    expect(cells[8]).toBe('""'); // Blacklisted
    expect(cells[12]).toBe('"0"'); // Bookings
    expect(cells[13]).toBe('""'); // Last Stay
  });
});

describe('duplicateGuestReference', () => {
  it('parses the backend duplicate-name error into name + id', () => {
    expect(
      duplicateGuestReference("A guest with the name 'Jane Doe' already exists (Guest ID #42)"),
    ).toEqual({ name: 'Jane Doe', id: '42' });
  });

  it('parses the message without a Guest ID suffix', () => {
    expect(duplicateGuestReference("A guest with the name 'JD' already exists")).toEqual({
      name: 'JD',
      id: undefined,
    });
  });

  it('returns null for unrelated errors', () => {
    expect(duplicateGuestReference('Network error')).toBeNull();
  });
});
