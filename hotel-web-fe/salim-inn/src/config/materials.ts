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
