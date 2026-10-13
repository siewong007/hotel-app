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
import { BACK_DOORS, DOOR_W, FRONT_DOORS, PASSAGE_X, SHOWCASE_NUMBER, landingPlates, roomRanges } from './interiors/Corridor';
import { PLAN } from './world/SalimInnBuilding';
import { DIM, FLOOR_Y } from './config/dimensions';
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

  it('keeps the back doors off the passage from the stair', () => {
    const { passage } = PLAN.stair;
    for (const [x, n] of BACK_DOORS) {
      const clear = x + DOOR_W / 2 < passage.x0 - 0.2 || x - DOOR_W / 2 > passage.x1 + 0.2;
      expect(clear, `door ${n}`).toBe(true);
    }
  });
});

describe('reception and stair (the owner’s photos, 2 Oct 2026, walk-through video, 12 Oct 2026, and placement, 13 Oct 2026)', () => {
  it('sets the reception in the right-hand wall beside the entrance, its counter facing across the lobby', () => {
    const { lobby, door, reception: r, counter: c } = PLAN;
    // coming in (facing −z) it is on the right: against the right-hand wall …
    expect(r.x1).toBe(lobby.x1);
    expect(r.x0).toBeGreaterThan(door.x1); // … clear of the entrance's width …
    // … and at the front, a pillar's width behind the frontage
    expect(r.z0).toBeLessThan(lobby.z1);
    expect(lobby.z1 - r.z0).toBeLessThan(0.5);
    expect(r.z1).toBeGreaterThan(lobby.z0);
    // across the alcove's mouth, its guest face towards −x (the counter's
    // local +z, turned by rotY)
    expect(c.length).toBeCloseTo(r.z0 - r.z1, 9);
    expect(c.z).toBeCloseTo((r.z0 + r.z1) / 2, 9);
    expect(c.x - c.depth / 2).toBeCloseTo(r.x0, 9);
    expect(Math.sin(c.rotY)).toBeCloseTo(-1, 9);
  });

  it('puts the stair door in the left-hand wall, across the lobby and behind the reception, up four steps', () => {
    const { lobby, reception: r, stair, floor, lobbyCeiling } = PLAN;
    const d = stair.door, e = stair.entry;
    expect(d.z0).toBeLessThan(r.z1); // further in than the counter …
    expect(d.z1).toBeGreaterThan(lobby.z0); // … short of the back wall …
    expect(d.z0 - d.z1).toBeGreaterThanOrEqual(0.85);
    expect(d.h).toBeGreaterThanOrEqual(2.0);
    // … at the top of four steps that stand in the lobby, wider than it …
    expect(e.risers).toBe(4);
    expect(e.z0).toBeGreaterThan(d.z0);
    expect(e.z1).toBeLessThan(d.z1);
    expect(e.risers * e.run).toBeLessThan(1.3);
    // … with its head, casing and all, under the lobby's ceiling …
    expect(e.risers * stair.rise + d.h + 0.06).toBeLessThan(lobbyCeiling);
    expect(floor + e.risers * stair.rise + d.h).toBeLessThan(FLOOR_Y.level1 - 0.25);
    // … onto a landing that spans it, in front of the flight
    expect(d.z0).toBeLessThanOrEqual(stair.well.z0);
    expect(d.z1).toBeGreaterThanOrEqual(stair.flight.z0);
  });

  it('climbs from the lobby floor to level 1 in equal, comfortable risers', () => {
    const { stair, lobby, corridor, floor } = PLAN;
    const risers = stair.entry.risers + stair.flight.risers;
    expect(risers * stair.rise).toBeCloseTo(FLOOR_Y.level1 - floor, 9);
    expect(stair.rise).toBeGreaterThan(0.15);
    expect(stair.rise).toBeLessThan(0.18);
    for (const run of [stair.entry.run, stair.flight.run]) expect(2 * stair.rise + run).toBeGreaterThan(0.55); // the 2R + G rule
    // the landing behind the door is the flight's width and more …
    expect(lobby.x0 - 0.2 - stair.well.x0).toBeGreaterThanOrEqual(stair.well.x1 - stair.well.x0);
    // … the long flight climbs away from the corridor, leaving 2 m of
    // headroom under the level-1 slab's edge behind the corridor's back wall …
    const edge = corridor.z0 - 0.25;
    const under = floor + (stair.entry.risers + Math.floor((stair.flight.z0 - edge) / stair.flight.run) + 1) * stair.rise;
    expect(FLOOR_Y.level1 - 0.25 - under).toBeGreaterThanOrEqual(2.0);
    // … and ends on the level-1 landing, inside the block …
    const topRiser = stair.flight.z0 - (stair.flight.risers - 1) * stair.flight.run;
    expect(stair.top.z1).toBeLessThan(topRiser - 1.2);
    expect(stair.top.z1).toBeGreaterThan(-DIM.salim.depth + 0.2);
    expect(stair.well.x0).toBeGreaterThan(0.2);
    // … whose door, in its right-hand wall, opens on a passage that runs
    // back beside the well, past its wall, to the corridor
    const td = stair.top.door;
    expect(td.z0).toBeLessThan(topRiser);
    expect(td.z1).toBeGreaterThan(stair.top.z1);
    expect(td.z0 - td.z1).toBeGreaterThanOrEqual(0.85);
    expect(stair.passage.x0).toBeGreaterThanOrEqual(stair.well.x1 + 0.2 - 1e-9); // its wall is 0.2 m thick
    expect(stair.passage.x1 - stair.passage.x0).toBeGreaterThanOrEqual(1.0);
    expect(topRiser).toBeLessThan(corridor.z0);
  });

  it('leaves a door height between the raised five-foot way and the entrance head', () => {
    expect(PLAN.door.h - PLAN.floor).toBeGreaterThanOrEqual(2.05);
    expect(PLAN.floor + PLAN.lobbyCeiling).toBeLessThan(FLOOR_Y.level1 - 0.25); // under the level-1 slab
  });
});

describe('level-1 landing plates', () => {
  it('writes room ranges the way the hotel’s plates do', () => {
    expect(roomRanges([106, 101, 102, 103, 104])).toBe('101–104, 106');
    expect(roomRanges([113])).toBe('113');
  });

  it('lists every door once, on the hand it lies to coming out of the passage', () => {
    const expand = (t: string) => t.split(', ').flatMap((r) => {
      const [a, b = a] = r.split('–').map(Number);
      return Array.from({ length: b - a + 1 }, (_, i) => a + i);
    });
    const { left, right } = landingPlates();
    const midX = PASSAGE_X;
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
