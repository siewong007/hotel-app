// The five room types as layouts of the one configurator room (level 1,
// above the lobby; brief §3 ch. 6, §4.5). Room-local metres:
//   x: −w (left wall) … 0 (the fixed right-hand wall on the pier between the
//      bay's two window groups); y up from the level-1 floor;
//   z: Z_FACADE (inner face of the facade, the window wall) … Z_CORRIDOR.
// Footprints come from hotel.json sizes at the fixed front-room depth. Every
// arrangement is read off the owner's photo for that type: which wall the
// headboards sit on, the order of beds and tables from the window side,
// where the wardrobe, desk and TV stand, the curtain colour and how far it
// is drawn. The window is the building's own (the bay's first window group),
// so it stays put while the walls and furniture reconfigure around it.
import hotel from '../data/hotel.json';
import { PLAN, SHOWCASE_WINDOW } from '../world/SalimInnBuilding';
import { ROOM_DISPLAY, type RoomCode } from '../config/site';
import type { BedSize, BedStyle } from './roomProps';

export const Z_FACADE = -0.2;
export const Z_CORRIDOR = -PLAN.frontRoomDepth;
export const ROOM_DEPTH = Z_FACADE - Z_CORRIDOR;
export const ROOM_HEIGHT = 2.95; // recessed ceiling; the bulkhead ring drops to 2.8
/** The building's window, room-local. */
export const WINDOW = { x0: SHOWCASE_WINDOW.x0 - PLAN.showcaseRight, x1: SHOWCASE_WINDOW.x1 - PLAN.showcaseRight, sill: PLAN.windowSill, head: PLAN.windowHead };
/** The entry door in the corridor wall, room-local. */
export const DOOR = { x0: PLAN.showcaseDoor.x0 - PLAN.showcaseRight, x1: PLAN.showcaseDoor.x1 - PLAN.showcaseRight, h: 2.05 };
export const BATH = { w: 2.0, d: 2.3 }; // ≈ 4.6 m² ensuite at the corridor end of the left wall
const PI = Math.PI;

export type ItemKind = 'bed' | 'nightstand' | 'wardrobe' | 'desk' | 'mirror' | 'chair' | 'tv' | 'ac' | 'luggage' | 'art';
export interface ItemPose { x: number; y: number; z: number; rotY: number }
export interface LayoutItem extends ItemPose {
  slot: string; // stable across types (bed1, desk…) — glides between types
  kind: ItemKind;
  variant: string; // what it is (bed size + style, art kind); a change swaps it
  bed?: { size: BedSize; style: BedStyle };
  art?: 'banana' | 'wheat';
}

export interface RoomLayout {
  code: RoomCode;
  name: string;
  sizeSqm: number;
  sizeFlag?: string;
  width: number;
  window: boolean;
  curtain: 'navy' | 'sage';
  curtainOpen: number;
  /** Curtain rail from this x (room-local) to the right-hand end: in the
   *  Deluxe King and Superior Twin photos the curtains run right up to the
   *  hanging unit in the corner. */
  railFrom: number;
  shower: 'blue' | 'white';
  beds: BedSize[];
  maxGuests: number;
  extraBed: boolean;
  extraBedCharge: number;
  photo?: string;
  photoFlag?: string;
  items: LayoutItem[];
}

const bed = (slot: string, size: BedSize, style: BedStyle, p: ItemPose): LayoutItem => ({ slot, kind: 'bed', variant: `${size}-${style.head}-${style.base}`, bed: { size, style }, ...p });
const item = (slot: string, kind: ItemKind, p: ItemPose, variant: string = kind): LayoutItem => ({ slot, kind, variant, ...p });
const L = (w: number, z: number, y = 0): ItemPose => ({ x: -w, y, z, rotY: 0 }); // on the left wall, facing +x
const R = (z: number, y = 0): ItemPose => ({ x: 0, y, z, rotY: PI }); // on the right wall, facing −x

function arrangement(code: RoomCode, w: number): LayoutItem[] {
  switch (code) {
    // deluxe-king.jpg: headboard on the far (left) wall, curtains on the
    // window wall to its left, the hanging unit in that corner, bedside
    // table and telephone on the corridor side, gold banana-leaf art above.
    case 'DLX':
      return [
        item('wardrobe', 'wardrobe', L(w, -0.8)),
        bed('bed1', 'king', { head: 'tufted', base: 'skirt' }, L(w, -2.53)),
        item('nightstand1', 'nightstand', L(w, -3.87)),
        { ...item('art', 'art', L(w, -2.5, 2.19), 'art-banana'), art: 'banana' },
        item('desk', 'desk', R(-0.95)),
        item('mirror', 'mirror', R(-0.95, 1.45)),
        item('chair', 'chair', { x: -0.82, y: 0, z: -0.95, rotY: 0 }),
        item('tv', 'tv', R(-2.3, 1.35)),
        item('ac', 'ac', R(-3.8, 2.3)),
        item('luggage', 'luggage', R(-5.2)),
      ];
    // superior-twin.jpg: the same wall arrangement with two singles either
    // side of a small table, gold wheat-spray art above the table.
    case 'SUP':
      return [
        item('wardrobe', 'wardrobe', L(w, -0.8)),
        bed('bed1', 'single', { head: 'goldPiping', base: 'divan' }, L(w, -1.65)),
        item('nightstand1', 'nightstand', L(w, -2.31), 'nightstand-narrow'), // centred in the 31 cm between the sheets
        bed('bed2', 'single', { head: 'goldPiping', base: 'divan' }, L(w, -2.97)),
        { ...item('art', 'art', L(w, -2.23, 2.02), 'art-wheat'), art: 'wheat' },
        item('desk', 'desk', R(-0.95)),
        item('mirror', 'mirror', R(-0.95, 1.45)),
        item('chair', 'chair', { x: -0.82, y: 0, z: -0.95, rotY: 0 }),
        item('tv', 'tv', R(-2.55, 1.35)),
        item('ac', 'ac', R(-4.0, 2.3)),
        item('luggage', 'luggage', R(-5.0)),
      ];
    // family-room.jpg: headboards on the right-hand wall, the single by the
    // window (curtains open), the king beside it, the table and telephone
    // beyond; desk, TV and AC on the opposite wall.
    case 'FR':
      return [
        bed('bed2', 'single', { head: 'thinStripes', base: 'skirt' }, R(-1.23)),
        bed('bed1', 'king', { head: 'whiteStripes', base: 'skirt' }, R(-2.96)),
        item('nightstand1', 'nightstand', R(-4.2)),
        item('desk', 'desk', L(w, -1.0)),
        item('mirror', 'mirror', L(w, -1.0, 1.45)),
        item('chair', 'chair', { x: -w + 0.82, y: 0, z: -1.0, rotY: PI }),
        item('tv', 'tv', L(w, -2.4, 1.35)),
        item('ac', 'ac', L(w, -3.9, 2.3)),
        item('wardrobe', 'wardrobe', R(-4.75)),
        item('luggage', 'luggage', L(w, -4.6)),
      ];
    // family-suite.jpg: olive channel headboard on the right-hand wall, the
    // desk with mirror, kettle tray and green chair between the bed and the
    // curtained wall — sage curtains, and no window behind them.
    case 'FS':
      return [
        item('desk', 'desk', R(-1.1)),
        item('mirror', 'mirror', R(-0.47, 1.45)),
        item('chair', 'chair', { x: -0.82, y: 0, z: -1.1, rotY: 0 }),
        bed('bed1', 'king', { head: 'channel', base: 'divan' }, R(-2.6)),
        item('nightstand1', 'nightstand', R(-3.95)),
        bed('bed2', 'queen', { head: 'channel', base: 'divan' }, R(-5.04)),
        item('tv', 'tv', L(w, -3.0, 1.35)),
        item('ac', 'ac', L(w, -1.5, 2.3)),
        item('wardrobe', 'wardrobe', L(w, -4.6)),
      ];
    // No Standard Queen photo exists: guest-room.jpg is the generic room —
    // window wall with navy curtains, TV and AC on the side wall, desk and
    // mirror in the corner by the window, the green chair. Flagged.
    case 'STDQ':
    default:
      return [
        bed('bed1', 'queen', { head: 'tufted', base: 'skirt' }, L(w, -3.0)),
        item('nightstand1', 'nightstand', L(w, -1.9)),
        item('desk', 'desk', R(-0.8)),
        item('mirror', 'mirror', R(-0.8, 1.45)),
        item('chair', 'chair', { x: -0.82, y: 0, z: -0.8, rotY: 0 }),
        item('ac', 'ac', R(-1.9, 2.3)),
        item('tv', 'tv', R(-2.4, 1.35)),
        item('wardrobe', 'wardrobe', R(-4.6)),
      ];
  }
}

const SHOWER: Record<RoomCode, 'blue' | 'white'> = { STDQ: 'white', DLX: 'blue', SUP: 'white', FR: 'blue', FS: 'white' };
const CURTAIN_OPEN: Record<RoomCode, number> = { STDQ: 0.78, DLX: 0.18, SUP: 0.08, FR: 0.85, FS: 0 };

export function roomLayouts(): Record<RoomCode, RoomLayout> {
  const out = {} as Record<RoomCode, RoomLayout>;
  for (const t of hotel.room_types) {
    const code = t.code as RoomCode;
    const disp = ROOM_DISPLAY[code];
    const size = t.size_sqm ?? disp.sizeSqm;
    const width = size / ROOM_DEPTH;
    const window = !t.name.toLowerCase().includes('no window');
    const items = arrangement(code, width);
    out[code] = {
      code,
      name: disp.name,
      sizeSqm: size,
      sizeFlag: disp.sizeFlag,
      width,
      window,
      curtain: code === 'FS' ? 'sage' : 'navy',
      curtainOpen: window ? CURTAIN_OPEN[code] : 0,
      railFrom: code === 'DLX' || code === 'SUP' ? -width + 0.62 : WINDOW.x0 - 0.45,
      shower: SHOWER[code],
      beds: items.filter((i) => i.kind === 'bed').map((i) => i.bed!.size),
      maxGuests: t.max_occupancy,
      extraBed: t.allows_extra_bed,
      extraBedCharge: t.extra_bed_charge,
      photo: disp.photo,
      photoFlag: disp.photoFlag,
      items,
    };
  }
  return out;
}

/** Display order of the configurator tabs (smallest to largest). */
export const ROOM_ORDER: RoomCode[] = ['STDQ', 'DLX', 'SUP', 'FR', 'FS'];
