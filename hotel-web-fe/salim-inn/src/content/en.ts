// English copy. Every string the page shows lives here so the Bahasa Malaysia
// and Chinese bundles can follow the same shape. Facts are interpolated from
// config/site.ts, never typed inline; `{{name}}` slots are filled at runtime.
import { SITE, WEB_RATES, SHOW_PRICES, CLAIM_ONLY_HOTEL } from '../config/site';
import { neighbourhoodTitle, places, type NeighbourhoodWords, type PlaceGroup } from '../data/neighbourhood';

const minRate = Math.min(...Object.values(WEB_RATES));

/** The scene build's steps (World.build), named as its perf marks are. */
export type BuildStep = 'Sky and light' | 'Ground and rivers' | 'Roads' | 'Farley Commercial Centre' | 'Car parks' | 'Sibu' | 'Trees';

/** The whole page's copy. Every bundle implements this shape — a missing
 *  string is a type error, not a silent English fallback. */
export interface Copy {
  meta: { title: string; description: string };
  brand: { name: string; place: string; backToStart: string; logoAlt: string };
  nav: {
    /** aria-label for the top-actions group. */
    aria: string;
    /** aria-label for the chapter dot rail. */
    label: string;
    play: string;
    pause: string;
    replay: string;
    book: string;
    /** .skip-link text. */
    skipLink: string;
  };
  /** Account-aware topbar pills (accountActions.ts). */
  account: { signIn: string; myAccount: string; adminConsole: string; bookAnotherStay: string };
  /** Language picker aria-label. Option names are native labels — never translated. */
  lang: { aria: string };
  preloader: {
    loading: string;
    warming: string;
    almost: string;
    ready: string;
    /** Start-up calibration (film.ts). */
    tuning: string;
    /** The scene build's steps, keyed by the English names its perf marks use (World.build). */
    steps: Record<BuildStep, string>;
  };
  /** Chapter dot rail: one short label per chapter id (index 0 = chapter 1)
   *  plus the `{{id}}`/`{{label}}` aria template. */
  chapterNav: { labels: string[]; aria: string };
  chapters: { id: number; eyebrow: string; title: string; body: string }[];
  /** The booking card inside chapter 8. `call` takes `{{phone}}`. */
  bookingCard: { blurb: string; book: string; call: string };
  welcome: { eyebrow: string; title: string; intro: string };
  trust: { aria: string; items: { strong: string; span: string }[] };
  rooms: {
    eyebrow: string;
    title: string;
    blurb: string;
    items: { tag: string; name: string }[];
    perNight: string;
    checkAvailability: string;
    rateNote: string;
  };
  gallery: {
    eyebrow: string;
    title: string;
    blurb: string;
    /** In DOM order: the four room shots, then the six gallery figures. */
    items: { alt: string; title: string; caption: string }[];
  };
  amenities: { eyebrow: string; title: string; blurb: string; items: { title: string; body: string }[] };
  stay: {
    eyebrow: string;
    title: string;
    body: string;
    cta: string;
    labels: { address: string; call: string; email: string };
    /** Displayed postal address (may contain <br>). */
    address: string;
  };
  faq: { eyebrow: string; title: string; blurb: string; items: { q: string; a: string }[] };
  cta: { title: string; book: string; call: string };
  footer: { osm: string; rights: string };
  /** `rate` takes `{{min}}` and may contain <strong>. */
  mobileCta: { rate: string };
  /** The front desk's facts: the registration card (chapter 5) and the booking panel. */
  frontDesk: { checkIn: string; checkOut: string; hours: string };
  /** Chapters 2 and 7 (Neighbourhood.ts): chips, cards, walking times, and the
   *  words chapter 2's title is built from (data/neighbourhood.ts). */
  neighbourhood: NeighbourhoodWords & {
    chipsLabel: string;
    walkLabel: string;
    gettingHere: string;
    airport: string;
    city: string;
    open: string;
    call: string;
    unverified: string;
    /** A walking-time ring's label: `{{min}}`. */
    ring: string;
    placeOne: string;
    /** `{{n}}` places. */
    placeMany: string;
    groups: Record<PlaceGroup, string>;
  };
  /** Chapter 6's room configurator and the still page's room picker. */
  configurator: {
    tabsAria: string;
    beds: string;
    size: string;
    sleeps: string;
    extraBed: string;
    from: string;
    /** `{{n}}` guests. */
    upTo: string;
    /** `{{charge}}`. */
    extraBedYes: string;
    extraBedNo: string;
    /** `{{rate}}`. */
    rate: string;
    /** One and several of each bed, `{{n}}`. */
    bed: Record<'single' | 'queen' | 'king', [one: string, many: string]>;
    /** `{{bed}}` with its `{{w}}` × `{{l}}` in cm. */
    bedSize: string;
    bedJoin: string;
    noWindow: string;
    /** The Superior Twin's size, which the PMS lacks. */
    sizeFlag: string;
    /** The Standard Queen, which has no photo of its own. */
    photoFlag: string;
    seeReal: string;
    back3d: string;
    photoAria: string;
    /** "Owner's photo", before a room name or a note. */
    photo: string;
  };
  /** Chapter 8's booking panel and its messages (BookingPanel.ts, booking.ts). */
  booking: {
    formLabel: string;
    checkIn: string;
    checkOut: string;
    adults: string;
    children: string;
    room: string;
    submit: string;
    whatsapp: string;
    call: string;
    /** `{{methods}}`, joined with `listSep`. */
    payLine: string;
    webRate: string;
    summaryLabel: string;
    copy: string;
    copied: string;
    selectToCopy: string;
    continue: string;
    reopen: string;
    leadDesktop: string;
    leadMobile: string;
    /** A room select option: `{{room}}`, `{{n}}` guests; then `{{rate}}`. */
    roomOption: string;
    roomOptionRate: string;
    errors: { checkIn: string; checkInPast: string; checkOut: string; checkOutOrder: string; adults: string; room: string };
    /** Over a type's occupancy: `{{room}}` `{{base}}` `{{extra}}` `{{guests}}` `{{bigger}}`. */
    tooMany: string;
    /** `{{n}}` with the extra bed. */
    tooManyExtra: string;
    /** More than any one room takes: `{{max}}` `{{guests}}`. */
    tooManyAll: string;
    /** `{{room}}` `{{base}}` `{{charge}}` `{{bigger}}`. */
    extraBedNote: string;
    /** `{{bigger}}` `{{guests}}`. */
    extraBedBigger: string;
    adult: [one: string, many: string];
    child: [one: string, many: string];
    night: [one: string, many: string];
    listSep: string;
    /** `{{in}}` `{{out}}` `{{nights}}`. */
    summaryStay: string;
    summaryExtraBed: string;
    /** `{{rate}}`. */
    summaryRate: string;
    /** `{{hotel}}` `{{summary}}`. */
    whatsappText: string;
    cancellation: string;
    paymentMethods: string[];
    /** Intl locale for the summary's dates. */
    dateLocale: string;
  };
  /** The still version (Fallback.ts): its note, and each chapter poster's alt text. */
  fallback: { note: string; alts: string[] };
}

const nb: Copy['neighbourhood'] = {
  chipsLabel: 'Nearby, by category',
  walkLabel: 'Walking times',
  gettingHere: 'Getting here',
  airport: `Sibu Airport (SBW) ≈ ${SITE.distances.airportKm} km`,
  city: `Sibu city centre ≈ ${SITE.distances.cityCentreKm} km`,
  open: 'Open',
  call: 'Call',
  unverified: 'Not yet verified',
  ring: '{{min}} min · approx.',
  placeOne: '1 place',
  placeMany: '{{n}} places',
  groups: { groceries: 'Groceries', food: 'Food & cafés', health: 'Pharmacies & clinics', services: 'Everyday services' },
  title: '{{list}} — steps from your door.',
  titleMore: '{{list}} and more — steps from your door.',
  titleEmpty: 'Farley, right outside your door.',
  listComma: ', ',
  listAnd: ' and ',
  phrases: {
    supermarket: 'the Farley supermarket',
    groceries: 'groceries',
    cafeDownstairs: 'a café downstairs',
    cafesBakeriesEat: 'cafés, bakeries and places to eat',
    bakeries: 'bakeries',
    cafesEat: 'cafés and places to eat',
    cafe: 'a café',
    kopitiams: 'kopitiams',
    kopitiamsCafes: 'kopitiams and cafés',
    kopitiamsBakery: 'kopitiams, cafés and a bakery',
    kopitiamsBakeries: 'kopitiams, cafés and bakeries',
    pharmaciesClinic: 'pharmacies and a clinic',
    pharmaciesClinics: 'pharmacies and clinics',
    pharmacy: 'a pharmacy',
    services: 'everyday services',
  },
  dailyHours: '{{times}} daily',
  walkStated: 'about {{min}} min walk',
  walkApprox: 'approx. {{min}} min walk',
  nextDoor: 'next door',
  kinds: {
    supermarket: 'Supermarket: the green-fronted building at the heart of the ring',
    cafeDownstairs: 'Café on the hotel’s own ground floor',
    foodCourt: 'Food court: kopitiam stalls under one roof',
    foodCourtOld: 'Food court in the supermarket’s row: kopitiam stalls',
    kopitiam: 'Kopitiam',
    cakes: 'Cakes and café meals',
    bakery: 'Bakery',
    pharmacy: 'Pharmacy',
    healthBeauty: 'Pharmacy, health and beauty',
    dental: 'Dental clinic',
    clinic: 'Community clinic',
    gp: 'Doctor’s clinic (GP)',
    hardware: 'Hardware shop',
    barber: 'Hair salon and barber',
  },
  mustTry: {
    title: 'Must-try at the kopitiams',
    dishes: {
      kampua: { name: 'Kampua mee', note: 'Sibu’s own Foochow dry noodles, tossed in shallot oil and topped with char siu (pork)' },
      kompia: { name: 'Kompia', note: 'Foochow sesame bread baked in a clay oven, plain or filled with pork' },
      redWineMeeSua: { name: 'Red wine mee sua', note: 'Chicken simmered in Foochow red rice wine, over fine mee sua noodles' },
      dimSum: { name: 'Dim sum', note: 'Steamed dumplings and buns, at their best in the morning' },
      redKoloMee: { name: 'Red kolo mee', note: 'Springy egg noodles in a red char siu sauce' },
    },
  },
};

export const en: Copy = {
  meta: {
    title: 'Salim Inn — Hotel in Farley Commercial Centre, Sibu',
    description: `Salim Inn is the hotel at the heart of Farley, Jalan Salim, Sibu: 29 air-conditioned rooms, free Wi-Fi, 24-hour reception and guest parking at the door. Book direct${SHOW_PRICES ? ` from RM${minRate} a night` : ''}.`,
  },
  brand: {
    name: 'SALIM INN',
    place: 'Farley, Sibu',
    backToStart: 'Salim Inn — back to the start',
    logoAlt: 'Salim Inn — Cozy, Clean, Affordable Comfort',
  },
  nav: {
    aria: 'Primary navigation',
    label: 'Chapters',
    play: 'Play film',
    pause: 'Pause film',
    replay: 'Replay film',
    book: 'Book direct',
    skipLink: 'Skip the film and book',
  },
  account: {
    signIn: 'Sign in',
    myAccount: 'My account',
    adminConsole: 'Admin console',
    bookAnotherStay: 'Book another stay',
  },
  lang: { aria: 'Language' },
  preloader: {
    loading: 'Loading the neighbourhood',
    warming: 'Warming up the lights',
    almost: 'Almost there',
    ready: 'Scroll to begin',
    tuning: 'Tuning the picture',
    steps: {
      'Sky and light': 'Sky and light',
      'Ground and rivers': 'Ground and rivers',
      Roads: 'Roads',
      'Farley Commercial Centre': 'Farley Commercial Centre',
      'Car parks': 'Car parks',
      Sibu: 'Sibu',
      Trees: 'Trees',
    },
  },
  chapterNav: {
    labels: ['Farley', 'Neighbourhood', 'Salim Inn', 'Arrival', 'Reception', 'Rooms', 'Footsteps', 'Book'],
    aria: 'Chapter {{id}}: {{label}}',
  },
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
      title: neighbourhoodTitle(places(), nb),
      body: 'Farley Commercial Centre wraps around the block, with the Farley supermarket at its heart.',
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
      body: 'Walking times from the hotel door. The rings are approximate: straight-line distance, allowing for the streets.',
    },
    {
      id: 8,
      eyebrow: 'Book direct',
      title: 'Book direct with Salim Inn.',
      body: SHOW_PRICES ? `From RM${minRate} a night · web rate` : 'Best when you book direct.',
    },
  ],
  bookingCard: {
    blurb: `Choose your dates and room on the Salim Inn booking portal. Check-in from ${SITE.checkIn.label}, check-out by ${SITE.checkOut.label}.`,
    book: 'Book direct',
    call: 'Call {{phone}}',
  },
  welcome: {
    eyebrow: 'WELCOME TO SALIM INN',
    title: 'Modern comfort.<br><em>Honest value.</em>',
    intro:
      'Since 2012, Salim Inn has welcomed travellers looking for a practical, comfortable stay in Sibu. Set within Farley Commercial Centre, shopping and places to eat are right outside—while a caring team is available around the clock.',
  },
  trust: {
    aria: 'Hotel highlights',
    items: [
      { strong: '24 hours', span: 'Reception and CCTV' },
      { strong: '5 minutes', span: 'Walk to Farley Supermarket' },
      { strong: 'Since 2012', span: 'Welcoming guests in Sibu' },
    ],
  },
  rooms: {
    eyebrow: 'ROOMS & WEB RATES',
    title: 'A room for every<br>kind of stay.',
    blurb: 'From a simple queen room to a family suite, each stay includes the essentials for a comfortable night.',
    items: [
      { tag: '01 · COMFORT FOR TWO', name: 'Standard Queen' },
      { tag: '02 · EXTRA SPACE', name: 'Deluxe King' },
      { tag: '03 · TWO BEDS', name: 'Superior Twin' },
      { tag: '04 · TRAVEL TOGETHER', name: 'Family Room' },
      { tag: '05 · KING + QUEEN', name: 'Family Suite' },
    ],
    perNight: '/ night',
    checkAvailability: 'Check availability',
    rateNote:
      'Promotional web rates shown by Salim Inn at the time of publication. Availability and final pricing are confirmed during booking.',
  },
  gallery: {
    eyebrow: 'A LOOK INSIDE',
    title: 'See where you’ll<br>settle in.',
    blurb: 'Official Salim Inn photographs show the real room layouts, bathrooms, and Farley surroundings before you book.',
    items: [
      { alt: 'Salim Inn Deluxe King room with bed and bedside furniture', title: 'Deluxe King', caption: 'A larger bed and practical floor plan' },
      { alt: 'Salim Inn Superior Twin room with two separate beds', title: 'Superior Twin', caption: 'Separate beds for a flexible stay' },
      { alt: 'Salim Inn family room with multiple beds', title: 'Family Room', caption: 'Space to stay together' },
      { alt: 'Salim Inn family suite with queen bed and work desk', title: 'Family Suite', caption: 'Room to spread out together' },
      { alt: 'Salim Inn guest room with window, television, work desk and air-conditioning', title: 'Inside your room', caption: 'TV, workspace and air-conditioning' },
      { alt: 'Salim Inn bathroom with fresh towels on a chrome rack above the toilet', title: 'Private bathroom', caption: 'Fresh towels, ready on arrival' },
      { alt: 'Salim Inn bathroom with pedestal sink and frosted window', title: 'Ensuite bathroom', caption: 'Bright, clean and practical' },
      { alt: 'Salim Inn bathroom with shower curtain, pedestal sink and bidet sprayer', title: 'Hot shower', caption: 'Shower, WC and bidet sprayer' },
      { alt: 'Farley Commercial Centre exterior near Salim Inn', title: 'Farley at your doorstep', caption: 'Shops and food close by' },
      { alt: 'Current street-facing facade of Salim Inn and cafe.cafe with cars parked outside', title: 'The Salim Inn frontage', caption: 'Easy to recognise from the road' },
    ],
  },
  amenities: {
    eyebrow: 'ESSENTIALS AS STANDARD',
    title: 'Everything you need.<br>Nothing you don’t.',
    blurb: 'Thoughtful basics keep your stay connected, comfortable, and secure.',
    items: [
      { title: 'Free high-speed Wi‑Fi', body: 'Stay connected throughout Salim Inn.' },
      { title: 'Air-conditioned rooms', body: 'Your own cool, comfortable space.' },
      { title: 'In-room LCD television', body: 'Relax with satellite television channels.' },
      { title: '24-hour reception', body: 'Help is available whenever you need it.' },
      { title: '24-hour CCTV', body: 'Round-the-clock on-site surveillance.' },
      { title: 'Family-friendly rooms', body: 'Flexible options for travelling together.' },
    ],
  },
  stay: {
    eyebrow: 'PLAN YOUR VISIT',
    title: 'Right at Farley.<br>Ready when you are.',
    body: `Check in from ${SITE.checkIn.label} and check out by ${SITE.checkOut.label}. Book online or contact Salim Inn directly if you need help choosing a room.`,
    cta: 'Check availability',
    labels: { address: 'Address', call: 'Call', email: 'Email' },
    address: 'Lot 21–22, Lorong Salim 17<br>96000 Sibu, Sarawak, Malaysia',
  },
  faq: {
    eyebrow: 'GOOD TO KNOW',
    title: 'Frequently<br>asked questions.',
    blurb: 'Quick answers for a smoother arrival. Contact the 24-hour reception team if you need anything else.',
    items: [
      {
        q: 'What time are check-in and check-out?',
        a: `Check-in begins at ${SITE.checkIn.label} and check-out is by ${SITE.checkOut.label}. Late checkout is subject to room availability and additional charges; a full-day rate may apply after 3:00 pm.`,
      },
      {
        q: 'How is my booking confirmed?',
        a: 'Bookings are confirmed after full payment is received. Published payment methods include credit card, PayPal, and bank transfer.',
      },
      {
        q: 'What is the cancellation policy?',
        a: `A refund may be available when cancellation notice is provided at least three days before arrival. With less notice—or for a no-show—the first night may be charged.`,
      },
      {
        q: 'Does every room have Wi‑Fi and air-conditioning?',
        a: 'Yes. Free Wi‑Fi is available throughout Salim Inn, and guest rooms include air-conditioning and a television.',
      },
      {
        q: 'Where is Salim Inn located?',
        a: 'Salim Inn is at Lot 21–22, Lorong Salim 17 in Farley Commercial Centre, Sibu. Farley Supermarket is approximately a five-minute walk away.',
      },
      {
        q: 'Can I speak to someone at any time?',
        a: `Yes. Reception operates 24 hours. Call <a href="tel:${SITE.phoneE164}">${SITE.phoneDisplay}</a> or email <a href="mailto:${SITE.email}">${SITE.email}</a>.`,
      },
    ],
  },
  cta: {
    title: 'Make Sibu feel<br>a little more like home.',
    book: 'Book your stay',
    call: 'Call Salim Inn',
  },
  footer: {
    osm: 'Map data © OpenStreetMap contributors',
    rights: `© ${new Date().getFullYear()} Salim Inn, Sibu`,
  },
  mobileCta: {
    rate: SHOW_PRICES ? 'from <strong>RM{{min}}</strong> / night' : 'Book direct',
  },
  frontDesk: {
    checkIn: `Check-in from ${SITE.checkIn.label}`,
    checkOut: `Check-out by ${SITE.checkOut.label}`,
    hours: `Front desk ${SITE.frontDeskHours}`,
  },
  neighbourhood: nb,
  configurator: {
    tabsAria: 'Room types',
    beds: 'Beds',
    size: 'Size',
    sleeps: 'Sleeps',
    extraBed: 'Extra bed',
    from: 'From',
    upTo: 'Up to {{n}}',
    extraBedYes: 'Available · RM{{charge}}',
    extraBedNo: 'Not available',
    rate: 'RM{{rate}} / night · web rate',
    bed: { single: ['{{n}} single', '{{n}} singles'], queen: ['{{n}} queen', '{{n}} queens'], king: ['{{n}} king', '{{n}} kings'] },
    bedSize: '{{bed}} ({{w}} × {{l}} cm)',
    bedJoin: ' + ',
    noWindow: 'No window: an inside room, curtained for the look of one.',
    sizeFlag: 'Size not in the PMS — modelled at 28 m²',
    photoFlag: 'No Standard Queen photo exists; shown with the generic guest-room photo.',
    seeReal: 'See the real room',
    back3d: 'Back to the 3D room',
    photoAria: 'Owner’s photo of the room',
    photo: 'Owner’s photo',
  },
  booking: {
    formLabel: 'Check availability',
    checkIn: 'Check-in',
    checkOut: 'Check-out',
    adults: 'Adults',
    children: 'Children',
    room: 'Room',
    submit: 'Book direct',
    whatsapp: 'WhatsApp',
    call: 'Call',
    payLine: 'Pay by {{methods}}',
    webRate: 'Web rate — best when you book direct.',
    summaryLabel: 'Your booking details',
    copy: 'Copy details',
    copied: 'Copied',
    selectToCopy: 'Selected — copy it',
    continue: 'Continue to booking',
    reopen: 'Open the booking portal again',
    leadDesktop: 'The booking portal opened in a new tab. It starts at its own search step — use these details there:',
    leadMobile: 'The booking portal starts at its own search step. Copy your details, then continue:',
    roomOption: '{{room}} · sleeps {{n}}',
    roomOptionRate: ' · from RM{{rate}}',
    errors: {
      checkIn: 'Choose your check-in date.',
      checkInPast: 'Check-in can’t be in the past.',
      checkOut: 'Choose your check-out date.',
      checkOutOrder: 'Check-out must be after check-in.',
      adults: 'At least one adult checks in.',
      room: 'Choose a room type.',
    },
    tooMany: 'The {{room}} fits {{base}}{{extra}}. For {{guests}}, choose the {{bigger}}.',
    tooManyExtra: ' ({{n}} with an extra bed)',
    tooManyAll: 'One room fits up to {{max}} guests. For {{guests}}, book two rooms or call us.',
    extraBedNote: 'The {{room}} fits {{base}}; add an extra bed (RM{{charge}}){{bigger}}.',
    extraBedBigger: ' or choose the {{bigger}} for {{guests}}',
    adult: ['{{n}} adult', '{{n}} adults'],
    child: ['{{n}} child', '{{n}} children'],
    night: ['{{n}} night', '{{n}} nights'],
    listSep: ', ',
    summaryStay: 'Check-in {{in}} · Check-out {{out}} ({{nights}})',
    summaryExtraBed: ' · extra bed',
    summaryRate: 'From RM{{rate}} a night · web rate',
    whatsappText: 'Hello {{hotel}}, I’d like to book:\n{{summary}}',
    cancellation: 'Free cancellation with at least 3 days’ notice. Later cancellations or no-shows are charged the first night.',
    paymentMethods: ['Cash', 'Visa', 'Mastercard', 'Debit card', 'Sarawak Pay', 'Bank transfer', 'PayPal', 'Boost', 'MAE', 'QRPay'],
    dateLocale: 'en-GB',
  },
  fallback: {
    note: 'This is the still version of the Salim Inn film. Your browser can’t show it in 3D, so every chapter is a single frame.',
    alts: [
      'Sibu from the air at dusk, the river beyond the town',
      'The Farley Commercial Centre from above, its ring of shops around the supermarket',
      'The Salim Inn corner block at dusk, the roof sign lit',
      'The Salim Inn entrance under the canopy, with guest parking in front',
      'The reception counter in the lobby: black granite in front of a colourful mural',
      'A Deluxe King guest room',
      'The hotel and the Farley ring from above, with walking-time rings from the door',
      'Salim Inn and the Farley ring at dusk',
    ],
  },
};
