// Interiors (milestone 3): the configurator's five room layouts, the
// photo-matched views, the level-1 corridor numbering and the front-desk
// facts. Geometry and materials are judged from screenshots, and the ?debug=1
// clip check walks the camera through every room type; these tests pin the
// plan-level rules that both rely on.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import hotel from './data/hotel.json';
import { BATH, DOOR, ROOM_DEPTH, ROOM_HEIGHT, ROOM_ORDER, Z_CORRIDOR, Z_FACADE, roomLayouts, type LayoutItem } from './interiors/roomLayouts';
import { floorFootprint } from './interiors/roomProps';
import { ROOM_VIEWS } from './interiors/roomViews';
import { BACK_DOORS, DOOR_W, FRONT_DOORS, SHOWCASE_NUMBER, landingPlates, roomRanges } from './interiors/Corridor';
import { PLAN } from './world/SalimInnBuilding';
import { FLOOR_Y } from './config/dimensions';
import { FRONT_DESK_FACTS, SITE } from './config/site';
import { en } from './content/en';
import { PATH } from './experience/cameraPath';
import { salimFrame } from './world/layout';

interface Rect { x0: number; x1: number; z0: number; z1: number; name: string }

const layouts = roomLayouts();

/** Room-local plan rectangle of a floor-standing piece (null if wall-mounted). */
function rectOf(li: LayoutItem): Rect | null {
  const f = floorFootprint(li.kind, li.variant, li.bed?.size);
  if (!f) return null;
  if (f.centred) return { x0: li.x - f.depth / 2, x1: li.x + f.depth / 2, z0: li.z - f.width / 2, z1: li.z + f.width / 2, name: li.slot };
  const dir = Math.cos(li.rotY) > 0 ? 1 : -1; // off the left wall facing +x, off the right facing −x
  const xb = li.x + dir * f.depth;
  return { x0: Math.min(li.x, xb), x1: Math.max(li.x, xb), z0: li.z - f.width / 2, z1: li.z + f.width / 2, name: li.slot };
}
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 - 1e-3 && b.x0 < a.x1 - 1e-3 && a.z0 < b.z1 - 1e-3 && b.z0 < a.z1 - 1e-3;
const contains = (r: Rect, x: number, z: number) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
/** The ensuite in the left-hand corner at the corridor end, walls included. */
const bathOf = (w: number): Rect => ({ x0: -w, x1: -w + BATH.w + 0.1, z0: Z_CORRIDOR, z1: Z_CORRIDOR + BATH.d + 0.1, name: 'ensuite' });
const rectDistance = (r: Rect, x: number, z: number) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));

describe('room layouts (brief §4.5)', () => {
  it('builds all five types from hotel.json, smallest first', () => {
    expect(ROOM_ORDER).toEqual(['STDQ', 'DLX', 'SUP', 'FR', 'FS']);
    for (const t of hotel.room_types) {
      const l = layouts[t.code as keyof typeof layouts];
      expect(l.width).toBeCloseTo(l.sizeSqm / ROOM_DEPTH, 9);
      expect(l.maxGuests).toBe(t.max_occupancy);
      expect(l.extraBed).toBe(t.allows_extra_bed);
      // only the Family Suite is listed without a window
      expect(l.window).toBe(t.code !== 'FS');
    }
  });

  it('lays out the beds each description lists', () => {
    for (const t of hotel.room_types) {
      const want: string[] = [];
      for (const m of t.description.matchAll(/(\d+)\s*(king|queen|single)/gi)) for (let i = 0; i < Number(m[1]); i++) want.push(m[2].toLowerCase());
      const got = [...layouts[t.code as keyof typeof layouts].beds];
      expect(got.sort(), t.code).toEqual(want.sort());
    }
  });

  it('keeps every floor piece inside the room and clear of the ensuite, each other and the door', () => {
    const hinge = { x: DOOR.x1 - 0.02, z: Z_CORRIDOR - 0.1 };
    const leaf = DOOR.x1 - DOOR.x0 - 0.04;
    for (const code of ROOM_ORDER) {
      const l = layouts[code];
      const rects = l.items.map(rectOf).filter((r): r is Rect => r !== null);
      const bath = bathOf(l.width);
      for (const r of rects) {
        expect(r.x0, `${code} ${r.name}`).toBeGreaterThanOrEqual(-l.width - 1e-6);
        expect(r.x1, `${code} ${r.name}`).toBeLessThanOrEqual(1e-6);
        expect(r.z0, `${code} ${r.name}`).toBeGreaterThanOrEqual(Z_CORRIDOR);
        expect(r.z1, `${code} ${r.name}`).toBeLessThanOrEqual(Z_FACADE);
        expect(overlaps(r, bath), `${code} ${r.name} in the ensuite`).toBe(false);
        // the entry door swings 94° into the room from its hinge
        for (let a = 0; a <= 0.52 * Math.PI; a += Math.PI / 90) {
          for (let t = 0.05; t <= 1; t += 0.05) {
            expect(contains(r, hinge.x - Math.cos(a) * leaf * t, hinge.z + Math.sin(a) * leaf * t), `${code} ${r.name} in the door's swing`).toBe(false);
          }
        }
      }
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        expect(overlaps(rects[i], rects[j]), `${code}: ${rects[i].name} × ${rects[j].name}`).toBe(false);
      }
    }
  });
});

describe('photo-matched views', () => {
  it('stands each camera inside its room, clear of the ensuite — except the Family Room, shot from the corridor', () => {
    for (const code of ROOM_ORDER) {
      const [x, y, z] = ROOM_VIEWS[code].pos;
      const w = layouts[code].width;
      expect(y).toBeGreaterThan(0.5);
      expect(y).toBeLessThan(ROOM_HEIGHT);
      if (code === 'FR') {
        // family-room.jpg was taken from beyond the modelled room: the view
        // relies on the cutaway, and stands in the level-1 corridor
        expect(z).toBeLessThan(Z_CORRIDOR);
        expect(z).toBeGreaterThan(PLAN.corridor.z0);
        continue;
      }
      expect(x, code).toBeGreaterThan(-w);
      expect(x, code).toBeLessThan(0);
      expect(z, code).toBeGreaterThan(Z_CORRIDOR);
      expect(z, code).toBeLessThan(Z_FACADE);
      expect(contains(bathOf(w), x, z), `${code} view in the ensuite`).toBe(false);
    }
  });

  it('walks into every room at least 0.3 m clear of its ensuite (chapter 6)', () => {
    const ch6 = PATH.find((c) => c.id === 6)!;
    const end = salimFrame.worldToLocal(ch6.points[ch6.points.length - 1].pos.clone()).sub(new THREE.Vector3(PLAN.showcaseRight, FLOOR_Y.level1, 0));
    for (const code of ROOM_ORDER) {
      expect(rectDistance(bathOf(layouts[code].width), end.x, end.z), code).toBeGreaterThanOrEqual(0.3);
    }
  });
});

describe('level-1 corridor (brief §4.5)', () => {
  it('numbers the doors 101–114 once each: odd on the facade side, even behind', () => {
    const all = [...FRONT_DOORS, ...BACK_DOORS].map(([, n]) => n).sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: 14 }, (_, i) => 101 + i));
    for (const [, n] of FRONT_DOORS) expect(n % 2).toBe(1);
    for (const [, n] of BACK_DOORS) expect(n % 2).toBe(0);
  });

  it("puts the configurator room's number on its door and keeps the other doors clear of its widest footprint", () => {
    const widest = Math.max(...ROOM_ORDER.map((c) => layouts[c].width));
    for (const [x, n] of FRONT_DOORS) {
      if (n === SHOWCASE_NUMBER) {
        expect(x).toBeCloseTo((PLAN.showcaseDoor.x0 + PLAN.showcaseDoor.x1) / 2, 9);
        continue;
      }
      const clear = x + DOOR_W / 2 < PLAN.showcaseRight - widest || x - DOOR_W / 2 > PLAN.showcaseRight;
      expect(clear, `door ${n}`).toBe(true);
    }
  });

  it('keeps the back doors off the opening onto the stair landing', () => {
    for (const [x, n] of BACK_DOORS) {
      const clear = x + DOOR_W / 2 < PLAN.stair.x0 - 0.2 || x - DOOR_W / 2 > PLAN.stair.x1 + 0.2;
      expect(clear, `door ${n}`).toBe(true);
    }
  });
});

describe('reception and stair (the owner’s photos, 2 Oct 2026)', () => {
  it('sets the reception against the frontage beside the entrance, its counter facing into the lobby', () => {
    const { lobby, door, reception: r, counter: c } = PLAN;
    expect(r.z0).toBe(lobby.z1); // the frontage's inner face
    expect(r.x0).toBeGreaterThan(door.x1); // beside the entrance, not across it
    expect(r.x0).toBeGreaterThanOrEqual(lobby.x0);
    expect(r.x1).toBeLessThanOrEqual(lobby.x1);
    // across the alcove's mouth, its guest face towards −z
    expect(c.length).toBeCloseTo(r.x1 - r.x0, 9);
    expect(c.x).toBeCloseTo((r.x0 + r.x1) / 2, 9);
    expect(c.z - c.depth / 2).toBeCloseTo(r.z1, 9);
    expect(Math.cos(c.rotY)).toBeCloseTo(-1, 9);
  });

  it('puts the stair opposite the counter, across the lobby', () => {
    const { lobby, reception: r, stair: s } = PLAN;
    expect(s.z1).toBe(lobby.z0); // it opens off the lobby's back wall …
    const overlap = Math.min(r.x1, s.x1) - Math.max(r.x0, s.x0);
    expect(overlap / (r.x1 - r.x0)).toBeGreaterThan(0.9); // … facing the counter
  });
});

describe('level-1 landing plates', () => {
  it('writes room ranges the way the hotel’s plates do', () => {
    expect(roomRanges([106, 101, 102, 103, 104])).toBe('101–104, 106');
    expect(roomRanges([113])).toBe('113');
  });

  it('lists every door once, on the hand it lies to from the top of the stair', () => {
    const expand = (t: string) => t.split(', ').flatMap((r) => {
      const [a, b = a] = r.split('–').map(Number);
      return Array.from({ length: b - a + 1 }, (_, i) => a + i);
    });
    const { left, right } = landingPlates();
    const midX = (PLAN.stair.x0 + PLAN.stair.x1) / 2;
    const xOf = new Map([...FRONT_DOORS, ...BACK_DOORS].map(([x, n]) => [n, x]));
    expect([...expand(left), ...expand(right)].sort((a, b) => a - b)).toEqual(Array.from({ length: 14 }, (_, i) => 101 + i));
    for (const n of expand(left)) expect(xOf.get(n)!, `${n}`).toBeGreaterThan(midX);
    for (const n of expand(right)) expect(xOf.get(n)!, `${n}`).toBeLessThan(midX);
  });
});

describe('front desk (brief §3 ch. 5)', () => {
  it('prints the same live facts on the registration card and in the copy', () => {
    expect(FRONT_DESK_FACTS).toEqual([`Check-in from ${SITE.checkIn.label}`, `Check-out by ${SITE.checkOut.label}`, `Front desk ${SITE.frontDeskHours}`]);
    expect(en.chapters.find((c) => c.id === 5)!.body).toBe(FRONT_DESK_FACTS.join(' · '));
    expect([en.frontDesk.checkIn, en.frontDesk.checkOut, en.frontDesk.hours]).toEqual(FRONT_DESK_FACTS);
  });
});
