// Site plan traced from a Google Earth top-down capture of the Farley
// Commercial Centre, Lorong Salim 17, Sibu (2°15'59"N 111°51'47"E).
//
// SCALE: the capture's own scale bar measured 320.5 px for 40 m, so
// 1 aerial pixel = 0.12481 m. Every figure below is metres.
//
// ORIGIN: the Salim Inn map pin. +x is east, +z is south — the same handedness
// as the aerial, so image coordinates convert straight across and three.js
// consumes them as (x, z) with y up.
//
// This replaces a trace of a Google *road map* at a different zoom, which put
// the neighbouring blocks in roughly the right relationship to each other but
// in the wrong place relative to the two buildings that matter.

// ---------------------------------------------------------------------------
// The Salim Inn row
//
// The row is not straight. It runs as three segments, bending twice: gently at
// the Hometown Pharmacy end, then sharply inward immediately past Salim Inn,
// which is what closes the north side of the block.
export const SALIM_FRONT = [
  [-78.0, -32.0], // NW end, past Polly Shop
  [-31.7, -23.0], // first kink — bearing turns 10.6° → 36.4°
  [14.0, 10.7],   // second kink — bearing turns 36.4° → 79.0°, 17.6 m past the hotel
  [17.6, 29.2],   // SE end, past Wedrink
];

export const SALIM_DEPTH = 26; // frontage to rear wall

// Distance along SALIM_FRONT from its NW end, measured by projecting each map
// pin onto the polyline. Walking the frontage from the car park with the
// building on your left, distance *decreases* to your right — so Cafe Cafe at
// 69.5 m sits to the right of Salim Inn at 86.3 m, and the inward bend at
// 104 m falls just to its left.
export const SALIM_TENANTS = [
  { at: 16.8, w: 12, name: 'Polly Shop', kind: 'shop' },
  { at: 27.1, w: 13, name: 'Hometown Pharmacy', kind: 'shop' },
  { at: 54.3, w: 12, name: 'Secret Recipe', kind: 'shop' },
  { at: 63.4, w: 10, name: 'Western', kind: 'shop' },
  { at: 69.5, w: 13, name: 'cafe.cafe', kind: 'cafe' },
  { at: 86.3, w: 15, name: 'Salim Inn', kind: 'hotel' },
  { at: 108.8, w: 11, name: 'Wedrink', kind: 'shop' },
];

export const SALIM_AT = 86.3; // the hotel's own offset along the frontage

// ---------------------------------------------------------------------------
// Farley Sibu
//
// The anchor supermarket sits on the far side of the complex, its glazed fin
// frontage facing WNW across its own car park — away from Salim Inn, which is
// why arriving guests walk around the block rather than straight across.
export const FARLEY_FRONT = [
  [-153.3, 79.6],
  [-122.3, 44.4],
];
export const FARLEY_DOOR = [-142.4, 67.2]; // 157 m from Salim Inn
export const FARLEY_CENTRE = [-118, 78];
export const FARLEY_W = 64; // along the frontage
export const FARLEY_D = 54; // inward
export const FARLEY_H = 14.5;

// ---------------------------------------------------------------------------
// Neighbouring rows, each a frontage line with its tenants. Positions are the
// map pins; the rows are built as continuous terraces through them the way the
// aerial shows, not as free-standing blocks.
export const ROWS = [
  {
    id: 'west',
    front: [[-149.0, 60.0], [-96.0, 40.0]],
    depth: 30,
    tenants: ['Lingerie shop', 'Farley Sibu', 'Bata Salim', 'ALPRO Pharmacy'],
  },
  {
    id: 'inner',
    front: [[-70.0, 38.0], [-28.0, 74.0]],
    depth: 24,
    tenants: ['Borneo Fresh Pork', 'Hong Lee Cafe', 'Gakken Classroom', 'Jamu Sinasuria'],
  },
  {
    id: 'southeast',
    front: [[-20.0, 82.0], [-8.0, 108.0]],
    depth: 26,
    tenants: ['Tichop Auto', 'Farley Food Court'],
  },
  {
    id: 'south',
    front: [[-112.0, 138.0], [-34.0, 124.0]],
    depth: 28,
    tenants: ['Farley Shoe Centre', 'Farley Bakery', 'Watsons Salim'],
  },
  {
    id: 'northwest',
    front: [[-96.0, 4.0], [-60.0, -14.0]],
    depth: 24,
    tenants: ['CCK Fresh Mart', 'Hairdresser'],
  },
];

// ---------------------------------------------------------------------------
// Surfaced parking, as rectangles: centre, size along/across, and bearing of
// the bay rows in radians. Read off the painted bays in the aerial.
export const PARKING = [
  // Nose-in bays hard against the Salim Inn frontage — where guests actually
  // stop. Runs along frontage segment B.
  { centre: [-14, -12], along: 62, across: 12, rot: Math.atan2(33.7, 45.7), rows: 1 },
  // The same strip continuing along the gentler segment A.
  { centre: [-60, -32], along: 44, across: 12, rot: Math.atan2(9.0, 46.3), rows: 1 },
  // Farley's main car park, squarely on the outward normal of its frontage.
  { centre: [-168, 45], along: 54, across: 40, rot: Math.atan2(-35.2, 31.0), rows: 4 },
  // Overflow between the west row and the ring road.
  { centre: [-150, 116], along: 46, across: 26, rot: Math.atan2(-14, 78), rows: 2 },
];

// White peaked marquees, standing between Farley's doors and the bays — 16 m
// out on the frontage normal, spread along the frontage.
export const TENTS = [[-167.5, 71.6], [-158.9, 61.9], [-149.7, 51.4], [-141.1, 41.6]];

// ---------------------------------------------------------------------------
// The internal route a guest actually walks: out of Farley heading WNW into
// the car park, north up the western edge, round past CCK and Hometown
// Pharmacy, then east along the frontage to the hotel entrance. Stage 01 opens
// on this, rather than on a flyover.
export const ROUTE = [
  [-142.4, 67.2],  // Farley front door
  [-158.0, 53.0],  // out under the canopy into the car park
  [-156.0, 30.0],  // turn north
  [-140.0, 6.0],
  [-116.0, -14.0], // up the western edge
  [-88.0, -30.0],  // past CCK Fresh Mart
  [-56.0, -38.0],  // along the Hometown Pharmacy frontage
  [-24.0, -30.0],  // round the first kink
  [3.0, -12.0],    // onto the Salim Inn frontage
];

// Standing point in front of the hotel entrance, on the outward normal of
// frontage segment B.
export const SALIM_APPROACH = [10.7, -14.5];
