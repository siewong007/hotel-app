// The static head (brief §9): the schema.org Hotel block and the link-preview
// image must match the site config and hotel.json, and the head and the copy
// must make no claim the brief rules out (§2: "Never claim").
import { describe, expect, it } from 'vitest';
import html from '../index.html?raw';
import hotel from './data/hotel.json';
import { SHOW_PRICES, SITE, WEB_RATES } from './config/site';
import { en } from './content/en';

const shared = Object.keys(import.meta.glob('../../public/salim-inn/share/*.jpg')).map((k) => k.split('/').pop());
const head = html.slice(0, html.indexOf('</head>'));
const ld = JSON.parse(head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
const meta = (prop: string) => head.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`))?.[1];

describe('schema.org Hotel', () => {
  it('states the facts the config holds', () => {
    expect(ld['@type']).toBe('Hotel');
    expect(ld.name).toBe(SITE.name);
    expect(ld.telephone).toBe(SITE.phoneE164);
    expect(ld.address).toMatchObject({
      streetAddress: `${SITE.address.line1}, ${SITE.address.line2}`,
      addressLocality: SITE.address.city,
      addressRegion: SITE.address.state,
      postalCode: SITE.address.postcode,
      addressCountry: SITE.address.country,
    });
    expect(ld.geo).toMatchObject({ latitude: SITE.geo.lat, longitude: SITE.geo.lon });
    expect(SITE.mapsUrl).toBe(`https://www.google.com/maps/search/?api=1&query=${SITE.geo.lat},${SITE.geo.lon}`);
    expect(html).toContain(SITE.mapsUrl.replace(/&/g, '&amp;'));
    expect(ld.checkinTime).toBe(SITE.checkIn.iso);
    expect(ld.checkoutTime).toBe(SITE.checkOut.iso);
    expect(ld.numberOfRooms).toBe(hotel.room_inventory.total_active_rooms);
    expect(ld.amenityFeature.map((a: { name: string }) => a.name)).toEqual(['Free Wi-Fi', 'Air-conditioning', '24-hour front desk', 'Parking']);
  });

  it('gives a price range only when prices are shown', () => {
    const rates = Object.values(WEB_RATES);
    expect(ld.priceRange).toBe(SHOW_PRICES ? `RM${Math.min(...rates)}–RM${Math.max(...rates)}` : undefined);
  });
});

describe('link preview', () => {
  it('uses the published hero render, and it exists', () => {
    const img = meta('og:image')!;
    expect(img).toBe(ld.image);
    expect(shared).toContain(img.split('/').pop());
    expect([meta('og:image:width'), meta('og:image:height')]).toEqual(['1200', '630']);
  });
});

describe('honest claims (brief §2)', () => {
  it('never claims stars, luxury or amenities the hotel does not list', () => {
    const text = `${head}\n${JSON.stringify(en)}`.toLowerCase();
    for (const word of ['star rating', '5-star', 'five-star', 'luxury', 'pool', 'gym', 'spa ', 'breakfast', 'airport transfer', ' lift']) {
      expect(text.includes(word), word).toBe(false);
    }
  });
});
