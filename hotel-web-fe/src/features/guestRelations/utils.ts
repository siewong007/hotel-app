import type { Guest } from '../../types';
import { AVATAR_PALETTE } from '../guests/constants';

/** First letters of the first two name parts — the monolith's avatar rule. */
export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();

export const avatarFor = (id: number) => {
  const [bg, fg] = AVATAR_PALETTE[id % AVATAR_PALETTE.length];
  return { bg, fg };
};

/** Legal name for display; `nick_name` stays the primary display name. */
export const guestLegalName = (guest: Guest): string =>
  [guest.first_name, guest.last_name]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(' ')
    .trim();

const csvCell = (value: unknown) => {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
};

/**
 * CSV for the currently visible guests. Columns match the legacy export with
 * the CRM fields (`VIP Status`, `Blacklisted`) appended — the list payload
 * carries both since the select_cols widening.
 */
export const buildGuestsCsv = (guests: Guest[]): string => {
  const header = [
    'ID',
    'Name',
    'Email',
    'Phone',
    'IC / Passport',
    'Guest Type',
    'Tourism Type',
    'VIP Status',
    'Blacklisted',
    'Company',
    'Nationality',
    'Country',
    'Bookings',
    'Last Stay',
  ];
  const rows = guests.map((guest) => [
    guest.id,
    guest.nick_name,
    guest.email,
    guest.phone,
    guest.ic_number,
    guest.guest_type,
    guest.tourism_type,
    guest.vip_status,
    guest.is_blacklisted ? 'yes' : '',
    guest.company_name,
    guest.nationality,
    guest.country,
    guest.bookings_count ?? 0,
    guest.last_stay_date ?? '',
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
};

/**
 * The backend's duplicate-name guard embeds the conflicting guest in the
 * error message; parse it so the page can point the search at that row.
 */
export const duplicateGuestReference = (message: string) => {
  const match = message.match(
    /A guest with the name '([^']+)' already exists(?: \(Guest ID #(\d+)\))?/i
  );
  if (!match) return null;
  return {
    name: match[1],
    id: match[2],
  };
};
