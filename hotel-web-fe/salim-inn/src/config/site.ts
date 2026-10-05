// Public facts, feature flags and the open questions for the owner.
// Everything the page claims about the hotel is read from here or from
// src/data/hotel.json — never hard-coded in copy.
import hotel from '../data/hotel.json';

export type RoomCode = 'STDQ' | 'DLX' | 'SUP' | 'FR' | 'FS';

// ---------------------------------------------------------------------------
// Flags
// CONFIRM WITH OWNER (conflict 1): prices. saliminn.my shows web rates
// RM75 / 85 / 95 / 105 / 110; the PMS rack rates are RM95 / 105 / 110 / 130 /
// 155. Default: show the web rates as "from RM{x} / night · web rate".
export const SHOW_PRICES = true;

// CONFIRM WITH OWNER (conflict 4): only say "the only hotel in Farley" if the
// owner confirms — a short-let listing sits on the same street.
export const CLAIM_ONLY_HOTEL = false;

// Guest rating: shown only with its source and date (brief §2).
export const SHOW_RATING = false;
export const RATING = { score: 8.4, outOf: 10, count: 190, source: 'Wego', month: 'Sept 2026', url: 'https://www.wego.fr/en/hotels/malaysia/sibu/salim-inn-1221340' };

// ---------------------------------------------------------------------------
// Facts
export const SITE = {
  name: 'Salim Inn',
  address: {
    line1: 'No. 21 & 22, Lorong Salim 17',
    line2: 'Jalan Salim, Farley Commercial Centre',
    postcode: '96000',
    city: 'Sibu',
    state: 'Sarawak',
    country: 'MY',
  },
  // Geo point of the entrance (the NW corner lot of the Farley ring). Derived
  // from OSM + Street View, see README "Hotel position".
  geo: { lat: 2.26633, lon: 111.86231 },
  // Same coordinates as src/features/guestPortal/salimInnPlace.ts. A search
  // URL with the lat,lon query drops a pin on that entrance.
  mapsUrl: 'https://www.google.com/maps/search/?api=1&query=2.26633,111.86231',
  phoneDisplay: '+60 11-1050 7083',
  phoneE164: '+601110507083',
  whatsapp: '601110507083',
  // CONFIRM WITH OWNER (conflict 3): PMS says saliminnsibu@gmail.com, V16 used
  // reservation@saliminn.com. Default to the PMS address.
  email: hotel.public_settings.hotel_email,
  // Same-origin: the page is served by the hotel app, next to its guest portal.
  bookingUrl: '/guest-portal?view=booking',
  // CONFIRM WITH OWNER (conflict 2): check-in time. saliminn.my and OTA
  // listings say from 2:00 pm; the PMS says 08:00. Default 2:00 pm.
  checkIn: { label: '2:00 pm', iso: '14:00' },
  checkOut: { label: '12:00 noon', iso: '12:00' },
  frontDesk: '24-hour reception, CCTV',
  frontDeskHours: '24 hours', // brief §2: 24-hour reception (saliminn.my)
  cancellation: 'Free cancellation with at least 3 days’ notice. Later cancellations or no-shows are charged the first night.',
  inRoom: ['Free high-speed Wi-Fi', 'Air-conditioning', 'LCD TV with satellite channels', 'Private ensuite bathroom', 'Fresh towels', 'Bidet sprayer'],
  // Trust row: PMS payment methods minus OTAs and "Complimentary Room".
  paymentMethods: ['Cash', 'Visa', 'Mastercard', 'Debit card', 'Sarawak Pay', 'Bank transfer', 'PayPal', 'Boost', 'MAE', 'QRPay'],
  distances: { airportKm: 13.3, cityCentreKm: 4.2, supermarketWalk: 'about a 5-minute walk' },
  // CONFIRM WITH OWNER (conflict 5): building occupancy. The M2 calibration
  // found four lots (6.3 + 6.3 + 6.3 + 3.57 m). Street View puts Salim Inn on
  // the corner lot and the entrance lot, which matches the address "No. 21 &
  // 22", and cafe.cafe on the two southern lots. Levels 1–2 are modelled as
  // hotel rooms across all four lots, because 29 rooms need more floor area than
  // two lots give. The upper-floor split is still an inference.
  occupancyInferred: true,
} as const;

/** The front-desk facts: chapter 5's copy and the registration card on the
 *  counter both print these (brief §3 ch. 5). */
export const FRONT_DESK_FACTS: readonly string[] = [
  `Check-in from ${SITE.checkIn.label}`,
  `Check-out by ${SITE.checkOut.label}`,
  `Front desk ${SITE.frontDeskHours}`,
];

// CONFIRM WITH OWNER (conflict 1): web rates by room type (saliminn.my).
export const WEB_RATES: Record<RoomCode, number> = { STDQ: 75, DLX: 85, SUP: 95, FR: 105, FS: 110 };

// Site names for the PMS room types, and the Superior Twin size the PMS lacks.
export const ROOM_DISPLAY: Record<RoomCode, { name: string; sizeSqm: number; sizeFlag?: string; photo?: string; photoFlag?: string }> = {
  STDQ: { name: 'Standard Queen', sizeSqm: 25, photo: 'guest-room.jpg', photoFlag: 'No Standard Queen photo exists; shown with the generic guest-room photo.' },
  DLX: { name: 'Deluxe King', sizeSqm: 35, photo: 'deluxe-king.jpg' },
  // CONFIRM WITH OWNER: Superior Twin size is missing in the PMS. Modelled at 28 m².
  SUP: { name: 'Superior Twin', sizeSqm: 28, sizeFlag: 'Size not in the PMS — modelled at 28 m²', photo: 'superior-twin.jpg' },
  FR: { name: 'Family Room', sizeSqm: 45, photo: 'family-room.jpg' },
  FS: { name: 'Family Suite', sizeSqm: 55, photo: 'family-suite.jpg' },
};

export const OPEN_QUESTIONS = [
  'Prices: web rates (RM75–110) or PMS rack rates (RM95–155)? SHOW_PRICES defaults to web rates.',
  'Check-in time: 2:00 pm (website) or 08:00 (PMS)? Page uses 2:00 pm.',
  'Email: saliminnsibu@gmail.com (PMS) or reservation@saliminn.com (V16)? Page uses the PMS address.',
  '“The only hotel in Farley”: not claimed unless confirmed (a short-let listing shares the street).',
  'Building occupancy: Salim Inn holds the corner and entrance lots (No. 21 & 22) and cafe.cafe the two southern lots; rooms are modelled on levels 1–2 across all four lots, which is an inference.',
  'Superior Twin size: not in the PMS; modelled at 28 m².',
  'Reception, stair and corridor: modelled on the owner’s photos (2 Oct 2026): the mural behind a black granite counter, laminate walls, the steel bench, and the burgundy-carpeted stair opposite the reception. Sizes are judged from the photos; the stair core’s position in the plan is still an inference.',
  'Reception mural: shown as photographed (squared up, the price stand painted out). Confirm it may be reproduced, and whether the artist should be credited. The booking-site and payment badges on the counter are left off; plain notices stand in.',
  'Room numbers: level 1 uses a placeholder sequence 101–114 (odd on the facade side, even behind); the configurator room is shown as 103, and the landing’s plates list the modelled doors. The real level-1 plates read “101–108, 113, 114 ▶” and “◀ 109–112”; matching them needs the floor plan.',
  'Bed runner: the brief asks for a forest-green runner on every bed, but none of the owner’s photos shows one. Kept for now.',
  'Bedside lamps: none appear in the owner’s photos, so none are modelled.',
  'Family Suite: listed as having no window, but its photo shows sage curtains; modelled as curtains over a closed wall.',
  'Standard Queen: no photo of this type exists; the configurator shows the generic guest-room photo, captioned as such, with the camera framed by eye.',
  'Neighbourhood: the owner confirmed 13 more places on 3 Oct 2026, so 15 of the 25 in neighbourhood.json now show, with five must-try dishes. The rest stay off until checked; clearing a flag adds the place to the hotspots, cards and walking labels.',
  'Neighbourhood, still open: where the new food court stands is not given, and the old one (in the supermarket’s row) matches no map point, so neither has a walking time.',
  'Supermarket walk: saliminn.my says about 5 minutes; the brief’s straight-line formula gives about 3 (165 m). The page shows the published 5.',
  'Booking portal pre-fill: the portal ignores the dates, guests and room the panel sends, so guests re-enter them (the panel shows a copyable summary). A small portal change would make them carry over.',
  'Link preview: replaced the room photo with the chapter 3 hero render (salim-inn-hero-v2.jpg); the old image is still published.',
  'Extra bed: RM35 is shown without a unit (per night or per stay?), and children count towards each room’s maximum occupancy.',
];
