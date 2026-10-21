// Salim Inn block — hero fidelity (brief §4.3), built in the block's local
// frame (layout.salimFrame): x along the facade from the corner end (0) to the
// south end (18.9), z out to the car park, y up. Every dimension below is
// camera-matched to rec2_t190s (see config/dimensions.ts) and checked against
// rec2_t180s:
//   · upper floors: two white 4-pane sliding windows per bay per floor
//     (2.72 m + 2.15 m, 10 cm reveals), white head/sill bands, cream render,
//     charcoal pilasters on the bay lines and fins wrapping both ends, a thin
//     cream band under the charcoal parapet, split AC units;
//   · a deep charcoal canopy fascia (3.6–4.5 m, 1.8 m out) over the five-foot
//     way, slatted dark metal soffit, three rows of round downlights; a thinner
//     drop-off canopy continues past the corner end on two dark columns;
//   · ground floor, left to right from the car park: a solid tiled bay with a
//     stacked-stone panel and glass-block vent; the hotel's glazed entrance and
//     red SALIM INN wall letters; then the cafe glazing under the "cafe.cafe"
//     letters (generic lettering — no logo reproduced);
//   · the five-foot way raised 0.6 m above the car park, with a ramp at the
//     corner end; four frameless glass leaves at the entrance, green and red
//     bands across them, 砂林酒店 over the red letters and a plain bench (the
//     owner's walk-through video, 2026-10-12);
//   · parapet: a 1.45 m charcoal band carrying the louvred SALIM INN sign
//     cabinet with raised red letters (lit at dusk).
// The block is also a real shell (slabs, walls, stair void) so the camera can
// walk in and rise to level 1 without clipping.
import * as THREE from 'three';
import { salimFrame, SALIM_WIDTH } from './layout';
import { DIM, FLOOR_Y } from '../config/dimensions';
import { BRAND, FACADE } from '../config/materials';
import { boxAt, mergeAll, metricUV, paint, rbox, rng, tube, wallWithOpenings, type Opening } from './geom';
import { buildText } from './letters';
import { downlightWash, GLOBAL, interiorWindows, plaster, windowLights, type Wash, type WindowLights } from './shaders';
import { chineseNameTexture } from './signage';
import { louvres, mosaicTiles, soffitSlats, stoneCladding, wallTiles } from './textures';

const S = DIM.salim;
const W = SALIM_WIDTH;
const D = S.depth;
const T = 0.2; // wall thickness
const BW = S.bayWidth;
const Y1 = FLOOR_Y.level1;
const Y2 = FLOOR_Y.level2;
const YR = FLOOR_Y.roof;
const YP = FLOOR_Y.parapetTop;
const YCAP = YP - DIM.capping;
const FFW = DIM.fiveFootWay;
const CAN_Y = DIM.canopyHeight; // 3.6 soffit
const CAN_TOP = 4.5; // fascia top (the cafe letters stand on it)
const CAN_OUT = DIM.canopyProjection; // 1.8
const PIL = 0.45; // pilaster width
const REVEAL = 0.1;
// The five-foot way stands 0.6 m above the car park (the owner's walk-through
// video, 2026-10-12: a ramp at the corner end, nothing in front of the
// doors). The calibrated 2.69 m door head then leaves a standard 2.1 m door.
const GY = 0.6;
/** The neighbouring five-foot way under the drop-off canopy, past the corner end. */
const DROP_Y = 0.15;
/** The ramp at the corner end, rising towards the stone panel. */
const RAMP = { x0: 1.4, x1: 3.2, z0: 0.42, z1: 4.2 };
/** The entrance's glass line, 14 cm back from the tiled wall's face. */
const DOOR_Z = -FFW + 0.06;
/** Each of the entrance's four glass leaves: a quarter of the opening, less a 4 mm joint. */
const DOOR_LEAF = (S.entrance.x1 - S.entrance.x0) / 4 - 0.004;
/** How far the middle pair swings in when open (radians). */
const DOOR_SWING = 0.51 * Math.PI;
const BAND = { red: 0xc8242b, green: 0x1e9a55 };
const TIMBER = 0xb9803f;
const GROUPS = S.windowGroups as unknown as [number, number][];
/** The four lots along the facade, each with its window groups (lot-relative). */
const LOTS = (S.bayLines as readonly number[]).slice(0, -1).map((x0, i, a) => ({
  x0,
  x1: (S.bayLines as readonly number[])[i + 1],
  groups: (i === a.length - 1 ? S.southLotGroups : S.windowGroups) as unknown as [number, number][],
}));
const PILASTERS = S.pilasters as readonly number[];

/** The stair (the owner's walk-through video, 2026-10-12, placed by the owner
 *  on 2026-10-13: the stairs on the left as you come in, the reception on the
 *  right, chairs at the back): four carpeted steps up from the lobby floor to
 *  a brown door in the lobby's left-hand wall — the party wall with the
 *  corner lot — a landing behind it, a right turn, and one long straight
 *  flight towards the back (−z) to level 1, twenty risers in all; at its top
 *  a door in the right-hand wall. The video turns back there, so the passage
 *  from that door to the corridor is inferred. */
const XP = BW - T / 2; // the party wall's far face, on the corner lot's side
const FLIGHT = { z0: -9.2, risers: 16, run: 0.27 };
const TOP_RISER = FLIGHT.z0 - (FLIGHT.risers - 1) * FLIGHT.run;
const STAIR = {
  /** In the lobby's left-hand wall: front jamb at z0, back jamb at z1; `h` above its sill (the landing). */
  door: { z0: -7.9, z1: -8.8, h: 2.1 },
  rise: (Y1 - GY) / 20,
  /** Four risers in the lobby, rising towards the door (−x) from its floor
   *  to the landing's level, across from z0 to z1. */
  entry: { risers: 4, run: 0.28, z0: -7.65, z1: -8.95 },
  /** The flight's strip between its side walls; the landing behind the door
   *  runs from the party wall back to x0, its front edge at z0. */
  well: { x0: XP - 1.8, x1: XP - 0.56, z0: -7.8 },
  /** The long flight: its first riser at z0, climbing towards −z. */
  flight: FLIGHT,
  /** The level-1 landing at its top runs back to z1, with a door in its
   *  right-hand wall (front jamb z0, back jamb z1) … */
  top: { z1: TOP_RISER - 1.4, door: { z0: TOP_RISER - 0.2, z1: TOP_RISER - 1.1 } },
  /** … into a passage that runs forward beside the well to the corridor. */
  passage: { x0: XP - 0.36, x1: XP + 0.84 },
};

/** Interior plan shared with the interior builders and the camera (local frame). */
export const PLAN = {
  lobby: { x0: BW + T / 2, x1: 2 * BW - T / 2, z0: -11.6, z1: -FFW },
  door: { x0: S.entrance.x0, x1: S.entrance.x1, h: S.entrance.head },
  stair: STAIR,
  corridor: { z0: -9.2, z1: -7.6 },
  frontRoomDepth: 7.4,
  // The configurator room: level 1, front of the lobby bay, directly above
  // the entrance; its right-hand wall sits on the pier between the bay's two
  // windows and each room type extends to the left.
  showcaseBay: 1,
  showcaseRight: BW + (GROUPS[0][1] + GROUPS[1][0]) / 2,
  showcaseDoor: { x0: BW + 2.2, x1: BW + 3.2 },
  // The reception (owner's photos, 2026-10-02, placed by the owner on
  // 2026-10-13: on the right as you come in): an alcove in the lobby's
  // right-hand wall near the front — white pillars either side, a striated
  // laminate bulkhead over it, the painted mural on its back wall (the party
  // wall) — with the counter across its mouth, facing across the lobby (−x).
  // x0 is the mouth and x1 the wall; the opening runs from z0 back to z1,
  // behind a pillar at the front corner.
  reception: { x0: 2 * BW - T / 2 - 1.35, x1: 2 * BW - T / 2, z0: -FFW - 0.34, z1: -FFW - 0.34 - 2.35, soffit: 2.25 },
  // across the alcove's mouth, guest side towards −x (rotY −π/2)
  counter: { x: 2 * BW - T / 2 - 1.35 + 0.325, z: -FFW - 0.34 - 2.35 / 2, length: 2.35, depth: 0.65, rotY: -Math.PI / 2 },
  windowSill: 0.95,
  windowHead: 2.3,
  /** Above the lobby floor; the level-1 slab's underside is 3.65 m up. */
  lobbyCeiling: 2.95,
  /** The lobby floor and the five-foot way (the lobby group stands on it). */
  floor: GY,
  canopy: { y: CAN_Y, top: CAN_TOP, out: CAN_OUT },
};

/** The configurator room's window (level 1, lobby bay, first group): its two
 *  middle panes stand open, which is where the chapter-7 camera exits. */
export const SHOWCASE_WINDOW = {
  x0: BW + GROUPS[0][0],
  x1: BW + GROUPS[0][1],
  get centre() { return (this.x0 + this.x1) / 2; },
};

function placeWall(g: THREE.BufferGeometry, x: number, z: number, rotY: number): THREE.BufferGeometry {
  return g.applyMatrix4(new THREE.Matrix4().makeRotationY(rotY).setPosition(x, 0, z));
}

interface PaneSet { frames: THREE.BufferGeometry[]; glass: THREE.BufferGeometry[] }

/** A pane quad carrying the interior-mapping attributes. */
function pane(x0: number, x1: number, y0: number, y1: number, z: number, box: [number, number, number, number], seed: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0).toNonIndexed();
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, z);
  const pos = g.getAttribute('position');
  const aWin = new Float32Array(pos.count * 2);
  const aSeed = new Float32Array(pos.count);
  const aTan = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    aWin[i * 2] = (pos.getX(i) - box[0]) / (box[1] - box[0]);
    aWin[i * 2 + 1] = (pos.getY(i) - box[2]) / (box[3] - box[2]);
    aSeed[i] = seed;
    aTan[i * 3] = 1;
  }
  g.setAttribute('aWin', new THREE.BufferAttribute(aWin, 2));
  g.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
  g.setAttribute('aTan', new THREE.BufferAttribute(aTan, 3));
  return g;
}

/** A 4-pane sliding window unit (white aluminium) set back by REVEAL.
 *  `open` lists panes left open (no glass, no mullion between them). */
function windowUnit(x0: number, x1: number, y0: number, y1: number, seed: number, out: PaneSet, open: number[] = []): void {
  const z = -REVEAL;
  const f = 0.055; // frame width
  out.frames.push(boxAt(x0, y0, z - 0.06, x1, y0 + f, z + 0.03));
  out.frames.push(boxAt(x0, y1 - f, z - 0.06, x1, y1, z + 0.03));
  out.frames.push(boxAt(x0, y0, z - 0.06, x0 + f, y1, z + 0.03));
  out.frames.push(boxAt(x1 - f, y0, z - 0.06, x1, y1, z + 0.03));
  const n = 4;
  const pw = (x1 - x0) / n;
  const box: [number, number, number, number] = [x0, x1, y0, y1];
  for (let i = 0; i < n; i++) {
    const a = x0 + i * pw, b = a + pw;
    if (i > 0 && !(open.includes(i) && open.includes(i - 1))) out.frames.push(boxAt(a - 0.022, y0, z - 0.05, a + 0.022, y1, z + 0.02));
    if (open.includes(i)) continue;
    out.glass.push(pane(a + 0.01, b - 0.01, y0 + f, y1 - f, z - (i % 2 ? 0.035 : 0.005), box, seed)); // alternating tracks
  }
}

/** One frameless glass leaf of the entrance, hinged at x = 0 and running
 *  `dir`-wards along x, centred on z = 0: the glass, its two coloured bands
 *  (vertex colours), and its steel — patch fittings at the hinge corners and,
 *  on a door, a long pull on each face. */
function leafParts(len: number, dir: 1 | -1, pulls: boolean): { glass: THREE.BufferGeometry; film: THREE.BufferGeometry[]; steel: THREE.BufferGeometry[] } {
  const span = (u0: number, u1: number) => [Math.min(dir * u0, dir * u1), Math.max(dir * u0, dir * u1)] as const;
  const [a, b] = span(0, len);
  const y0 = GY + 0.03, y1 = S.entrance.head - 0.004;
  const glass = boxAt(a, y0, -0.006, b, y1, 0.006);
  const film = [
    paint(boxAt(a + 0.004, GY + 0.92, -0.008, b - 0.004, GY + 1.01, 0.008), BAND.red),
    paint(boxAt(a + 0.004, GY + 1.055, -0.008, b - 0.004, GY + 1.125, 0.008), BAND.green),
  ];
  const [fa, fb] = span(0, 0.17);
  const steel = [boxAt(fa, y0 - 0.01, -0.02, fb, y0 + 0.06, 0.02), boxAt(fa, y1 - 0.06, -0.02, fb, y1 + 0.004, 0.02)];
  if (pulls) {
    const px = dir * (len - 0.09);
    for (const s of [-1, 1]) {
      steel.push(tube(new THREE.Vector3(px, GY + 0.72, s * 0.06), new THREE.Vector3(px, GY + 1.52, s * 0.06), 0.016));
      for (const y of [GY + 0.8, GY + 1.44]) steel.push(tube(new THREE.Vector3(px, y, s * 0.006), new THREE.Vector3(px, y, s * 0.06), 0.009));
    }
  }
  return { glass, film, steel };
}

/** Split AC outdoor unit, vertex-coloured: detailed for the hero block, a
 *  light version (box + 8-sided fan) for the rows around the ring. */
export function acUnitGeometry(lo: boolean): THREE.BufferGeometry {
  const parts = lo
    ? [boxAt(-0.4, -0.28, -0.14, 0.4, 0.28, 0.14), new THREE.CylinderGeometry(0.2, 0.2, 0.02, 8).rotateX(Math.PI / 2).translate(-0.1, 0, 0.145)]
    : [
        rbox(-0.4, -0.28, -0.14, 0.4, 0.28, 0.14, 0.02),
        new THREE.CylinderGeometry(0.2, 0.2, 0.02, 20).rotateX(Math.PI / 2).translate(-0.1, 0, 0.145),
        new THREE.TorusGeometry(0.2, 0.012, 6, 24).translate(-0.1, 0, 0.15),
        boxAt(-0.35, -0.34, -0.2, -0.3, -0.28, 0.05),
        boxAt(0.3, -0.34, -0.2, 0.35, -0.28, 0.05),
      ];
  const cols = [0xf1f1ee, 0x2d3032, 0xdedfdc, 0x555a5c, 0x555a5c];
  parts.forEach((g, i) => {
    const c = new THREE.Color(cols[i]);
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) arr.set([c.r, c.g, c.b], k * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  });
  return mergeAll(parts, ['position', 'normal', 'color']);
}

export class SalimInnBuilding {
  readonly group = new THREE.Group();
  readonly meshes: THREE.Mesh[] = [];
  readonly sign: THREE.Mesh;
  readonly signLetters: THREE.Mesh;
  readonly wallLetters: THREE.Mesh;
  readonly cafeLetters: THREE.Mesh;
  readonly windowGlass: THREE.Mesh;
  readonly shopGlass: THREE.Mesh;
  /** The entrance's middle pair: hinge groups, swung by setDoor. */
  readonly doorLeaves: THREE.Object3D[] = [];
  /** The lit room behind the entrance glass while the lobby is not drawn. */
  readonly lobbyVeil: THREE.Mesh;
  /** Window lights (World.update): the guest rooms', the lobby's (the
   *  front desk never closes) and the cafe's (its own trading hours). */
  readonly roomLights = windowLights();
  readonly lobbyLights = windowLights();
  readonly cafeLights = windowLights();
  readonly downlights: THREE.InstancedMesh;
  readonly acUnits: THREE.InstancedMesh;
  /** Cafe furniture and planter greenery on the five-foot way. */
  readonly props = new THREE.Group();
  private downlightUniform = { value: 0 };
  private downlightLocal: THREE.Vector3[] = [];

  constructor(levels: { value: number } = { value: 99 }) {
    this.group.position.copy(salimFrame.position);
    this.group.rotation.copy(salimFrame.rotation);
    this.group.name = 'salim-inn';
    const rand = rng(21_22);

    const cream: THREE.BufferGeometry[] = [];
    const white: THREE.BufferGeometry[] = [];
    const charcoal: THREE.BufferGeometry[] = [];
    const stone: THREE.BufferGeometry[] = [];
    const tiles: THREE.BufferGeometry[] = [];
    const floorTiles: THREE.BufferGeometry[] = [];
    const concrete: THREE.BufferGeometry[] = [];
    const greyMetal: THREE.BufferGeometry[] = [];
    const panes: PaneSet = { frames: white, glass: [] };
    const shopPanes: PaneSet = { frames: charcoal, glass: [] };
    const acMatrices: THREE.Matrix4[] = [];

    // ---------------------------------------------------------------- ground floor
    const zf = -FFW; // shopfront inner face; the wall occupies [zf, zf + T]
    const zs = zf + T; // shopfront outer face
    // The five-foot way, GY above the car park along the hotel's frontage;
    // three steps down at the corner end to the neighbouring five-foot way
    // under the drop-off canopy, and four at the south end to the covered
    // walkway. The hotel's tiles stand 2 cm above the level they overlap
    // under the drop-off canopy (both were at one height, and took turns on
    // screen); whatever stands on them sinks 2 cm into the tiles.
    const xc = -S.dropOffCanopy - 0.4;
    /** A stretch of five-foot way (or a step of it) from x0 to x1, its top at y. */
    const walkway = (x0: number, x1: number, y: number) => {
      floorTiles.push(metricUV(boxAt(x0, 0, zf - 0.2, x1, y, 0.3)));
      concrete.push(boxAt(x0, 0, 0.3, x1, y, 0.42)); // the edge
    };
    walkway(0, W, GY + 0.02);
    walkway(xc, -0.6, DROP_Y + 0.02);
    for (let k = 1; k < 3; k++) walkway(-0.3 * k, -0.3 * (k - 1), DROP_Y + 0.02 + ((GY - DROP_Y) * (3 - k)) / 3);
    for (let k = 1; k < 4; k++) walkway(W + 0.3 * (k - 1), W + 0.3 * k, ((GY + 0.02) * (4 - k)) / 4);
    charcoal.push(boxAt(xc, 0.0, 0.42, RAMP.x0, 0.035, 0.72), boxAt(RAMP.x1, 0.0, 0.42, W + 0.9, 0.035, 0.72)); // drain grating strip

    // the ramp at the corner end (owner's video): light anti-slip bands across
    // it and stainless rails both sides, running on over the walkway
    const rampY = (z: number) => (GY + 0.02) * THREE.MathUtils.clamp((RAMP.z1 - z) / (RAMP.z1 - RAMP.z0), 0, 1);
    const onRamp = (g: THREE.BufferGeometry, wedge: boolean) => {
      const pos = g.getAttribute('position');
      for (let i = 0; i < pos.count; i++) pos.setY(i, wedge ? pos.getY(i) * rampY(pos.getZ(i)) : pos.getY(i) + rampY(pos.getZ(i)));
      g.computeVertexNormals();
      return metricUV(g);
    };
    floorTiles.push(onRamp(boxAt(RAMP.x0, 0, RAMP.z0, RAMP.x1, 1, RAMP.z1), true));
    for (let z = RAMP.z0 + 0.2; z < RAMP.z1 - 0.3; z += 0.45) concrete.push(onRamp(boxAt(RAMP.x0 + 0.08, 0.002, z, RAMP.x1 - 0.08, 0.008, z + 0.24), false));
    for (const x of [RAMP.x0 + 0.06, RAMP.x1 - 0.06]) {
      const zLow = RAMP.z1 - 0.3, zTop = RAMP.z0, zEnd = RAMP.z0 - 0.4;
      const at = (z: number, h: number) => new THREE.Vector3(x, (z > zTop ? rampY(z) : GY + 0.02) + h, z);
      for (const h of [0.9, 0.45]) greyMetal.push(tube(at(zLow, h), at(zTop, h), h > 0.5 ? 0.022 : 0.014), tube(at(zTop, h), at(zEnd, h), h > 0.5 ? 0.022 : 0.014));
      for (const z of [zLow, (zLow + zTop) / 2, zEnd]) greyMetal.push(tube(at(z, 0), at(z, 0.92), 0.024));
    }

    // bay 0 — solid tiled frontage: stacked-stone panel, glass-block vent, wall lamp
    tiles.push(metricUV(boxAt(0.2, GY, zf, BW - PIL / 2, CAN_Y, zs)));
    const sp = S.stonePanel;
    stone.push(metricUV(boxAt(sp.x0, GY, zs, sp.x1, sp.top, zs + 0.07)));
    const gb = S.glassBlocks;
    shopPanes.glass.push(pane(gb.x0, gb.x1, gb.y0, gb.y1, zs + 0.012, [gb.x0, gb.x1, gb.y0, gb.y1], 0.13));
    white.push(boxAt(gb.x0 - 0.05, gb.y0 - 0.05, zs - 0.01, gb.x1 + 0.05, gb.y0, zs + 0.04), boxAt(gb.x0 - 0.05, gb.y1, zs - 0.01, gb.x1 + 0.05, gb.y1 + 0.05, zs + 0.04));
    for (let k = 1; k < 4; k++) white.push(boxAt(gb.x0 + ((gb.x1 - gb.x0) * k) / 4 - 0.012, gb.y0, zs, gb.x0 + ((gb.x1 - gb.x0) * k) / 4 + 0.012, gb.y1, zs + 0.03));
    charcoal.push(rbox(sp.x1 + 0.25, 2.78, zs, sp.x1 + 0.4, 2.98, zs + 0.12, 0.02)); // wall lamp

    // bay 1 — the hotel entrance (owner's video, 2026-10-12): four frameless
    // glass leaves on patch fittings under a white head, set back in the tiled
    // wall; the middle pair swings in on floor springs, with long steel pulls;
    // a green band over a red one across the glass; a mosaic-tiled right-hand
    // reveal; the Chinese name over the red SALIM INN letters and a plain
    // bench under them (the real one's advertisement is not reproduced)
    const d = PLAN.door;
    tiles.push(metricUV(boxAt(BW + PIL / 2, GY, zf, d.x0, CAN_Y, zs)));
    tiles.push(metricUV(boxAt(d.x0, d.h + 0.05, zf, d.x1, CAN_Y, zs)));
    tiles.push(metricUV(boxAt(d.x1, GY, zf, S.cafeGlazingFrom, CAN_Y, zs)));
    white.push(boxAt(d.x0, d.h, zf, d.x1, d.h + 0.05, zs)); // the head
    const mosaic = metricUV(boxAt(d.x1 - 0.012, GY + 0.02, DOOR_Z + 0.008, d.x1, d.h, zs));
    const fixedGlass: THREE.BufferGeometry[] = [];
    const film: THREE.BufferGeometry[] = []; // the glass bands and the bench's timber (vertex colours)
    for (const i of [0, 3]) {
      const dir = i === 0 ? 1 : -1, px = i === 0 ? d.x0 : d.x1;
      const parts = leafParts(DOOR_LEAF, dir, false);
      const at = (g: THREE.BufferGeometry) => g.translate(px, 0, DOOR_Z);
      fixedGlass.push(at(parts.glass));
      film.push(...parts.film.map(at));
      greyMetal.push(...parts.steel.map(at));
    }
    const bx0 = d.x1 + 0.3, bx1 = bx0 + 1.6, bz = zs + 0.02, sy = GY + 0.44;
    for (const x of [bx0 + 0.1, bx1 - 0.1]) {
      charcoal.push(
        boxAt(x - 0.02, GY, bz + 0.38, x + 0.02, sy, bz + 0.42), // front leg
        boxAt(x - 0.02, GY, bz + 0.03, x + 0.02, sy + 0.44, bz + 0.07), // back leg, up the back
        boxAt(x - 0.02, GY + 0.12, bz + 0.03, x + 0.02, GY + 0.15, bz + 0.42), // stretcher
        boxAt(x - 0.02, sy - 0.04, bz + 0.03, x + 0.02, sy, bz + 0.42), // seat rail
      );
    }
    for (let k = 0; k < 4; k++) film.push(paint(boxAt(bx0, sy, bz + 0.05 + k * 0.095, bx1, sy + 0.025, bz + 0.13 + k * 0.095), TIMBER));
    for (let k = 0; k < 2; k++) film.push(paint(boxAt(bx0, sy + 0.16 + k * 0.13, bz + 0.07, bx1, sy + 0.26 + k * 0.13, bz + 0.095), TIMBER));

    // bay 2 — cafe: full-height glazing in ~1 m panels, head band, blind cassette
    const c0 = S.cafeGlazingFrom, c1 = W - 0.25;
    const nPanels = Math.round((c1 - c0) / 1.0);
    const pw = (c1 - c0) / nPanels;
    for (let i = 0; i < nPanels; i++) {
      const x0 = c0 + i * pw;
      shopPanes.glass.push(pane(x0 + 0.025, x0 + pw - 0.025, GY + 0.06, 2.95, zf + T * 0.5, [c0, c1, 0, CAN_Y], 0.33 + i * 0.07));
      charcoal.push(boxAt(x0 - 0.025, GY, zf + 0.05, x0 + 0.025, 2.95, zs - 0.02));
    }
    charcoal.push(boxAt(c0, 2.95, zf + 0.04, c1, 3.08, zs - 0.02), boxAt(c0, GY, zf + 0.04, c1, GY + 0.06, zs - 0.02));
    tiles.push(metricUV(boxAt(c0, 3.08, zf, c1, CAN_Y, zs)));
    greyMetal.push(rbox(c0 + 0.1, 3.28, -0.25, c1, 3.5, -0.02, 0.03)); // retractable blind cassette (rec2_t180s)
    white.push(boxAt(c1, GY, -D, W, CAN_Y, zs)); // south end wall under the canopy

    // front columns on the bay lines (rec2_t190s: dark at the lobby bay, white beyond)
    const col = (x: number, r: number) => { const c = new THREE.CylinderGeometry(r, r, CAN_Y - GY, 28); c.translate(x, GY + (CAN_Y - GY) / 2, -0.32); return c; };
    charcoal.push(col(BW, 0.2));
    white.push(col(2 * BW, 0.23), col(W - 0.3, 0.23));
    for (const dx of [-0.08, 0.1]) {
      const p = new THREE.CylinderGeometry(0.055, 0.055, Y2, 10);
      p.translate(W - 0.05 + dx, Y2 / 2, 0.05 + dx * 0.6);
      white.push(p);
    }

    // shell: end walls, back wall, party walls (the first with the stair door
    // in it), the lobby's back wall, and the stair's own walls in the corner
    // lot on the ground floor (Corridor.ts skins them and builds level 1's)
    const L = PLAN.lobby, stair = PLAN.stair, sw = stair.well, sd = stair.door;
    const topRiser = stair.flight.z0 - (stair.flight.risers - 1) * stair.flight.run;
    const head = GY + stair.entry.risers * stair.rise + sd.h; // the stair door's head
    white.push(boxAt(0, 0, -D, T, Y1, zf), boxAt(W - T, 0, -D, W, Y1, zf), boxAt(0, 0, -D, W, Y1, -D + T));
    for (const x of (S.bayLines as readonly number[]).slice(1, -1)) {
      if (x !== BW) {
        white.push(boxAt(x - T / 2, 0, -D, x + T / 2, Y1, zf));
        continue;
      }
      // round the stair door (Corridor.ts's threshold fills it under the sill)
      white.push(boxAt(x - T / 2, 0, -D, x + T / 2, Y1, sd.z1), boxAt(x - T / 2, 0, sd.z0, x + T / 2, Y1, zf), boxAt(x - T / 2, head, sd.z1, x + T / 2, Y1, sd.z0));
    }
    white.push(
      boxAt(L.x0, 0, L.z0 - T, L.x1, Y1, L.z0), // the lobby's back wall
      boxAt(sw.x0 - T, 0, stair.top.z1 - T, sw.x0, Y1, sw.z0 + T), // the stair's outer wall
      boxAt(sw.x0, 0, sw.z0, XP, Y1, sw.z0 + T), // in front of the landing
      boxAt(sw.x1, 0, stair.top.z1 - T, sw.x1 + T, Y1, stair.flight.z0), // beside the flight
      boxAt(sw.x1 + T, 0, stair.flight.z0 - T, XP, Y1, stair.flight.z0), // behind the landing, right of the flight
      boxAt(sw.x0, 0, stair.top.z1 - T, sw.x1, Y1, stair.top.z1), // under the top landing's end
    );

    // ---------------------------------------------------------------- slabs
    // slab edges stop 3 cm inside the facade wall (flush faces z-fight); level
    // 1's is open over the long flight, from behind the corridor's back wall
    // to the top riser
    const zE = -0.03;
    const vz0 = PLAN.corridor.z0 - T - 0.05;
    const slab = (y: number, open: boolean) => {
      const y0 = y - 0.25;
      if (!open) return [boxAt(0, y0, -D, W, y, zE)];
      return [boxAt(0, y0, -D, sw.x0, y, zE), boxAt(sw.x1, y0, -D, W, y, zE), boxAt(sw.x0, y0, -D, sw.x1, y, topRiser), boxAt(sw.x0, y0, vz0, sw.x1, y, zE)];
    };
    white.push(...slab(Y1, true), ...slab(Y2, false));
    concrete.push(...slab(YR, false));
    white.push(boxAt(L.x0, GY + PLAN.lobbyCeiling, L.z0, L.x1, GY + PLAN.lobbyCeiling + 0.05, L.z1));

    // ---------------------------------------------------------------- upper floors
    const openings: Opening[] = [];
    for (const lot of LOTS) for (const [a, c] of lot.groups) openings.push({ u0: lot.x0 + a, u1: lot.x0 + c, v0: PLAN.windowSill, v1: PLAN.windowHead });
    let seed = 0.37;
    for (const [yf, level] of [[Y1, 1], [Y2, 2]] as const) {
      const h = (level === 1 ? Y2 : YR) - yf;
      cream.push(placeWall(wallWithOpenings(W, h, T, openings), 0, 0, 0).translate(0, yf, 0));
      LOTS.forEach((lot, b) => {
        const bx = lot.x0;
        // white head and sill bands between the pilasters / end fins
        const l = b === 0 ? 0.3 : PILASTERS.includes(bx) ? bx + PIL / 2 : bx;
        const r = b === LOTS.length - 1 ? W - 0.18 : PILASTERS.includes(lot.x1) ? lot.x1 - PIL / 2 : lot.x1;
        white.push(boxAt(l, yf + PLAN.windowHead, -0.01, r, yf + PLAN.windowHead + 0.27, 0.05));
        white.push(boxAt(l, yf + PLAN.windowSill - 0.12, -0.01, r, yf + PLAN.windowSill, 0.09));
        lot.groups.forEach(([a, c], gi) => {
          const isShowcase = level === 1 && b === PLAN.showcaseBay && gi === 0;
          windowUnit(bx + a, bx + c, yf + PLAN.windowSill, yf + PLAN.windowHead, (seed = (seed * 9.13 + 0.271) % 1), panes, isShowcase ? [1, 2] : []);
          cream.push(boxAt(bx + a, yf + PLAN.windowSill, -REVEAL, bx + a + 0.02, yf + PLAN.windowHead, 0), boxAt(bx + c - 0.02, yf + PLAN.windowSill, -REVEAL, bx + c, yf + PLAN.windowHead, 0));
        });
        // split AC units (rec2_t190s): stacked pairs on the pier, or hung
        // under the second window; now and then one more under the first
        const ac = (x: number, y: number) => acMatrices.push(new THREE.Matrix4().makeTranslation(x, y, 0.22));
        if (lot.groups.length < 2) {
          // the south lot: one unit hung beside its single window
          ac(bx + 0.25, yf + 1.4);
          return;
        }
        const pier = bx + (lot.groups[0][1] + lot.groups[1][0]) / 2;
        if (level === 2 && b === 0) { ac(bx + 4.35, yf + 0.52); ac(bx + 5.35, yf + 0.52); }
        else if (rand() < 0.8) { ac(pier, yf + 1.12); ac(pier, yf + 1.7); }
        else ac(pier, yf + 1.4);
        if (rand() < 0.3) ac(bx + lot.groups[0][0] + 0.7 + rand() * 1.2, yf + 0.5);
      });
      // end walls with two windows each (rooms at both ends)
      const endOps: Opening[] = [{ u0: 3, u1: 5.6, v0: PLAN.windowSill, v1: PLAN.windowHead }, { u0: 10, u1: 12.6, v0: PLAN.windowSill, v1: PLAN.windowHead }];
      cream.push(placeWall(wallWithOpenings(D, h, T, endOps), 0, -D, -Math.PI / 2).translate(0, yf, 0));
      cream.push(placeWall(wallWithOpenings(D, h, T, endOps), W, 0, Math.PI / 2).translate(0, yf, 0));
      cream.push(boxAt(0, yf, -D, W, yf + h, -D + T));
      for (const [sideIdx, x, rot] of [[0, 0, -Math.PI / 2], [1, W, Math.PI / 2]] as const) {
        for (const o of endOps) {
          const set: PaneSet = { frames: [], glass: [] };
          windowUnit(o.u0, o.u1, yf + o.v0, yf + o.v1, (seed = (seed * 7.77 + 0.13) % 1), set);
          const m = new THREE.Matrix4().makeRotationY(rot).setPosition(x, 0, sideIdx === 0 ? -D : 0);
          for (const g of set.frames) white.push(g.applyMatrix4(m));
          const tan = new THREE.Vector3(1, 0, 0).applyMatrix4(new THREE.Matrix4().makeRotationY(rot));
          for (const g of set.glass) {
            g.applyMatrix4(m);
            const at = g.getAttribute('aTan');
            for (let i = 0; i < at.count; i++) at.setXYZ(i, tan.x, tan.y, tan.z);
            panes.glass.push(g);
          }
        }
        if (rand() < 0.7) acMatrices.push(new THREE.Matrix4().makeRotationY(rot).setPosition(x + (sideIdx === 0 ? -0.22 : 0.22), yf + 1.2, -7.5));
      }
    }
    // parapet: the charcoal band (10.35 → 11.8) over a sliver of cream
    cream.push(boxAt(0, YR, -T, W, YCAP, 0));
    cream.push(boxAt(0, YR, -D, T, YCAP, 0), boxAt(W - T, YR, -D, W, YCAP, 0), boxAt(0, YR, -D, W, YCAP, -D + T));
    // The cap stands 2 cm above the shared parapet datum: its 18 cm overhang
    // lies over the next row's parapet capping, whose top is also at YP, and
    // the two took turns along the whole party wall from the air.
    const YC = YP + 0.02;
    charcoal.push(rbox(-0.18, YCAP, -0.35, W + 0.18, YC, 0.2, 0.03));
    charcoal.push(rbox(-0.18, YCAP, -D - 0.05, 0.35, YC, -0.35, 0.03), rbox(W - 0.35, YCAP, -D - 0.05, W + 0.18, YC, -0.35, 0.03), rbox(-0.18, YCAP, -D - 0.05, W + 0.18, YC, -D + 0.35, 0.03));

    // pilasters on the bay lines, and fins wrapping both ends (rec2_t180s right end)
    for (const x of PILASTERS) charcoal.push(rbox(x - PIL / 2, CAN_TOP - 0.05, -0.02, x + PIL / 2, YCAP, 0.16, 0.02));
    charcoal.push(rbox(-0.18, CAN_TOP - 0.05, -0.62, 0.3, YCAP, 0.16, 0.02));
    charcoal.push(rbox(W - 0.18, CAN_TOP - 0.05, -0.62, W + 0.18, YCAP, 0.16, 0.02));
    for (const z of [-6.2, -12.4]) charcoal.push(rbox(-0.18, Y1, z - 0.28, 0.02, YCAP, z + 0.28, 0.02), rbox(W - 0.02, Y1, z - 0.28, W + 0.18, YCAP, z + 0.28, 0.02));
    // the band on the facade between the fascia and the L1 sills
    charcoal.push(boxAt(-0.05, Y1 - 0.1, -0.02, W + 0.05, Y1 + PLAN.windowSill - 0.12, 0.07));

    // ---------------------------------------------------------------- canopy
    charcoal.push(rbox(0, CAN_Y, 0, W + 0.05, CAN_TOP, CAN_OUT, 0.03)); // fascia box
    // drop-off canopy past the corner end: thinner slab on two dark columns
    const dx0 = -S.dropOffCanopy;
    charcoal.push(rbox(dx0, CAN_Y + 0.2, zf, 0.02, CAN_Y + 0.55, CAN_OUT + 0.4, 0.03));
    for (const z of [CAN_OUT, zf + 0.5]) {
      const c = new THREE.CylinderGeometry(0.15, 0.15, CAN_Y + 0.2, 18);
      c.translate(dx0 + 0.45, (CAN_Y + 0.2) / 2, z);
      charcoal.push(c);
    }
    const soffit = new THREE.PlaneGeometry(W, CAN_OUT + FFW).rotateX(Math.PI / 2);
    soffit.translate(W / 2, CAN_Y - 0.004, (CAN_OUT - FFW) / 2);
    const soffit2 = new THREE.PlaneGeometry(-dx0, CAN_OUT + 0.4 - zf).rotateX(Math.PI / 2);
    soffit2.translate(dx0 / 2, CAN_Y + 0.196, (CAN_OUT + 0.4 + zf) / 2);
    metricUV(soffit);
    metricUV(soffit2);

    // covered walkway to the next block (rec2_t180s: a lower grey canopy)
    const wg = S.walkwayGap;
    greyMetal.push(rbox(W + 0.06, CAN_Y - 0.15, zf - 0.6, W + wg - 0.1, CAN_Y + 0.08, CAN_OUT - 0.25, 0.02));
    for (const z of [CAN_OUT - 0.5, zf - 0.3]) {
      const post = new THREE.CylinderGeometry(0.06, 0.06, CAN_Y - 0.15, 10);
      post.translate(W + wg - 0.4, (CAN_Y - 0.15) / 2, z);
      greyMetal.push(post);
    }

    // ---------------------------------------------------------------- roof
    const tank = (x: number, z: number) => {
      const t = new THREE.CylinderGeometry(0.75, 0.75, 1.6, 22);
      t.translate(x, YR + 1.25, z);
      concrete.push(t, boxAt(x - 0.9, YR, z - 0.9, x + 0.9, YR + 0.45, z + 0.9));
    };
    tank(3.4, -12.5);
    tank(5.2, -12.5);
    for (const [x, z] of [[8, -15], [10, -15], [14.5, -14]]) acMatrices.push(new THREE.Matrix4().makeRotationY(Math.PI).setPosition(x, YR + 0.3, z));

    // ---------------------------------------------------------------- roof sign
    // Louvred cabinet fixed on the face of the charcoal parapet band.
    const rs = S.roofSign, sz = rs.face;
    white.push(rbox(rs.x0 - 0.08, rs.y0 - 0.08, 0.18, rs.x1 + 0.08, rs.y1 + 0.08, sz - 0.01, 0.02));
    const signFace = new THREE.PlaneGeometry(rs.x1 - rs.x0, rs.y1 - rs.y0);
    signFace.translate((rs.x0 + rs.x1) / 2, (rs.y0 + rs.y1) / 2, sz);
    const capH = (rs.y1 - rs.y0) * 0.58;
    const signText = buildText('SALIM INN', { size: capH, weight: 0.21, depth: 0.08, case: 'upper', italic: 0.14, tracking: 0.09 });
    const signScale = Math.min(1, ((rs.x1 - rs.x0) * 0.86) / signText.width);
    signText.geo.scale(signScale, 1, 1);
    signText.geo.translate((rs.x0 + rs.x1) / 2 - (signText.width * signScale) / 2, (rs.y0 + rs.y1) / 2 - capH / 2, sz + 0.005);

    // ---------------------------------------------------------------- letters
    const wl = S.wallLetters;
    const wall = buildText('SALIM INN', { size: wl.cap, weight: 0.21, depth: 0.04, case: 'upper', tracking: 0.07 });
    wall.geo.scale((wl.x1 - wl.x0) / wall.width, 1, 1);
    wall.geo.translate(wl.x0, wl.base, zs + 0.012);
    const cl = S.cafeLetters;
    const cafe = buildText('cafe.cafe', { size: cl.size, weight: 0.21, depth: 0.14, case: 'lower', tracking: 0.03 });
    cafe.geo.scale((cl.x1 - cl.x0) / cafe.width, 1, 1); // condensed, like the real lettering
    cafe.geo.translate(cl.x0, CAN_TOP + 0.01, CAN_OUT - 0.6);

    // the Chinese name in steel over the red letters (a texture: the letter
    // font has Latin glyphs only)
    const hanzi = new THREE.PlaneGeometry(1.4, 0.35);
    hanzi.translate((wl.x0 + wl.x1) / 2, wl.base + wl.cap + 0.26, zs + 0.02);

    // ---------------------------------------------------------------- planters
    // along the edge, but none before the entrance (owner's video)
    const terracotta: THREE.BufferGeometry[] = [];
    const plantSpots: THREE.Vector3[] = [];
    for (const x of [2 * BW - 1.0, c0 + 1.6, c0 + 4.6, c0 + 7.4, W - 1.2]) {
      terracotta.push(rbox(x - 0.62, GY, -0.95, x + 0.62, GY + 0.58, -0.4, 0.03));
      plantSpots.push(new THREE.Vector3(x, GY + 0.52, -0.67));
    }

    // ---------------------------------------------------------------- materials & meshes
    const mk = (geos: THREE.BufferGeometry[], mat: THREE.Material, name: string, cast = true, keep = ['position', 'normal', 'uv']) => {
      const m = new THREE.Mesh(mergeAll(geos, keep), mat);
      m.name = name;
      m.castShadow = cast;
      m.receiveShadow = true;
      this.group.add(m);
      this.meshes.push(m);
      return m;
    };
    mk(cream, plaster(new THREE.MeshStandardMaterial({ color: FACADE.salimCream, roughness: 0.86 }), 1.2), 'salim-cream');
    mk(white, new THREE.MeshStandardMaterial({ color: FACADE.windowFrame, roughness: 0.42, metalness: 0.05 }), 'salim-white');
    mk(charcoal, new THREE.MeshStandardMaterial({ color: FACADE.salimCharcoal, roughness: 0.5, metalness: 0.3 }), 'salim-charcoal');
    const steelMat = new THREE.MeshStandardMaterial({ color: 0xb7bbbd, roughness: 0.4, metalness: 0.6 });
    mk(greyMetal, steelMat, 'salim-blinds');
    const st = stoneCladding();
    mk(stone, new THREE.MeshStandardMaterial({ map: st.map, normalMap: st.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.92 }), 'salim-stone');
    const tileMap = wallTiles().clone();
    tileMap.repeat.set(1 / 1.2, 1 / 1.2);
    tileMap.needsUpdate = true;
    mk(tiles, new THREE.MeshStandardMaterial({ map: tileMap, roughness: 0.35 }), 'salim-tiles');
    const floorMap = wallTiles().clone();
    floorMap.repeat.set(1 / 0.6, 1 / 0.6);
    floorMap.needsUpdate = true;
    mk(floorTiles, new THREE.MeshStandardMaterial({ map: floorMap, color: 0x6c6a66, roughness: 0.6 }), 'salim-walkway', false);
    mk(concrete, new THREE.MeshStandardMaterial({ color: 0xb9b4aa, roughness: 0.9 }), 'salim-concrete');
    const sl = soffitSlats();
    const soffitMap = sl.map.clone();
    soffitMap.repeat.set(1 / 0.88, 1);
    soffitMap.needsUpdate = true;
    const soffitN = sl.normalMap.clone();
    soffitN.repeat.set(1 / 0.88, 1);
    soffitN.needsUpdate = true;
    mk([soffit, soffit2], new THREE.MeshStandardMaterial({ map: soffitMap, normalMap: soffitN, roughness: 0.45, metalness: 0.4, side: THREE.DoubleSide }), 'salim-soffit', false);

    this.windowGlass = mk(panes.glass, interiorWindows(new THREE.MeshPhysicalMaterial({ color: 0x223036, roughness: 0.13, reflectivity: 0.55, envMapIntensity: 1.5 }), { depth: 3.4, size: [2.5, 1.35], litShare: 0.62, levels, lights: this.roomLights }), 'salim-windows', false, ['position', 'normal', 'aWin', 'aSeed', 'aTan']);
    const shopfront = (lights: WindowLights) => interiorWindows(new THREE.MeshPhysicalMaterial({ color: 0x2a3432, roughness: 0.05, reflectivity: 0.5, envMapIntensity: 1.3 }), { depth: 7, size: [6.4, 3.1], litShare: 1.0, warm: 0xffdcb0, lights });
    this.shopGlass = mk(shopPanes.glass, shopfront(this.cafeLights), 'salim-shopfront', false, ['position', 'normal', 'aWin', 'aSeed', 'aTan']);

    // Behind the entrance glass, the shopfronts' lit room until the lobby
    // itself is drawn (setLobbyShown): from the air the doorway glows like
    // the cafe beside it, not with the empty shell. Its own material (the
    // same shader): the lobby stays lit when the cafe closes.
    this.lobbyVeil = new THREE.Mesh(pane(d.x0, d.x1, GY, d.h, zf - 0.08, [d.x0, d.x1, 0, CAN_Y], 0.71), shopfront(this.lobbyLights));
    this.lobbyVeil.name = 'salim-lobby-veil';
    this.group.add(this.lobbyVeil);

    // the entrance: the fixed outer leaves and the bench's timber merged; the
    // middle pair swings in as the camera reaches it (setDoor)
    const leafMat = new THREE.MeshPhysicalMaterial({ color: 0x9fb4b8, roughness: 0.04, transparent: true, opacity: 0.32, envMapIntensity: 1.4 });
    const filmMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 });
    mk(fixedGlass, leafMat, 'salim-door-fixed', false);
    mk(film, filmMat, 'salim-door-bands', true, ['position', 'normal', 'color']);
    const mosaicMap = mosaicTiles().clone();
    mosaicMap.repeat.set(1 / 0.25, 1 / 0.25);
    mosaicMap.needsUpdate = true;
    mk([mosaic], new THREE.MeshStandardMaterial({ map: mosaicMap, roughness: 0.3 }), 'salim-mosaic', false);
    for (const dir of [1, -1] as const) {
      const pivot = new THREE.Group();
      pivot.position.set(dir > 0 ? d.x0 + (d.x1 - d.x0) / 4 : d.x1 - (d.x1 - d.x0) / 4, 0, DOOR_Z);
      const parts = leafParts(DOOR_LEAF, dir, true);
      const k = dir > 0 ? 1 : 2;
      const glass = new THREE.Mesh(parts.glass, leafMat);
      const bands = new THREE.Mesh(mergeAll(parts.film, ['position', 'normal', 'color']), filmMat);
      const steel = new THREE.Mesh(mergeAll(parts.steel, ['position', 'normal', 'uv']), steelMat);
      glass.name = `salim-door-${k}`;
      bands.name = `salim-door-bands-${k}`;
      steel.name = `salim-door-steel-${k}`;
      pivot.add(glass, bands, steel);
      pivot.name = `salim-door-leaf-${k}`;
      this.group.add(pivot);
      this.doorLeaves.push(pivot);
    }

    // signage
    const lv = louvres();
    this.sign = mk([signFace], new THREE.MeshStandardMaterial({ map: lv, roughness: 0.4, metalness: 0.5, emissive: 0xffffff, emissiveMap: lv, emissiveIntensity: 0 }), 'salim-sign', false);
    const redMat = new THREE.MeshStandardMaterial({ color: BRAND.signalRed, roughness: 0.35, metalness: 0.05, emissive: BRAND.signalRed, emissiveIntensity: 0 });
    this.signLetters = mk([signText.geo], redMat, 'salim-sign-letters', true, ['position', 'normal']);
    this.wallLetters = mk([wall.geo], redMat.clone(), 'salim-wall-letters', false, ['position', 'normal']);
    mk([hanzi], new THREE.MeshStandardMaterial({ map: chineseNameTexture(), alphaTest: 0.5, roughness: 0.38, metalness: 0.3 }), 'salim-wall-hanzi', false);
    this.cafeLetters = mk([cafe.geo], new THREE.MeshStandardMaterial({ color: 0xeef0f0, roughness: 0.55, metalness: 0.02, emissive: 0xfff6e8, emissiveIntensity: 0 }), 'cafe-letters', true, ['position', 'normal']);
    mk(terracotta, new THREE.MeshStandardMaterial({ color: FACADE.planter, roughness: 0.8 }), 'salim-planters');

    // planter greenery: broad leaves in clusters
    const leaf = new THREE.SphereGeometry(1, 7, 5);
    leaf.scale(0.36, 0.07, 0.17).translate(0.3, 0, 0);
    const perPlant = 18;
    const plants = new THREE.InstancedMesh(leaf, new THREE.MeshStandardMaterial({ color: 0x3f6b2f, roughness: 0.7 }), plantSpots.length * perPlant);
    let li = 0;
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (const p of plantSpots) {
      for (let k = 0; k < perPlant; k++) {
        e.set((rand() - 0.5) * 0.9, (k / perPlant) * Math.PI * 2 + rand() * 0.4, -0.3 - rand() * 0.9);
        q.setFromEuler(e);
        const sc = 0.8 + rand() * 1.0;
        plants.setMatrixAt(li++, new THREE.Matrix4().compose(new THREE.Vector3(p.x + (rand() - 0.5) * 0.8, p.y + rand() * 0.75, p.z + (rand() - 0.5) * 0.25), q, new THREE.Vector3(sc, sc, sc)));
      }
    }
    plants.castShadow = true;
    plants.name = 'salim-plants';
    this.props.add(plants);

    // cafe seating on the five-foot way (rec2_t180s): round tables, dark chairs
    const tableGeo = mergeAll([new THREE.CylinderGeometry(0.34, 0.34, 0.03, 20).translate(0, 0.74, 0), new THREE.CylinderGeometry(0.03, 0.03, 0.72, 8).translate(0, 0.37, 0), new THREE.CylinderGeometry(0.22, 0.22, 0.02, 14).translate(0, 0.01, 0)], ['position', 'normal']);
    const chairGeo = mergeAll([boxAt(-0.21, 0.44, -0.21, 0.21, 0.48, 0.21), boxAt(-0.21, 0.48, -0.21, 0.21, 0.9, -0.18), ...[[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]].map(([x, z]) => boxAt(x - 0.015, 0, z - 0.015, x + 0.015, 0.44, z + 0.015))], ['position', 'normal']);
    const tables: THREE.Matrix4[] = [];
    const chairs: THREE.Matrix4[] = [];
    for (let i = 0; i < 6; i++) {
      const tx = c0 + 0.9 + i * 1.55, tz = -1.55;
      tables.push(new THREE.Matrix4().makeTranslation(tx, GY, tz));
      for (const a of [0, Math.PI]) {
        const r = a + (rand() - 0.5) * 0.4;
        chairs.push(new THREE.Matrix4().makeRotationY(r + Math.PI / 2).setPosition(tx + Math.cos(r) * 0.55, GY, tz - Math.sin(r) * 0.55));
      }
    }
    const tableMesh = new THREE.InstancedMesh(tableGeo, new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 0.55 }), tables.length);
    tables.forEach((m, i) => tableMesh.setMatrixAt(i, m));
    const chairMesh = new THREE.InstancedMesh(chairGeo, new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 0.6 }), chairs.length);
    chairs.forEach((m, i) => chairMesh.setMatrixAt(i, m));
    tableMesh.castShadow = chairMesh.castShadow = true;
    tableMesh.name = 'cafe-tables';
    chairMesh.name = 'cafe-chairs';
    this.props.add(tableMesh, chairMesh);
    this.group.add(this.props);

    // AC units: body + fan grille, one instanced mesh with vertex colours
    this.acUnits = new THREE.InstancedMesh(acUnitGeometry(false), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }), acMatrices.length);
    acMatrices.forEach((m, i) => this.acUnits.setMatrixAt(i, m));
    this.acUnits.castShadow = true;
    this.acUnits.receiveShadow = true;
    this.acUnits.name = 'salim-ac';
    this.group.add(this.acUnits);

    // canopy downlights: three rows, switched on in sequence in chapter 4
    const lights: THREE.Vector3[] = [];
    for (const z of [1.15, -0.1, -1.4]) for (let x = 0.9; x < W - 0.4; x += 2.1) lights.push(new THREE.Vector3(x + (z === -0.1 ? 1.05 : 0), CAN_Y - 0.012, z));
    lights.sort((a, b) => a.x - b.x);
    this.downlightLocal = lights;
    const dlGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.02, 20);
    const dlMat = new THREE.MeshStandardMaterial({ color: 0xf6f3ea, roughness: 0.3, emissive: 0xffd9a8, emissiveIntensity: 1 });
    const idx = new Float32Array(lights.length);
    lights.forEach((_, i) => (idx[i] = i));
    const uOn = this.downlightUniform;
    dlMat.onBeforeCompile = (s) => {
      s.uniforms.uOn = uOn;
      Object.assign(s.uniforms, GLOBAL);
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float aIdx; varying float vIdx;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvIdx = aIdx;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uOn; varying float vIdx;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 4.5 * clamp(uOn - vIdx, 0.0, 1.0);');
    };
    dlMat.customProgramCacheKey = () => 'downlights';
    this.downlights = new THREE.InstancedMesh(dlGeo, dlMat, lights.length);
    lights.forEach((p, i) => this.downlights.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
    this.downlights.geometry.setAttribute('aIdx', new THREE.InstancedBufferAttribute(idx, 1));
    this.downlights.name = 'salim-downlights';
    this.group.add(this.downlights);
  }

  /** 0 = closed, 1 = open: the middle pair swings in on its floor springs. */
  setDoor(open: number): void {
    const a = DOOR_SWING * open * open * (3 - 2 * open);
    this.doorLeaves[0].rotation.y = a;
    this.doorLeaves[1].rotation.y = -a;
  }

  /** Whether the real lobby is drawn behind the entrance (else the veil is). */
  setLobbyShown(shown: boolean): void {
    this.lobbyVeil.visible = !shown;
  }

  /** Dusk state: sign/letters glow with `lights`; canopy downlights count up. */
  setDusk(lights: number, downlightsOn: number): void {
    (this.sign.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.55 * lights;
    (this.signLetters.material as THREE.MeshStandardMaterial).emissiveIntensity = 5.5 * lights;
    (this.wallLetters.material as THREE.MeshStandardMaterial).emissiveIntensity = 3.2 * lights;
    (this.cafeLetters.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.9 * lights;
    this.downlightUniform.value = downlightsOn;
  }

  get downlightCount(): number {
    return this.downlights.count;
  }

  /** The downlight wash (warm pools and wall scallops) for the canopy zone:
   *  applied to this block's surfaces under the canopy and to `extra`
   *  materials outside it (the car park paving). */
  applyWash(extra: THREE.MeshStandardMaterial[] = []): void {
    this.group.updateMatrixWorld(true);
    const lights = this.downlightLocal.map((p) => p.clone().applyMatrix4(this.group.matrixWorld));
    const w: Wash = {
      lights,
      on: this.downlightUniform,
      toLocal: this.group.matrixWorld.clone().invert(),
      box: new THREE.Vector4(-S.dropOffCanopy - 1, W + 1.5, -FFW - 0.5, 7.5),
      intensity: 20,
    };
    const names = new Set(['salim-tiles', 'salim-walkway', 'salim-concrete', 'salim-white', 'salim-charcoal', 'salim-stone', 'salim-planters', 'salim-door-bands', 'salim-mosaic', 'salim-wall-hanzi']);
    const mats = new Set<THREE.MeshStandardMaterial>(extra);
    for (const m of this.meshes) if (names.has(m.name)) mats.add(m.material as THREE.MeshStandardMaterial);
    this.props.traverse((o) => { if ((o as THREE.Mesh).isMesh) mats.add((o as THREE.Mesh).material as THREE.MeshStandardMaterial); });
    for (const m of mats) downlightWash(m, w);
  }
}
