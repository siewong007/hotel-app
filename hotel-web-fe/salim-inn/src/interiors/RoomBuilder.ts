// Room configurator (brief §3 ch. 6, §4.5, §6.8): one guest room above the
// lobby that reconfigures into each of the five types. Switching type is a
// choreographed ~0.85 s transition, not a fade-swap: the left wall and the
// ensuite slide to the new footprint, beds and furniture glide to their new
// places (or swap with a quick scale-out/scale-in when the piece changes or
// moves to another wall), the curtains change and draw, and the window panel
// slides shut for the Family Suite. A new selection mid-transition retargets
// from wherever everything currently is.
import * as THREE from 'three';
import { PLAN } from '../world/SalimInnBuilding';
import { FLOOR_Y } from '../config/dimensions';
import type { RoomCode } from '../config/site';
import { batchPlain, boxAt, mergeStatic, metricUV, packGroups, rbox, wallWithOpenings } from '../world/geom';
import { CULLED_LAYER } from '../world/Visibility';
import { RoomMats } from './roomMaterials';
import { PublicMats } from './lobbyMaterials';
import {
  Curtains, makeArt, makeAC, makeBasin, makeBed, makeChair, makeDesk, makeLuggageRack, makeMirror, makeNightstand,
  makePlate, makeToilet, makeTowelRack, makeTV, makeWardrobe, NIGHTSTAND_WIDTH,
} from './roomProps';
import { BATH, DOOR, ROOM_HEIGHT, WINDOW, Z_CORRIDOR, Z_FACADE, roomLayouts, type LayoutItem, type RoomLayout } from './roomLayouts';

const W_MAX = 7.9; // wide enough for the Family Suite; the left wall hides the rest
const BULK = 0.3; // bulkhead ring width
const BULK_Y = 2.8;
const DUR = 0.85;

interface Pose { x: number; y: number; z: number; rotY: number; s: number }
interface Entry { obj: THREE.Object3D; from: Pose; to: Pose; mode: 'glide' | 'out' | 'in' }

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerpAngle = (a: number, b: number, t: number) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

function makeItem(li: LayoutItem): THREE.Object3D {
  const g = buildItem(li);
  g.userData.kind = li.kind;
  batchPlain(g);
  mergeStatic(g); // each piece moves as one: one draw per material
  return g;
}

function buildItem(li: LayoutItem): THREE.Object3D {
  switch (li.kind) {
    case 'bed': return makeBed(li.bed!.size, li.bed!.style);
    case 'nightstand': return makeNightstand(true, li.variant === 'nightstand-narrow' ? NIGHTSTAND_WIDTH.narrow : NIGHTSTAND_WIDTH.standard);
    case 'wardrobe': return makeWardrobe();
    case 'desk': return makeDesk(true);
    case 'mirror': return makeMirror();
    case 'chair': return makeChair();
    case 'tv': return makeTV();
    case 'ac': return makeAC();
    case 'luggage': return makeLuggageRack();
    case 'art': return makeArt(li.art ?? 'banana');
  }
}

export class RoomBuilder {
  readonly group = new THREE.Group();
  readonly layouts = roomLayouts();
  readonly light: THREE.SpotLight;
  readonly fill: THREE.SpotLight;
  current: RoomLayout;
  /** Called when a transition starts (code) — the configurator UI listens. */
  onChange: ((code: RoomCode) => void) | null = null;

  /** Rebuilt on every change of room type (World keeps it out of the
   *  measured visibility, world/Visibility.ts). */
  readonly furniture = new THREE.Group();
  private pool = new Map<string, THREE.Object3D>();
  private active = new Map<string, THREE.Object3D>();
  private entries = new Map<string, Entry>();
  private t = 1;
  private width: number;
  private wFrom = 0;
  private wTo = 0;
  private leftWall: THREE.Group;
  private scaled: THREE.Object3D[] = []; // meshes that stretch from −w to 0
  private bath: THREE.Group;
  private shutter: THREE.Mesh;
  private shut = { from: 0, to: 0, v: 0 };
  private curtains: Record<'navy' | 'sage', Curtains>;
  private curt = { from: { navy: 1, sage: 0, open: 0, span: 3 }, to: { navy: 1, sage: 0, open: 0, span: 3 }, now: { navy: 1, sage: 0, open: 0, span: 3 } };
  private railBase = 3;
  private railX1 = 0;
  private leftWallMesh!: THREE.Mesh;
  private corridorWall!: THREE.Mesh;
  private doorLeaf: THREE.Group;
  private showerCurtains: Record<'blue' | 'white', THREE.Mesh>;
  private fittings: THREE.Mesh[] = [];
  /** Other objects on the corridor face of the room's corridor wall (the
   *  corridor's own finish, doors, plaques): the cutaway hides them with it. */
  readonly corridorFace: THREE.Object3D[] = [];

  constructor(initial: RoomCode = 'DLX') {
    this.current = this.layouts[initial] ?? Object.values(this.layouts)[0];
    this.width = this.current.width;
    this.group.position.set(PLAN.showcaseRight, FLOOR_Y.level1, 0);
    this.group.name = 'room';

    // ------------------------------------------------------------ fixed shell
    const shell = new THREE.Group();
    // the finish sits 12 mm proud of the structural slab (coplanar faces z-fight)
    const floor = new THREE.Mesh(metricUV(boxAt(-W_MAX, 0, Z_CORRIDOR - 0.2, 0.1, 0.012, Z_FACADE)), RoomMats.floor());
    const lam = RoomMats.floor() as THREE.MeshStandardMaterial;
    for (const t of [lam.map, lam.normalMap, lam.roughnessMap]) if (t) t.repeat.set(1 / 2.4, 1 / 2.4);
    floor.receiveShadow = true;
    floor.name = 'room-floor';
    const ceiling = new THREE.Mesh(boxAt(-W_MAX, ROOM_HEIGHT, Z_CORRIDOR, 0.1, ROOM_HEIGHT + 0.03, Z_FACADE), RoomMats.ceiling());
    ceiling.name = 'room-ceiling';
    const right = new THREE.Mesh(boxAt(0, 0, Z_CORRIDOR, 0.12, ROOM_HEIGHT, Z_FACADE), RoomMats.wall());
    right.name = 'room-wall-right';
    // facade lining (peach) with the window opening
    const lining = new THREE.Mesh(
      wallWithOpenings(W_MAX, ROOM_HEIGHT, 0.015, [{ u0: WINDOW.x0 + W_MAX, u1: WINDOW.x1 + W_MAX, v0: WINDOW.sill, v1: WINDOW.head }]).translate(-W_MAX, 0, Z_FACADE),
      RoomMats.wall(),
    );
    lining.name = 'room-lining';
    // corridor wall with the entry door opening
    const corridorWall = new THREE.Mesh(
      wallWithOpenings(W_MAX + 0.12, ROOM_HEIGHT, 0.2, [{ u0: DOOR.x0 + W_MAX, u1: DOOR.x1 + W_MAX, v0: 0, v1: DOOR.h }]).translate(-W_MAX, 0, Z_CORRIDOR),
      RoomMats.wall(),
    );
    corridorWall.name = 'room-wall-corridor';
    this.corridorWall = corridorWall;
    // bulkhead ring pieces on the fixed walls
    const bulkRight = new THREE.Mesh(boxAt(-BULK, BULK_Y, Z_CORRIDOR, 0, ROOM_HEIGHT, Z_FACADE), RoomMats.ceiling());
    // skirting on the fixed walls
    const skirt = RoomMats.skirting();
    const skirtRight = new THREE.Mesh(boxAt(-0.012, 0, Z_CORRIDOR, 0, 0.08, Z_FACADE), skirt);
    const skirtDoorSide = new THREE.Mesh(boxAt(DOOR.x1, 0, Z_CORRIDOR, 0, 0.08, Z_CORRIDOR + 0.012), skirt);
    for (const m of [ceiling, right, lining, corridorWall, bulkRight, skirtRight, skirtDoorSide]) { m.receiveShadow = true; m.castShadow = m !== ceiling; }
    shell.add(floor, ceiling, right, lining, corridorWall, bulkRight, skirtRight, skirtDoorSide);
    // switch plates by the door and the bedhead positions
    for (const [x, y, z, r] of [[DOOR.x1 + 0.12, 1.3, Z_CORRIDOR, -Math.PI / 2], [-0.001, 1.1, -3.3, Math.PI]] as const) {
      const p = makePlate();
      p.position.set(x, y, z);
      p.rotation.y = r;
      shell.add(p);
    }

    // stretch pieces: unit length from x = −1 … 0, scaled by the width
    const stretch = (g: THREE.BufferGeometry, m: THREE.Material, name: string) => {
      const o = new THREE.Mesh(g, m);
      o.name = name;
      o.receiveShadow = true;
      this.scaled.push(o);
      shell.add(o);
    };
    stretch(boxAt(-1, BULK_Y, Z_FACADE - BULK, 0, ROOM_HEIGHT, Z_FACADE), RoomMats.ceiling(), 'bulk-facade');
    stretch(boxAt(-1, BULK_Y, Z_CORRIDOR, 0, ROOM_HEIGHT, Z_CORRIDOR + BULK), RoomMats.ceiling(), 'bulk-corridor');
    stretch(boxAt(-1, 0, Z_FACADE - 0.027, 0, 0.08, Z_FACADE - 0.015), skirt, 'skirt-facade');

    // ------------------------------------------------------------ left wall + ensuite (move with the width)
    this.leftWall = new THREE.Group();
    const lw = new THREE.Mesh(boxAt(-0.12, 0, Z_CORRIDOR, 0, ROOM_HEIGHT, Z_FACADE), RoomMats.wall());
    lw.name = 'room-wall-left';
    this.leftWallMesh = lw;
    const bulkLeft = new THREE.Mesh(boxAt(0, BULK_Y, Z_CORRIDOR, BULK, ROOM_HEIGHT, Z_FACADE), RoomMats.ceiling());
    const skirtLeft = new THREE.Mesh(boxAt(0, 0, Z_CORRIDOR, 0.012, 0.08, Z_FACADE), skirt);
    // corridor-wall skirting between the left wall and the door (stretches)
    for (const m of [lw, bulkLeft, skirtLeft]) { m.castShadow = true; m.receiveShadow = true; }
    this.leftWall.add(lw, bulkLeft, skirtLeft);
    this.bath = this.buildBath();
    this.showerCurtains = {
      blue: this.bath.getObjectByName('shower-blue') as THREE.Mesh,
      white: this.bath.getObjectByName('shower-white') as THREE.Mesh,
    };
    this.leftWall.add(this.bath);
    stretch(boxAt(-1, 0, Z_CORRIDOR, 0, 0.08, Z_CORRIDOR + 0.012), skirt, 'skirt-corridor');

    // window panel that slides shut for the Family Suite (hidden behind the right wall when open)
    this.shutter = new THREE.Mesh(boxAt(WINDOW.x0 - 0.05, WINDOW.sill - 0.05, Z_FACADE - 0.012, WINDOW.x1 + 0.05, WINDOW.head + 0.05, Z_FACADE + 0.19), RoomMats.wall());
    this.shutter.name = 'window-panel';
    this.shutter.castShadow = true;

    // curtains on the window wall (rail along −x from the right-hand end)
    // built at the longest rail; each type scales it to its own span
    const railX1 = Math.min(-0.08, WINDOW.x1 + 0.3);
    this.railBase = railX1 - Math.min(...Object.values(this.layouts).map((l) => l.railFrom));
    this.railX1 = railX1;
    this.curtains = { navy: new Curtains(this.railBase, 2.52, 'navy'), sage: new Curtains(this.railBase, 2.52, 'sage') };
    for (const c of Object.values(this.curtains)) {
      c.group.position.set(railX1, 0, Z_FACADE - 0.015);
      c.group.rotation.y = Math.PI;
      shell.add(c.group);
    }

    // entry door leaf (swings into the room in chapter 6)
    this.doorLeaf = this.buildDoor();
    shell.add(this.doorLeaf);

    // lights: two warm ceiling downlights (spots, so the ceiling itself is
    // not hot-spotted) with emissive fittings; the room environment fills in
    this.light = new THREE.SpotLight(0xffdcb4, 0, 11, 1.05, 0.9, 1.6);
    this.fill = new THREE.SpotLight(0xffe6c8, 0, 9, 1.0, 0.9, 1.6);
    const fittings = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.02, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe2bd).multiplyScalar(2.2), toneMapped: false }));
    this.fittings = [disc, disc.clone()];
    fittings.add(...this.fittings);
    this.group.add(shell, this.leftWall, this.shutter, this.furniture, this.light, this.fill, this.light.target, this.fill.target, fittings);

    this.select(this.current.code, true);
  }

  // ---------------------------------------------------------------- builders
  private buildBath(): THREE.Group {
    const g = new THREE.Group();
    g.name = 'ensuite';
    const zc = Z_CORRIDOR, zb = Z_CORRIDOR + BATH.d, xw = BATH.w, h = 2.4;
    const wall = RoomMats.wall();
    const tiles = RoomMats.tileWall();
    const floorT = RoomMats.tileFloor();
    // bathroom walls (room faces peach): along z at x = xw with the door, along x at z = zb
    const dz0 = zc + 0.35, dz1 = zc + 1.15;
    const walls = [
      boxAt(xw, 0, zc, xw + 0.1, ROOM_HEIGHT, dz0),
      boxAt(xw, 0, dz1, xw + 0.1, ROOM_HEIGHT, zb + 0.1),
      boxAt(xw, 2.05, dz0, xw + 0.1, ROOM_HEIGHT, dz1),
      boxAt(0, 0, zb, xw + 0.1, ROOM_HEIGHT, zb + 0.1),
    ];
    for (const geo of walls) {
      const m = new THREE.Mesh(geo, wall);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    }
    // tiled inside faces, floor and a lowered ceiling
    const tile = (geo: THREE.BufferGeometry, mat: THREE.Material) => { const m = new THREE.Mesh(metricUV(geo), mat); m.receiveShadow = true; g.add(m); };
    tile(boxAt(0.001, 0, zc + 0.001, xw - 0.001, h, zc + 0.012), tiles);
    tile(boxAt(0.001, 0, zb - 0.012, xw - 0.001, h, zb - 0.001), tiles);
    tile(boxAt(0.001, 0, zc, 0.012, h, zb), tiles);
    tile(boxAt(xw - 0.012, 0, zc, xw - 0.001, h, dz0), tiles);
    tile(boxAt(xw - 0.012, 0, dz1, xw - 0.001, h, zb), tiles);
    tile(boxAt(0, 0.002, zc, xw, 0.012, zb), floorT);
    g.add(new THREE.Mesh(boxAt(0, h, zc, xw, h + 0.03, zb), RoomMats.ceiling()));
    for (const t of [(tiles as THREE.MeshStandardMaterial).map, (floorT as THREE.MeshStandardMaterial).map]) if (t) t.repeat.set(1 / 1.2, 1 / 1.2);
    // fittings on the left (outer) wall: basin + mirror by the door, WC with
    // the towel shelf above it, shower at the far end behind a curtain
    const basin = makeBasin();
    basin.position.set(0, 0, zc + 0.75);
    const mirror = makeMirror(0.55, 0.7);
    mirror.position.set(0.012, 1.5, zc + 0.75);
    const wc = makeToilet();
    wc.position.set(0, 0, zb - 0.95);
    const rack = makeTowelRack();
    rack.position.set(0.012, 1.85, zb - 0.95);
    g.add(basin, mirror, wc, rack);
    // shower corner: rail + curtain along x, 0.8 m from the room-side wall
    const railZ = zb - 0.5;
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, xw, 8).rotateZ(Math.PI / 2).translate(xw / 2, 2.05, railZ), RoomMats.chrome()));
    for (const tone of ['blue', 'white'] as const) {
      const geo = new THREE.PlaneGeometry(xw * 0.7, 1.9, 40, 1);
      const p = geo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 28) * 0.03);
      geo.computeVertexNormals();
      const c = new THREE.Mesh(geo, RoomMats.showerCurtain(tone));
      c.position.set(xw * 0.35 + 0.05, 1.07, railZ);
      c.name = `shower-${tone}`;
      g.add(c);
    }
    // frosted glass door, a little ajar
    const door = new THREE.Group();
    door.position.set(xw + 0.05, 0, dz0);
    const leaf = new THREE.Mesh(boxAt(-0.015, 0.01, 0, 0.015, 2.03, dz1 - dz0 - 0.02), RoomMats.frosted());
    const pull = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8).translate(0.04, 1.05, dz1 - dz0 - 0.12), RoomMats.chrome());
    door.add(leaf, pull);
    door.rotation.y = -0.35;
    g.add(door);
    // the ensuite never changes shape; only the two shower curtains swap
    const curtains = [g.getObjectByName('shower-blue')!, g.getObjectByName('shower-white')!];
    batchPlain(g, curtains);
    mergeStatic(g, curtains);
    return g;
  }

  private buildDoor(): THREE.Group {
    const hinge = new THREE.Group();
    hinge.position.set(DOOR.x1 - 0.02, 0, Z_CORRIDOR - 0.1);
    hinge.name = 'room-door';
    const w = DOOR.x1 - DOOR.x0 - 0.04;
    // the corridor doors' walnut veneer (lobbyMaterials)
    const leaf = new THREE.Mesh(metricUV(rbox(-w, 0.01, -0.02, 0, DOOR.h - 0.01, 0.02, 0.006)), PublicMats.door());
    leaf.castShadow = true;
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.13, 8).rotateZ(Math.PI / 2).translate(-w + 0.12, 1.02, 0.05), RoomMats.chrome());
    const lever2 = lever.clone();
    lever2.position.z = -0.1;
    hinge.add(leaf, lever, lever2);
    return hinge;
  }

  // ---------------------------------------------------------------- selection & transitions
  get code(): RoomCode {
    return this.current.code;
  }

  get transitioning(): boolean {
    return this.t < 1;
  }

  /** Switch to a room type: choreographed (default) or instant. */
  select(code: RoomCode, instant = false): void {
    const target = this.layouts[code];
    if (!target) return;
    const changed = target !== this.current;
    this.current = target;
    // snapshot what is on screen now
    const now = new Map<string, Pose>();
    for (const [key, obj] of this.active) {
      now.set(key, { x: obj.position.x, y: obj.position.y, z: obj.position.z, rotY: obj.rotation.y, s: obj.scale.x });
    }
    const to = new Map<string, { li: LayoutItem; pose: Pose }>();
    for (const li of target.items) to.set(`${li.slot}|${li.variant}`, { li, pose: { x: li.x, y: li.y, z: li.z, rotY: li.rotY, s: 1 } });
    const slotOf = (key: string) => key.split('|')[0];
    const bySlotTo = new Map<string, Pose>();
    for (const [key, v] of to) bySlotTo.set(slotOf(key), v.pose);
    const bySlotNow = new Map<string, Pose>();
    for (const [key, p] of now) bySlotNow.set(slotOf(key), p);
    const sameWall = (a: Pose, b: Pose) => Math.abs(Math.cos(a.rotY) - Math.cos(b.rotY)) < 0.2;

    this.entries.clear();
    for (const [key, p] of now) {
      const obj = this.active.get(key)!;
      if (to.has(key)) {
        const dest = to.get(key)!.pose;
        this.entries.set(key, { obj, from: p, to: sameWall(p, dest) ? dest : { ...p, s: 0 }, mode: sameWall(p, dest) ? 'glide' : 'out' });
        if (!sameWall(p, dest)) {
          // moving to the other wall: this copy shrinks away, a fresh one grows in
          this.entries.set(`${key}#in`, { obj: this.obtain(`${key}#in`, to.get(key)!.li), from: { ...dest, s: 0 }, to: dest, mode: 'in' });
        }
      } else {
        const next = bySlotTo.get(slotOf(key));
        const dest = next && sameWall(p, next) ? { ...next, s: 0 } : { ...p, s: 0 };
        this.entries.set(key, { obj, from: p, to: dest, mode: 'out' });
      }
    }
    for (const [key, v] of to) {
      if (now.has(key)) continue;
      const prev = bySlotNow.get(slotOf(key));
      const from = prev && sameWall(prev, v.pose) ? { ...prev, s: 0 } : { ...v.pose, s: 0 };
      this.entries.set(key, { obj: this.obtain(key, v.li), from, to: v.pose, mode: 'in' });
    }
    // walls, window panel, curtains
    this.wFrom = this.width;
    this.wTo = target.width;
    this.shut.from = this.shut.v;
    this.shut.to = target.window ? 0 : 1;
    this.curt.from = { ...this.curt.now };
    this.curt.to = { navy: target.curtain === 'navy' ? 1 : 0, sage: target.curtain === 'sage' ? 1 : 0, open: target.curtainOpen, span: this.railX1 - target.railFrom };
    this.showerCurtains.blue.visible = target.shower === 'blue';
    this.showerCurtains.white.visible = target.shower === 'white';
    this.t = instant ? 1 : 0;
    this.apply(instant ? 1 : 0);
    if (instant) this.settle();
    if (changed && !instant) this.onChange?.(code);
  }

  private make(li: LayoutItem): THREE.Object3D {
    const obj = makeItem(li);
    // receive the building's shadows; casting into the sun's map is not worth the draws indoors (World)
    obj.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      o.castShadow = false;
      o.receiveShadow = true;
      packGroups(o as THREE.Mesh);
    });
    return obj;
  }

  /** A type's pieces made ahead, into the pool (World.buildInterior, a type
   *  per slice): the first switch to a type made them on the click, ~150 ms
   *  of geometry, and its next frame compiled shaders nothing had used yet.
   *  Returns the new pieces, for World to compile and draw once. */
  prebuild(code: RoomCode): THREE.Object3D[] {
    const made: THREE.Object3D[] = [];
    for (const li of this.layouts[code]?.items ?? []) {
      const key = `${li.slot}|${li.variant}`;
      // and the copy that grows in when a piece changes wall (select)
      for (const k of [key, `${key}#in`]) {
        if (this.pool.has(k)) continue;
        const obj = this.make(li);
        this.pool.set(k, obj);
        made.push(obj);
      }
    }
    return made;
  }

  private obtain(key: string, li: LayoutItem): THREE.Object3D {
    let obj = this.pool.get(key);
    if (!obj) {
      obj = this.make(li);
      this.pool.set(key, obj);
    }
    obj.scale.setScalar(0.0001);
    this.streetLayer(obj);
    this.furniture.add(obj);
    this.active.set(key, obj);
    return obj;
  }

  private apply(t: number): void {
    const e = easeInOut(t);
    this.width = THREE.MathUtils.lerp(this.wFrom, this.wTo, e);
    this.leftWall.position.x = -this.width;
    for (const o of this.scaled) o.scale.x = this.width;
    this.shut.v = THREE.MathUtils.lerp(this.shut.from, this.shut.to, e);
    this.shutter.position.x = (1 - this.shut.v) * 3.2; // slides in from behind the right-hand wall
    this.shutter.visible = this.shut.v > 0.002;
    const c = this.curt;
    c.now = { navy: THREE.MathUtils.lerp(c.from.navy, c.to.navy, e), sage: THREE.MathUtils.lerp(c.from.sage, c.to.sage, e), open: THREE.MathUtils.lerp(c.from.open, c.to.open, e), span: THREE.MathUtils.lerp(c.from.span, c.to.span, e) };
    for (const tone of ['navy', 'sage'] as const) {
      const cur = this.curtains[tone];
      cur.group.scale.y = Math.max(0.0001, c.now[tone]);
      cur.group.scale.x = c.now.span / this.railBase;
      cur.group.visible = c.now[tone] > 0.002;
      cur.setOpen(c.now.open);
    }
    for (const en of this.entries.values()) {
      // position: glides use the whole transition; swaps move with it too
      const kk = e;
      // scale: swap-outs shrink over the first 55 %, swap-ins grow over the last 65 %
      const ks = en.mode === 'glide' ? e : en.mode === 'out' ? easeInOut(Math.min(1, t / 0.55)) : easeInOut(THREE.MathUtils.clamp((t - 0.35) / 0.65, 0, 1));
      en.obj.position.set(THREE.MathUtils.lerp(en.from.x, en.to.x, kk), THREE.MathUtils.lerp(en.from.y, en.to.y, kk), THREE.MathUtils.lerp(en.from.z, en.to.z, kk));
      en.obj.rotation.y = lerpAngle(en.from.rotY, en.to.rotY, kk);
      en.obj.scale.setScalar(Math.max(0.0001, THREE.MathUtils.lerp(en.from.s, en.to.s, ks)));
    }
    // lights follow the room's centre
    const zc = (Z_FACADE + Z_CORRIDOR) / 2 + 0.6;
    this.light.position.set(-this.width / 2, ROOM_HEIGHT - 0.05, zc);
    this.light.target.position.set(-this.width / 2, 0, zc);
    this.fill.position.set(-this.width / 2, ROOM_HEIGHT - 0.05, Z_FACADE - 1.4);
    this.fill.target.position.set(-this.width / 2, 0, Z_FACADE - 1.4);
    this.fittings[0]?.position.set(-this.width / 2, ROOM_HEIGHT - 0.01, zc);
    this.fittings[1]?.position.set(-this.width / 2, ROOM_HEIGHT - 0.01, Z_FACADE - 1.4);
  }

  private streetView = false;
  /** Shell meshes the street never sees through the window (below). */
  private streetHidden: THREE.Object3D[] | null = null;
  /** Seen from the street (chapters 3–4 and 7–8), the room shows only
   *  through its window: perf/probe.ts `roomparts`, every room type from
   *  every exterior frame, found the window panel, curtains, walls, floor,
   *  ceiling, the en-suite and the beds; every other piece drew 0–6 px of a
   *  480 px frame. The rest go to the culled layer there (not `visible`,
   *  which the room's own transitions and cut-aways drive). */
  setStreetView(on: boolean): void {
    if (on === this.streetView) return;
    this.streetView = on;
    if (!this.streetHidden) {
      const keep = new Set(['window-panel', 'room-floor', 'room-ceiling', 'room-wall-right', 'room-wall-left', 'room-wall-corridor', 'room-lining', 'bulk-corridor', '', '?', 'merged']);
      const own = new Set<THREE.Object3D>([this.furniture, this.shutter, this.bath, this.curtains.navy.group, this.curtains.sage.group]);
      this.streetHidden = [];
      const visit = (o: THREE.Object3D) => {
        if (own.has(o)) return;
        if ((o as THREE.Mesh).isMesh && !keep.has(o.name)) this.streetHidden!.push(o);
        for (const c of o.children) visit(c);
      };
      visit(this.group);
    }
    for (const o of this.streetHidden) o.layers.set(on ? CULLED_LAYER : 0);
    for (const obj of this.furniture.children) this.streetLayer(obj);
  }

  private far = false;
  /** Farther out (the approach in chapter 3, the climb in chapter 7) the
   *  window is a few pixels across: the en-suite and the beds go to the
   *  culled layer too, leaving the shell, the window and its curtains, and
   *  the panel that closes the Family Suite's window. World picks the
   *  distance (perf/probe.ts `roomfar`). */
  setFar(on: boolean): void {
    if (on === this.far) return;
    this.far = on;
    this.bath.traverse((o) => o.layers.set(on ? CULLED_LAYER : 0));
    for (const obj of this.furniture.children) this.streetLayer(obj);
  }

  private streetLayer(obj: THREE.Object3D): void {
    const hide = this.far || (this.streetView && obj.userData.kind !== 'bed');
    obj.traverse((o) => o.layers.set(hide ? CULLED_LAYER : 0));
  }

  /** Drop finished swap-outs and rename swap-ins to their stable keys. */
  private settle(): void {
    for (const [key, en] of this.entries) {
      if (en.mode !== 'out') continue;
      this.furniture.remove(en.obj);
      if (this.active.get(key) === en.obj) this.active.delete(key);
    }
    for (const [key, en] of this.entries) {
      if (!key.endsWith('#in')) continue;
      const base = key.slice(0, -3);
      const old = this.pool.get(base);
      this.pool.set(base, en.obj);
      if (old && old !== en.obj) this.pool.set(key, old);
      this.active.delete(key);
      this.active.set(base, en.obj);
    }
    this.entries.clear();
  }

  private readonly bedBox = new THREE.Box3();
  private readonly bedAt = new THREE.Vector3();
  /** Centre of the beds, world space (depth of field's subject in the
   *  room); beds on their way in or out count by their scale. */
  bedCentre(out: THREE.Vector3): THREE.Vector3 | null {
    out.set(0, 0, 0);
    let w = 0;
    for (const obj of this.furniture.children) {
      if (obj.userData.kind !== 'bed' || obj.scale.x < 0.01) continue;
      out.addScaledVector(this.bedBox.setFromObject(obj).getCenter(this.bedAt), obj.scale.x);
      w += obj.scale.x;
    }
    return w > 0 ? out.divideScalar(w) : null;
  }

  update(dt: number): void {
    if (this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / DUR);
    this.apply(this.t);
    if (this.t >= 1) this.settle();
  }

  /** 0 closed … 1 open (chapter 6). */
  setDoor(open: number): void {
    // hinged on the right-hand jamb, opening into the room (+z)
    this.doorLeaf.rotation.y = Math.PI * 0.52 * THREE.MathUtils.smoothstep(open, 0, 1);
  }

  /** Curtains override for the chapter-7 exit through the window. */
  openCurtainsForExit(v: number): void {
    const open = THREE.MathUtils.lerp(this.curt.now.open, 1, THREE.MathUtils.clamp(v, 0, 1));
    for (const tone of ['navy', 'sage'] as const) this.curtains[tone].setOpen(open);
  }

  setLights(v: number): void {
    this.light.intensity = 26 * v;
    this.fill.intensity = 14 * v;
  }

  /** Hide the ensuite while a camera (room-local) stands inside its footprint
   *  — the Family Room photo was taken from about where it sits. */
  cutawayFor(local: THREE.Vector3 | null): void {
    const w = this.width;
    const outLeft = !!local && local.x < -w - 0.02;
    const outCorridor = !!local && local.z < Z_CORRIDOR - 0.02;
    const inBath = !!local && local.x < -w + BATH.w + 0.25 && local.z < Z_CORRIDOR + BATH.d + 0.25;
    // an architectural cutaway: walls between an outside camera and the room step aside
    this.bath.visible = !(inBath || outLeft || outCorridor);
    this.leftWallMesh.visible = !outLeft;
    this.corridorWall.visible = !outCorridor;
    this.doorLeaf.visible = !outCorridor;
    for (const o of this.corridorFace) o.visible = !outCorridor;
  }

  /** Current width (for camera views that sit relative to the left wall). */
  get currentWidth(): number {
    return this.width;
  }
}
