import { getHotelSetting } from './hotelSettings';

export const formatLocalDate = (date: Date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

export const parseLocalDate = (dateString: string): Date => {
  const [datePart] = dateString.split('T');
  const [year, month, day] = datePart.split('-').map(Number);

  return new Date(year, month - 1, day);
};

export const addLocalDays = (date: Date | string, days: number): Date => {
  const base = typeof date === 'string' ? parseLocalDate(date) : date;
  const next = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  next.setDate(next.getDate() + days);

  return next;
};

// ---------------------------------------------------------------------------
// Hotel-timezone business dates
//
// timestamptz columns (e.g. customer_ledgers / customer_ledger_payments
// payment_date, created_at) arrive as Z-suffixed RFC3339 instants. The
// calendar date of an instant depends on the timezone it is read in, so
// business dates are derived in the hotel's timezone (system_settings
// 'timezone', synced into hotelSettings) — formatting with the viewer's zone
// renders dates a day off outside the hotel's UTC offset. Date-only strings
// and zone-less wall times are already hotel-local calendar values and pass
// through without timezone math.
// ---------------------------------------------------------------------------

export type BusinessDateValue = string | Date | null | undefined;

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAIVE_DATETIME_RE = /^(\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}/;
const TRAILING_ZONE_RE = /(?:Z|z|[+-]\d{2}:?\d{2})$/;

const HOTEL_TIME_ZONE_FALLBACK = 'Asia/Kuala_Lumpur';

// configured value -> zone Intl actually accepts (bad settings fall back)
const usableTimeZones = new Map<string, string>();

export const getHotelTimeZone = (): string => {
  const raw = getHotelSetting('timezone');
  const configured = typeof raw === 'string' && raw.trim() ? raw.trim() : HOTEL_TIME_ZONE_FALLBACK;
  let usable = usableTimeZones.get(configured);
  if (!usable) {
    let probe: Intl.DateTimeFormat | undefined;
    try {
      probe = new Intl.DateTimeFormat('en-US', { timeZone: configured });
    } catch {
      probe = undefined;
    }
    usable = probe ? configured : HOTEL_TIME_ZONE_FALLBACK;
    usableTimeZones.set(configured, usable);
  }
  return usable;
};

const hotelDatePartFormatters = new Map<string, Intl.DateTimeFormat>();

const hotelDatePartFormatter = (): Intl.DateTimeFormat => {
  const timeZone = getHotelTimeZone();
  let formatter = hotelDatePartFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    hotelDatePartFormatters.set(timeZone, formatter);
  }
  return formatter;
};

const instantToHotelDateString = (date: Date): string => {
  if (Number.isNaN(date.getTime())) return '';
  const parts = hotelDatePartFormatter().formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find(p => p.type === type)?.value ?? '';
  const year = part('year');
  const month = part('month');
  const day = part('day');
  return year && month && day ? `${year}-${month}-${day}` : '';
};

// 'YYYY-MM-DD' of the value's calendar date in the hotel timezone ('' when unparseable).
export const toHotelDateString = (value: BusinessDateValue): string => {
  if (!value) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (DATE_ONLY_RE.test(trimmed)) return trimmed;
    const naive = NAIVE_DATETIME_RE.exec(trimmed);
    if (naive && !TRAILING_ZONE_RE.test(trimmed)) return naive[1];
    return instantToHotelDateString(new Date(trimmed));
  }
  return instantToHotelDateString(value);
};

// Calendar date in the hotel timezone rendered like 'Jul 26, 2026'.
export const formatHotelDate = (value: BusinessDateValue, fallback = '-'): string => {
  const match = DATE_ONLY_RE.exec(toHotelDateString(value));
  if (!match) return fallback;
  const calendarDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return calendarDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

// Date + time display: zoned instants render in the hotel timezone; zone-less
// values keep their literal wall time; date-only values render as a date.
export const formatHotelDateTime = (value: BusinessDateValue, fallback = '-'): string => {
  if (!value) return fallback;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const dateOnly = DATE_ONLY_RE.exec(trimmed);
    if (dateOnly) {
      return new Date(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3])
      ).toLocaleDateString();
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return fallback;
    if (NAIVE_DATETIME_RE.test(trimmed) && !TRAILING_ZONE_RE.test(trimmed)) {
      return parsed.toLocaleString();
    }
    return parsed.toLocaleString(undefined, { timeZone: getHotelTimeZone() });
  }
  if (Number.isNaN(value.getTime())) return fallback;
  return value.toLocaleString(undefined, { timeZone: getHotelTimeZone() });
};

// True once the hotel calendar has moved past the value's date (the day itself
// does not count as past) — viewer-timezone independent.
export const isHotelDatePast = (value: BusinessDateValue): boolean => {
  const target = toHotelDateString(value);
  if (!target) return false;
  const today = toHotelDateString(new Date());
  return today !== '' && target < today;
};
