// English copy. Every string the page shows lives here so Bahasa Malaysia and
// Chinese versions can be added later (phase 2 — no machine translation for
// launch). Facts are interpolated from config/site.ts, never typed inline.
import { SITE, WEB_RATES, SHOW_PRICES, CLAIM_ONLY_HOTEL } from '../config/site';

const minRate = Math.min(...Object.values(WEB_RATES));

export const en = {
  meta: {
    title: 'Salim Inn — Hotel in Farley Commercial Centre, Sibu',
    description: `Salim Inn is the hotel at the heart of Farley, Jalan Salim, Sibu: 29 air-conditioned rooms, free Wi-Fi, 24-hour reception and guest parking at the door. Book direct${SHOW_PRICES ? ` from RM${minRate} a night` : ''}.`,
  },
  brand: { name: 'SALIM INN', place: 'Farley, Sibu' },
  nav: { label: 'Chapters', play: 'Play film', pause: 'Pause film', replay: 'Replay film', book: 'Book direct', skip: 'Skip the film' },
  preloader: { loading: 'Loading the neighbourhood', ready: 'Scroll to begin' },
  chapters: [
    {
      id: 1,
      eyebrow: 'Farley · Sibu, Sarawak',
      title: 'Farley, Sibu.',
      body: 'Everything you need, within footsteps.',
    },
    {
      id: 2,
      eyebrow: 'The neighbourhood',
      title: 'Groceries, bakeries, cafés and pharmacies — steps from your door.',
      body: 'Farley’s supermarket, food court and everyday shops ring the block around the hotel.',
    },
    {
      id: 3,
      eyebrow: 'Lorong Salim 17',
      title: 'Salim Inn',
      body: CLAIM_ONLY_HOTEL ? 'The only hotel in Farley.' : 'At the heart of Farley.',
    },
    {
      id: 4,
      eyebrow: 'Arrival',
      title: 'Arrive, park at the door, check in.',
      body: 'Marked guest bays sit right in front of the lobby, under the canopy.',
    },
    {
      id: 5,
      eyebrow: 'Reception',
      title: 'Our front desk never closes.',
      body: `Check-in from ${SITE.checkIn.label} · Check-out by ${SITE.checkOut.label} · Front desk 24 hours`,
    },
    {
      id: 6,
      eyebrow: '29 rooms · 5 room types',
      title: 'Five ways to stay.',
      body: 'Every room has free high-speed Wi-Fi, air-conditioning, a satellite TV and its own ensuite bathroom.',
    },
    {
      id: 7,
      eyebrow: 'Within footsteps',
      title: 'Everything within footsteps.',
      body: `Sibu Airport (SBW) ≈ ${SITE.distances.airportKm} km · Sibu city centre ≈ ${SITE.distances.cityCentreKm} km · Farley supermarket ${SITE.distances.supermarketWalk}`,
    },
    {
      id: 8,
      eyebrow: 'Book direct',
      title: 'Book direct with Salim Inn.',
      body: SHOW_PRICES ? `From RM${minRate} a night · web rate` : 'Best when you book direct.',
    },
  ],
  footer: {
    osm: 'Map data © OpenStreetMap contributors',
    rights: `© ${new Date().getFullYear()} Salim Inn, Sibu`,
  },
} as const;

export type Copy = typeof en;
