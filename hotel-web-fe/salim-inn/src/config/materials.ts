// Colour palette. Brand tokens come from V16 / saliminn.my; facade and room
// colours are sampled from the reference frames and the owner's photos
// (sampling notes beside each value). Linear-space conversion happens in
// three.js (Color.setHex assumes sRGB input with ColorManagement enabled).

export const BRAND = {
  ink: 0x06110e,
  forest: 0x123a2e,
  gold: 0xd9b572,
  ivory: 0xf5efe4,
  white: 0xfffdf7,
  signalRed: 0xc8242b, // SALIM INN box sign / wall letters (rec2_t180s, t190s)
} as const;

export const FACADE = {
  // Salim Inn block — rec2_t180s / t190s
  salimCream: 0xe3d7a8, // upper wall panels (sampled mid-panel, overcast)
  salimCharcoal: 0x3e4447, // pilasters, fins, capping course
  salimCanopy: 0x2b2f33, // canopy fascia
  salimSoffit: 0x1f2326,
  windowFrame: 0xf2f1ea, // white aluminium surrounds
  glassTint: 0x2c3a40,
  stone: 0x8f8373, // stone-clad lobby wall (mixed grey/buff)
  columnWhite: 0xf1efe9,
  planter: 0xa4542f, // terracotta planters

  // Farley rows — rec2_t110s…t320s (colour-blocked facades)
  rowPalette: [0xd9cdb4, 0xcf6a4c, 0xe8e2d4, 0x9bb7a5, 0xd8b98a, 0xb8c4cc, 0xc9573e, 0xece6d8, 0x7fa27a, 0xe0c9a0],
  roofMetalLight: 0xa7adb0,
  roofMetalBlue: 0x8fa3b3,
  roofRust: 0x7a4a3a,
  roofTerracotta: 0xa14b33,

  // Farley Sibu supermarket — rec2_t040s, t070s–t090s
  martGreenDark: 0x1f7a3d,
  martGreen: 0x3fa34d,
  martGreenLight: 0x8fd16a,
  martGrey: 0xd6d8d4,
  tentWhite: 0xf4f4f0,
} as const;

export const GROUND = {
  asphalt: 0x5b5e60, // weathered, sun-bleached tropical car-park asphalt (light grey in the frames)
  asphaltWorn: 0x55585a,
  concrete: 0xa9a59c,
  paving: 0x8d857a,
  kerb: 0xc9c5bb,
  lineWhite: 0xe9e6dc,
  lineYellow: 0xe0b43c,
  grass: 0x5d7a3c,
  grassDry: 0x8a8f55,
  soil: 0x8b6f4e,
  water: 0x2f4f5a,
  urbanFar: 0x8c857a,
} as const;

// Guest rooms — sampled from the owner's photos (brief §4.5: "sample actual
// colours from the images; record the palette in src/config/materials.ts").
// Albedos estimated from median samples of lit and shaded patches:
//   walls        peach paint          lit #dfba97 / shade #b0896d → #e2b9a1
//   floor        honey laminate       #ba9e86 (sunlit) … #7a4f33  → #b27a4b
//   headboards   DLX black tufted #232625 · SUP brown #2c241d (gold piping)
//                FR black, white stripes · FS olive channel #9a8a5c
//   bed bases    rust valance #8a3f22 (DLX, FR) · quilted divan #b8b09b (SUP, FS)
//   curtains     navy #25406b (DLX, SUP, FR, guest room) · sage #6c8e79 (FS)
//   furniture    pale pink-beige wood laminate #d9bca8
//   bathroom     wall tile #d8d4cc (30×60) · floor tile #5a4b40 (40×40)
export const ROOM_COLOURS = {
  wall: 0xe3c1ab,
  wallGuest: 0xe6d6c6, // the lighter cream-peach of guest-room.jpg
  ceiling: 0xf3f1ec,
  skirting: 0x5a3a26,
  floor: 0xa06a42,
  sheet: 0xf6f5f1,
  pillow: 0xfbfaf6,
  headDLX: 0x232625,
  headSUP: 0x2c241d,
  headFRKing: 0x1c1d1d,
  headFRSingle: 0x353134,
  headFS: 0x9a8a5c,
  skirt: 0x6b3d27, // darker and browner than a lit sample: the render lights it more evenly
  divan: 0xb8b09b,
  navy: 0x2b4467,
  sage: 0x6c8e79,
  laminate: 0xd9bca8,
  gold: 0xc39a3a,
  acCream: 0xe7e1c7,
  phone: 0xd9cfae,
  chairGreen: 0x6fbf1c,
  tileWall: 0xd8d4cc,
  tileFloor: 0x5a4b40,
  showerBlue: 0x0a64a0,
  showerWhite: 0xf1efe9,
  frosted: 0x9fd9cf,
} as const;

// Lobby, counter, stair and corridor — designed, not sampled: no reception,
// stair or corridor photo exists (OPEN_QUESTIONS in config/site.ts).
export const PUBLIC_COLOURS = {
  tile: 0xe6ddcc, // polished porcelain, warm ivory, 800 mm
  grout: 0xb4a894,
  walnut: 0x6b4d37, // a mid walnut: darker read murky under warm light and the grade
  marble: 0xefe9df,
  plaster: 0xe9e2d7,
  corridorWall: 0xe8dfd1,
  carpetField: 0x1f3e32, // brand forest, lifted so the pattern reads
  carpetMotif: 0x2d5747,
  carpetGold: 0xb59655,
  door: 0x6a4d38,
  frame: 0x3f2a1c,
  terrazzo: 0xd8d2c6,
} as const;
