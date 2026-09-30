// Booking funnel logic (brief §7), kept free of the DOM so it can be tested:
// Sibu dates, validation and occupancy in plain words, the copyable summary,
// the booking-portal and WhatsApp links, and the analytics hooks.
//
// The guest portal (/guest-portal?view=booking) does not read pre-fill
// parameters yet — its search step always starts from tomorrow for one adult
// (PortalBookingPage). So the page opens it and shows the choice as a
// copyable summary. The parameters are still passed, named after the portal's
// own search fields, so a portal-side pre-fill can pick them up unchanged.
import { roomLayouts, ROOM_ORDER, type RoomLayout } from '../interiors/roomLayouts';
import { SHOW_PRICES, SITE, WEB_RATES, type RoomCode } from '../config/site';
import { copy, count, fill, roomName } from '../content';

export interface BookingChoice {
  checkIn: string; // YYYY-MM-DD
  checkOut: string;
  adults: number;
  children: number;
  room: RoomCode;
}

export type Field = 'checkIn' | 'checkOut' | 'adults' | 'room';

export interface Check {
  ok: boolean;
  errors: Partial<Record<Field, string>>;
  /** Allowed, but worth saying (the extra bed). */
  note?: string;
  nights: number;
  guests: number;
  extraBed: boolean;
}

const layouts = roomLayouts();

// ---------------------------------------------------------------- dates (Sibu time, UTC+8)
/** Today in Sibu as YYYY-MM-DD — the hotel's calendar, not the visitor's. */
export function todayInSibu(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuching', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const DAY = 86_400_000;
const toUtc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
};

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return fromUtc(toUtc(s)) === s; // rejects 2026-02-30
}

export function addDays(iso: string, n: number): string {
  return fromUtc(toUtc(iso) + n * DAY);
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((toUtc(checkOut) - toUtc(checkIn)) / DAY);
}

/** "Tue 6 Oct 2026", in the page's language */
export function longDate(iso: string): string {
  return new Intl.DateTimeFormat(copy.booking.dateLocale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(toUtc(iso)));
}

// ---------------------------------------------------------------- occupancy
/** Guests a type takes: its max occupancy, plus one on an extra bed where offered. */
export function capacity(l: RoomLayout): { base: number; withExtra: number } {
  return { base: l.maxGuests, withExtra: l.maxGuests + (l.extraBed ? 1 : 0) };
}

/** The smallest type (display order) that takes this many guests without an extra bed. */
function roomFor(guests: number): RoomLayout | null {
  for (const code of ROOM_ORDER) if (layouts[code].maxGuests >= guests) return layouts[code];
  return null;
}

// ---------------------------------------------------------------- validation
export function check(c: BookingChoice, today: string = todayInSibu()): Check {
  const b = copy.booking;
  const errors: Check['errors'] = {};
  const guests = c.adults + c.children;
  let nights = 0;
  if (!isIsoDate(c.checkIn)) errors.checkIn = b.errors.checkIn;
  else if (c.checkIn < today) errors.checkIn = b.errors.checkInPast;
  if (!isIsoDate(c.checkOut)) errors.checkOut = b.errors.checkOut;
  else if (isIsoDate(c.checkIn)) {
    nights = nightsBetween(c.checkIn, c.checkOut);
    if (nights < 1) errors.checkOut = b.errors.checkOutOrder;
  }
  if (!Number.isInteger(c.adults) || c.adults < 1) errors.adults = b.errors.adults;
  const l = layouts[c.room];
  let note: string | undefined;
  let extraBed = false;
  if (!l) errors.room = b.errors.room;
  else if (!errors.adults) {
    const cap = capacity(l);
    const bigger = roomFor(guests);
    if (guests > cap.withExtra) {
      errors.room = bigger
        ? fill(b.tooMany, { room: roomName(l.code), base: cap.base, extra: l.extraBed ? fill(b.tooManyExtra, { n: cap.withExtra }) : '', guests, bigger: roomName(bigger.code) })
        : fill(b.tooManyAll, { max: capacity(layouts.FS).withExtra, guests });
    } else if (guests > cap.base) {
      extraBed = true;
      note = fill(b.extraBedNote, { room: roomName(l.code), base: cap.base, charge: l.extraBedCharge, bigger: bigger ? fill(b.extraBedBigger, { bigger: roomName(bigger.code), guests }) : '' });
    }
  }
  return { ok: Object.keys(errors).length === 0, errors, note, nights, guests, extraBed };
}

// ---------------------------------------------------------------- summary and links
export function guestsText(c: Pick<BookingChoice, 'adults' | 'children'>): string {
  const b = copy.booking;
  return [count(b.adult, c.adults), ...(c.children ? [count(b.child, c.children)] : [])].join(b.listSep);
}

/** The copyable summary of the choice (also the WhatsApp message). */
export function summary(c: BookingChoice, k: Check = check(c)): string {
  const b = copy.booking;
  const lines = [
    `${SITE.name} — ${roomName(c.room)}`,
    fill(b.summaryStay, { in: longDate(c.checkIn), out: longDate(c.checkOut), nights: count(b.night, k.nights) }),
    `${guestsText(c)}${k.extraBed ? b.summaryExtraBed : ''}`,
  ];
  if (SHOW_PRICES) lines.push(fill(b.summaryRate, { rate: WEB_RATES[c.room] }));
  return lines.join('\n');
}

/** The booking portal, with the choice as parameters (see the note at the top). */
export function portalUrl(c: BookingChoice): string {
  const q = new URLSearchParams({
    check_in_date: c.checkIn,
    check_out_date: c.checkOut,
    adults: String(c.adults),
    children: String(c.children),
    room_type: c.room,
  });
  return `${SITE.bookingUrl}&${q.toString()}`;
}

export function whatsappUrl(text: string): string {
  return `https://wa.me/${SITE.whatsapp}?text=${encodeURIComponent(fill(copy.booking.whatsappText, { hotel: SITE.name, summary: text }))}`;
}

/** A sensible first choice: tomorrow, one night, two adults. */
export function defaultChoice(room: RoomCode, today: string = todayInSibu()): BookingChoice {
  const checkIn = addDays(today, 1);
  return { checkIn, checkOut: addDays(checkIn, 1), adults: 2, children: 0, room };
}

// ---------------------------------------------------------------- analytics hooks (brief §7)
export type BookingEvent = 'booking_cta_view' | 'booking_cta_click' | 'booking_submit';

/** No vendor is wired in: the owner can attach Plausible or GA to these events. */
export function track(name: BookingEvent, detail: Record<string, unknown>): void {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}
