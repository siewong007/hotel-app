// The booking panel's rules (brief §7): Sibu dates, validation, occupancy in
// plain words, the summary and the two links. The panel itself is exercised
// in Chrome by the workshop's perf/m4-check.ts.
import { describe, expect, it } from 'vitest';
import { addDays, check, defaultChoice, isIsoDate, nightsBetween, portalUrl, summary, todayInSibu, whatsappUrl, type BookingChoice } from './ui/booking';
import { SHOW_PRICES, SITE, WEB_RATES } from './config/site';

const TODAY = '2026-10-01';
const choice = (c: Partial<BookingChoice> = {}): BookingChoice => ({ checkIn: '2026-10-05', checkOut: '2026-10-07', adults: 2, children: 0, room: 'DLX', ...c });

describe('dates', () => {
  it('reads today on the hotel’s clock (Sibu, UTC+8), not the visitor’s', () => {
    expect(todayInSibu(new Date('2026-09-30T20:30:00Z'))).toBe('2026-10-01'); // 04:30 in Sibu
    expect(todayInSibu(new Date('2026-09-30T15:59:00Z'))).toBe('2026-09-30'); // 23:59 in Sibu
  });

  it('adds days and counts nights across month ends, and rejects impossible dates', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 2)).toBe('2027-01-02');
    expect(nightsBetween('2026-10-30', '2026-11-02')).toBe(3);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-1-5')).toBe(false);
  });

  it('starts from tomorrow, one night, two adults', () => {
    expect(defaultChoice('FR', TODAY)).toEqual({ checkIn: '2026-10-02', checkOut: '2026-10-03', adults: 2, children: 0, room: 'FR' });
  });
});

describe('validation', () => {
  it('accepts a plain stay and counts nights and guests', () => {
    const k = check(choice({ children: 1 }), TODAY);
    expect(k).toMatchObject({ ok: true, nights: 2, guests: 3, extraBed: true });
  });

  it('rejects past, missing and back-to-front dates, and no adults', () => {
    expect(check(choice({ checkIn: '2026-09-30' }), TODAY).errors.checkIn).toMatch(/past/);
    expect(check(choice({ checkIn: '' }), TODAY).errors.checkIn).toMatch(/Choose/);
    expect(check(choice({ checkOut: '2026-10-05' }), TODAY).errors.checkOut).toMatch(/after check-in/);
    expect(check(choice({ adults: 0 }), TODAY).errors.adults).toBeTruthy();
    expect(check(choice({ checkIn: TODAY, checkOut: '2026-10-02' }), TODAY).ok).toBe(true); // same-day arrival is fine
  });

  it('explains the extra bed in the brief’s words, and points to the next size up', () => {
    const k = check(choice({ room: 'FR', adults: 3, children: 1 }), TODAY);
    expect(k.ok).toBe(true);
    expect(k.note).toBe('The Family Room fits 3; add an extra bed (RM35) or choose the Family Suite for 4.');
    expect(check(choice({ room: 'DLX', adults: 3 }), TODAY).note).toBe('The Deluxe King fits 2; add an extra bed (RM35) or choose the Family Room for 3.');
    expect(check(choice({ room: 'FS', adults: 5 }), TODAY).note).toBe('The Family Suite fits 4; add an extra bed (RM35).');
  });

  it('refuses more guests than a room takes, naming the room that does', () => {
    expect(check(choice({ room: 'STDQ', adults: 3 }), TODAY).errors.room).toBe('The Standard Queen fits 2. For 3, choose the Family Room.');
    expect(check(choice({ room: 'DLX', adults: 4 }), TODAY).errors.room).toBe('The Deluxe King fits 2 (3 with an extra bed). For 4, choose the Family Suite.');
    expect(check(choice({ room: 'FS', adults: 4, children: 2 }), TODAY).errors.room).toBe('One room fits up to 5 guests. For 6, book two rooms or call us.');
  });
});

describe('summary and links', () => {
  it('summarises the choice in plain lines', () => {
    const text = summary(choice({ room: 'FR', adults: 2, children: 2 }), check(choice({ room: 'FR', adults: 2, children: 2 }), TODAY));
    expect(text.split('\n')).toEqual([
      `${SITE.name} — Family Room`,
      'Check-in Mon, 5 Oct 2026 · Check-out Wed, 7 Oct 2026 (2 nights)',
      '2 adults, 2 children · extra bed',
      ...(SHOW_PRICES ? [`From RM${WEB_RATES.FR} a night · web rate`] : []),
    ]);
  });

  it('opens the portal with the choice named after its own search fields', () => {
    expect(portalUrl(choice())).toBe(`${SITE.bookingUrl}&check_in_date=2026-10-05&check_out_date=2026-10-07&adults=2&children=0&room_type=DLX`);
    expect(portalUrl(choice()).startsWith('/guest-portal?view=booking&')).toBe(true);
  });

  it('hands WhatsApp the summary, encoded', () => {
    const url = whatsappUrl('Deluxe King\n2 adults');
    expect(url.startsWith(`https://wa.me/${SITE.whatsapp}?text=`)).toBe(true);
    expect(decodeURIComponent(url.split('?text=')[1])).toBe(`Hello ${SITE.name}, I’d like to book:\nDeluxe King\n2 adults`);
  });
});
