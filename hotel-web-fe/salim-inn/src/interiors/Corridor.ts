// Stair core and the level-1 corridor (brief §4.5): a dog-leg stair with
// terrazzo treads on a folded-plate soffit and a steel balustrade round the
// well the camera rises through; the level-1 landing; and the corridor with
// carpet, doors and room-number plaques 101–114, wall sconces and downlights.
// No corridor photo exists: the finishes are designed (flagged), and the
// numbering is a placeholder sequence — odd numbers on the facade side, even
// behind, rising from the corner end; the showcase room is 103.
// Built in the Salim block frame; the corridor runs along x at level 1.
import * as THREE from 'three';
import { PLAN } from '../world/SalimInnBuilding';
import { FLOOR_Y } from '../config/dimensions';
import { SALIM_WIDTH } from '../world/layout';
import { batchPlain, boxAt, mergeAll, mergeStatic, metricUV, wallWithOpenings } from '../world/geom';
import { plaqueTexture, PublicMats, sconceWash } from './lobbyMaterials';

const Y1 = FLOOR_Y.level1;
const CEIL = 2.7; // corridor ceiling above the level-1 floor
export const DOOR_W = 0.96;
const DOOR_H = 2.08;
/** Door centres along the corridor: [x, number]. Front doors are fixed clear
 *  of the configurator room's widest footprint, bar its own (103). */
export const FRONT_DOORS: [number, number][] = [[1.05, 101], [(PLAN.showcaseDoor.x0 + PLAN.showcaseDoor.x1) / 2, 103], [11.0, 105], [13.45, 107], [15.9, 109], [18.35, 111], [20.8, 113]];
export const BACK_DOORS: [number, number][] = [[1.3, 102], [4.3, 104], [7.3, 106], [13.9, 108], [16.5, 110], [19.1, 112], [21.55, 114]];
export const SHOWCASE_NUMBER = 103;

function mesh(g: THREE.BufferGeometry, m: THREE.Material, name = '', shadow = true): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.name = name;
  o.castShadow = shadow;
  o.receiveShadow = true;
  return o;
}

export class Corridor {
  readonly group = new THREE.Group();
  readonly light: THREE.PointLight;
  /** Everything mounted on the corridor face of the room wall — the
   *  configurator's cutaway hides it with that wall (Family Room view). */
  readonly frontWall = new THREE.Group();
  private stairLight: THREE.PointLight;
  private lit: { m: THREE.MeshBasicMaterial; base: THREE.Color }[] = [];

  constructor() {
    const s = PLAN.stair;
    const W = SALIM_WIDTH;
    const cz0 = PLAN.corridor.z0, cz1 = PLAN.corridor.z1; // back, front faces
    const x0 = 0.2, x1 = W - 0.2;
    const plaster = PublicMats.plaster();
    const wallMat = PublicMats.corridorWall();
    const skirt = PublicMats.walnut();

    // ------------------------------------------------------------ stair
    const n = 12, rise = Y1 / (2 * n), run = 0.27, fw = 0.88;
    const nose = 0.025, tread = 0.03, plate = 0.16;
    const treads: THREE.BufferGeometry[] = [];
    const bodies: THREE.BufferGeometry[] = [];
    const z1Start = s.z1 - 0.3; // flight 1 climbs from here towards −z
    const z2Start = z1Start - n * run - 1.0; // flight 2 climbs back towards +z
    for (let i = 0; i < n; i++) {
      // flight 1: party-wall side
      {
        const za = z1Start - (i + 1) * run, zb = z1Start - i * run, y = (i + 1) * rise;
        treads.push(boxAt(s.x1 - fw, y - tread, za, s.x1, y, zb + nose));
        bodies.push(boxAt(s.x1 - fw, Math.max(0, y - rise - plate), za, s.x1, y - tread, zb));
      }
      // flight 2: lobby side, back towards the corridor
      {
        const za = z2Start + i * run, zb = z2Start + (i + 1) * run, y = Y1 / 2 + (i + 1) * rise;
        treads.push(boxAt(s.x0, y - tread, za - nose, s.x0 + fw, y, zb));
        bodies.push(boxAt(s.x0, y - rise - plate, za, s.x0 + fw, y - tread, zb));
      }
    }
    // mid landing and the level-1 landing over the void
    const midZ = z1Start - n * run;
    treads.push(boxAt(s.x0, Y1 / 2 - tread, s.z0 + 0.2, s.x1, Y1 / 2, midZ));
    bodies.push(boxAt(s.x0, Y1 / 2 - plate - tread, s.z0 + 0.2, s.x1, Y1 / 2 - tread, midZ));
    const topZ = z2Start + n * run; // where flight 2 arrives
    treads.push(boxAt(s.x0, Y1 - tread, topZ, s.x1, Y1, s.z1));
    bodies.push(boxAt(s.x0, Y1 - 0.25, topZ, s.x1, Y1 - tread, s.z1));
    const treadMesh = mesh(metricUV(mergeAll(treads, ['position', 'normal', 'uv'])), PublicMats.terrazzo(), 'stair-treads');
    const bodyMesh = mesh(mergeAll(bodies, ['position', 'normal']), plaster, 'stair');
    this.group.add(treadMesh, bodyMesh);

    // balustrade round the well: flat steel balusters, a walnut-capped rail
    const bars: THREE.BufferGeometry[] = [];
    const rails: THREE.BufferGeometry[] = [];
    const railH = 0.92;
    const runRail = (x: number, za: number, ya: number, zb: number, yb: number) => {
      const len = Math.abs(zb - za);
      const k = Math.max(1, Math.round(len / 0.12));
      for (let j = 0; j <= k; j++) {
        const t = j / k, z = za + (zb - za) * t, y = ya + (yb - ya) * t;
        bars.push(boxAt(x - 0.006, y, z - 0.02, x + 0.006, y + railH, z + 0.02));
      }
      // sloped rail: a box rotated about x
      const r = new THREE.BoxGeometry(0.05, 0.045, Math.hypot(len, yb - ya) + 0.05);
      r.rotateX(Math.atan2(-(yb - ya), zb - za)); // local +z along the slope
      r.translate(x, (ya + yb) / 2 + railH + 0.02, (za + zb) / 2);
      rails.push(r);
    };
    const wellL = s.x0 + fw, wellR = s.x1 - fw;
    runRail(wellR, z1Start, 0, midZ, Y1 / 2); // flight 1, well side
    runRail(wellL, z2Start + 0.15, Y1 / 2 + 0.1, topZ, Y1); // flight 2, well side
    // level-1 landing edge over flight 1 and the well, and the well's end at the mid landing
    const flat = (xa: number, xb: number, z: number, y: number) => {
      const k = Math.max(1, Math.round((xb - xa) / 0.12));
      for (let j = 0; j <= k; j++) { const x = xa + ((xb - xa) * j) / k; bars.push(boxAt(x - 0.02, y, z - 0.006, x + 0.02, y + railH, z + 0.006)); }
      rails.push(boxAt(xa - 0.025, y + railH, z - 0.025, xb + 0.025, y + railH + 0.045, z + 0.025));
    };
    flat(wellL, s.x1, topZ, Y1);
    flat(wellL, wellR, midZ, Y1 / 2);
    this.group.add(mesh(mergeAll(bars, ['position', 'normal']), PublicMats.darkMetal(), 'balusters'));
    this.group.add(mesh(mergeAll(rails, ['position', 'normal']), PublicMats.walnut(), 'handrail'));

    // stair core walls at level 1 (the ground floor ones belong to the building),
    // and a ceiling over the core and the landing
    // (the building's own core wall runs to z1 on the lobby side; a 1 cm skin
    // over it keeps one finish without coplanar faces)
    this.group.add(
      mesh(boxAt(s.x0 - 0.2, Y1, s.z1, s.x0, Y1 + CEIL, cz0 - 0.2), wallMat, 'core-wall-left'),
      mesh(boxAt(s.x0, Y1, s.z0, s.x0 + 0.01, Y1 + CEIL, s.z1), wallMat, 'core-skin-left'),
      mesh(boxAt(s.x0, Y1, s.z0, s.x1, Y1 + CEIL, s.z0 + 0.01), wallMat, 'core-skin-back'),
      mesh(boxAt(s.x1, Y1, s.z0, s.x1 + 0.2, Y1 + CEIL, cz0 - 0.2), wallMat, 'core-wall-right'),
      mesh(boxAt(s.x0 - 0.2, Y1 + CEIL, s.z0, s.x1 + 0.2, Y1 + CEIL + 0.04, cz0), PublicMats.ceiling(), 'core-ceiling', false),
    );
    this.stairLight = new THREE.PointLight(0xffd6a6, 0, 9, 1.8);
    this.stairLight.position.set((s.x0 + s.x1) / 2, Y1 + 1.2, (s.z0 + s.z1) / 2);
    this.group.add(this.stairLight);

    // ------------------------------------------------------------ corridor shell
    // carpet (corridor + the landing in front of the stair)
    const carpet = PublicMats.carpet();
    this.group.add(
      mesh(metricUV(boxAt(x0, Y1 - 0.01, cz0, x1, Y1 + 0.012, cz1)), carpet, 'corridor-carpet', false),
      mesh(metricUV(boxAt(s.x0, Y1 - 0.01, s.z1, s.x1, Y1 + 0.012, cz0)), carpet, 'landing-carpet', false),
    );
    // ceiling
    this.group.add(mesh(boxAt(x0, Y1 + CEIL, cz0, x1, Y1 + CEIL + 0.04, cz1), PublicMats.ceiling(), 'corridor-ceiling', false));
    // back wall with the opening onto the stair landing
    this.group.add(
      mesh(boxAt(x0, Y1, cz0 - 0.2, s.x0 - 0.2, Y1 + CEIL, cz0), wallMat, 'corridor-wall-back'),
      mesh(boxAt(s.x1 + 0.2, Y1, cz0 - 0.2, x1, Y1 + CEIL, cz0), wallMat, 'corridor-wall-back'),
      mesh(boxAt(s.x0 - 0.2, Y1 + 2.3, cz0 - 0.2, s.x1 + 0.2, Y1 + CEIL, cz0), wallMat, 'corridor-bulkhead'),
    );
    // front face: a skin on the rooms' corridor wall, open at the showcase door
    const showcase = PLAN.showcaseDoor;
    const front = mesh(
      // built along +x, turned to face the corridor: local u runs from x1 back to x0
      wallWithOpenings(x1 - x0, CEIL, 0.02, [{ u0: x1 - showcase.x1, u1: x1 - showcase.x0, v0: 0, v1: DOOR_H + 0.02 }]).rotateY(Math.PI).translate(x1, Y1, cz1 - 0.02),
      wallMat, 'corridor-wall-front',
    );
    this.frontWall.add(front);
    // end walls: the north end keeps its window
    // (the end wall's window spans z −8.5 … −5.9, so the corridor gets its first 0.9 m)
    const endN = wallWithOpenings(cz1 - cz0, CEIL, 0.02, [{ u0: -8.5 - cz0, u1: cz1 - cz0 + 0.001, v0: PLAN.windowSill, v1: PLAN.windowHead }]);
    this.group.add(
      mesh(endN.rotateY(-Math.PI / 2).translate(x0, Y1, cz0), wallMat, 'corridor-end-n'),
      mesh(boxAt(x1 - 0.02, Y1, cz0, x1, Y1 + CEIL, cz1), wallMat, 'corridor-end-s'),
    );
    // skirting
    this.group.add(
      mesh(boxAt(x0, Y1 + 0.012, cz0, s.x0 - 0.2, Y1 + 0.1, cz0 + 0.015), skirt, 'skirt', false),
      mesh(boxAt(s.x1 + 0.2, Y1 + 0.012, cz0, x1, Y1 + 0.1, cz0 + 0.015), skirt, 'skirt', false),
    );
    this.frontWall.add(mesh(boxAt(x0, Y1 + 0.012, cz1 - 0.035, showcase.x0 - 0.07, Y1 + 0.1, cz1 - 0.02), skirt, 'skirt', false));
    this.frontWall.add(mesh(boxAt(showcase.x1 + 0.07, Y1 + 0.012, cz1 - 0.035, x1, Y1 + 0.1, cz1 - 0.02), skirt, 'skirt', false));

    // ------------------------------------------------------------ doors, plaques, sconces
    const leafMat = PublicMats.door();
    const frameMat = PublicMats.frame();
    const steel = PublicMats.brushed();
    const lockMat = PublicMats.black();
    const leaves: THREE.BufferGeometry[] = [], frames: THREE.BufferGeometry[] = [], metal: THREE.BufferGeometry[] = [], locks: THREE.BufferGeometry[] = [];
    const frontLeaves: THREE.BufferGeometry[] = [], frontFrames: THREE.BufferGeometry[] = [], frontMetal: THREE.BufferGeometry[] = [], frontLocks: THREE.BufferGeometry[] = [];
    const door = (x: number, num: number, face: 1 | -1, wallZ: number, withLeaf: boolean) => {
      // face: +1 = the door faces +z (back wall), −1 = faces −z (front wall)
      const onFront = face < 0;
      const L_ = onFront ? frontLeaves : leaves, F = onFront ? frontFrames : frames, M = onFront ? frontMetal : metal, K = onFront ? frontLocks : locks;
      const z = wallZ + face * 0.001;
      const a = 0.07, t = 0.025; // architrave width and projection
      F.push(boxAt(x - DOOR_W / 2 - a, Y1, Math.min(z, z + face * t), x - DOOR_W / 2, Y1 + DOOR_H + a, Math.max(z, z + face * t)));
      F.push(boxAt(x + DOOR_W / 2, Y1, Math.min(z, z + face * t), x + DOOR_W / 2 + a, Y1 + DOOR_H + a, Math.max(z, z + face * t)));
      F.push(boxAt(x - DOOR_W / 2, Y1 + DOOR_H, Math.min(z, z + face * t), x + DOOR_W / 2, Y1 + DOOR_H + a, Math.max(z, z + face * t)));
      if (withLeaf) {
        L_.push(boxAt(x - DOOR_W / 2, Y1 + 0.01, Math.min(z, z + face * 0.012), x + DOOR_W / 2, Y1 + DOOR_H, Math.max(z, z + face * 0.012)));
        // lever handle on the latch side, card lock above it, viewer
        const hx = x - (DOOR_W / 2 - 0.1); // latch on the −x side, like the showcase door
        const hz = z + face * 0.012;
        M.push(boxAt(hx - 0.02, Y1 + 0.98, Math.min(hz, hz + face * 0.06), hx + 0.02, Y1 + 1.06, Math.max(hz, hz + face * 0.06)));
        M.push(boxAt(Math.min(hx, hx + face * 0.12), Y1 + 1.01, Math.min(hz + face * 0.045, hz + face * 0.065), Math.max(hx, hx + face * 0.12), Y1 + 1.03, Math.max(hz + face * 0.045, hz + face * 0.065)));
        K.push(boxAt(hx - 0.035, Y1 + 1.12, Math.min(hz, hz + face * 0.02), hx + 0.035, Y1 + 1.3, Math.max(hz, hz + face * 0.02)));
        M.push(new THREE.CylinderGeometry(0.008, 0.008, 0.02, 10).rotateX(Math.PI / 2).translate(x, Y1 + 1.5, hz + face * 0.01));
      }
      // number plaque on the wall at the latch side
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.08), new THREE.MeshStandardMaterial({ map: plaqueTexture(num), roughness: 0.4, metalness: 0.2 }));
      // plaques on the side the camera arrives from, so 103 reads as the showcase room's
      pl.position.set(x + (DOOR_W / 2 + a + 0.14) * -face, Y1 + 1.52, wallZ + face * 0.006);
      pl.rotation.y = face > 0 ? 0 : Math.PI;
      pl.name = `plaque-${num}`;
      (onFront ? this.frontWall : this.group).add(pl);
    };
    for (const [x, num] of BACK_DOORS) door(x, num, 1, cz0, true);
    for (const [x, num] of FRONT_DOORS) door(x, num, -1, cz1 - 0.02, num !== SHOWCASE_NUMBER);
    const addMerged = (parts: THREE.BufferGeometry[], m: THREE.Material, name: string, to: THREE.Object3D) => { if (parts.length) to.add(mesh(mergeAll(parts, ['position', 'normal']), m, name)); };
    addMerged(leaves, leafMat, 'door-leaves', this.group);
    addMerged(frames, frameMat, 'door-frames', this.group);
    addMerged(metal, steel, 'door-hardware', this.group);
    addMerged(locks, lockMat, 'door-locks', this.group);
    addMerged(frontLeaves, leafMat, 'door-leaves', this.frontWall);
    addMerged(frontFrames, frameMat, 'door-frames', this.frontWall);
    addMerged(frontMetal, steel, 'door-hardware', this.frontWall);
    addMerged(frontLocks, lockMat, 'door-locks', this.frontWall);
    // leaves need UVs for the veneer: rebuild them with metric UVs
    for (const o of [...this.group.children, ...this.frontWall.children]) {
      if (o.name === 'door-leaves' || o.name === 'door-frames') metricUV((o as THREE.Mesh).geometry);
    }

    // sconces between doors: brass half-cylinders with an opal face, washing up and down the wall
    const washMat = new THREE.MeshBasicMaterial({ map: sconceWash(), color: new THREE.Color(0xffc58f).multiplyScalar(0.9), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const opal = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe0b8).multiplyScalar(2.4), toneMapped: false });
    this.lit.push({ m: washMat, base: washMat.color.clone() }, { m: opal, base: opal.color.clone() });
    const body = new THREE.CylinderGeometry(0.055, 0.055, 0.22, 20, 1, false, 0, Math.PI);
    const sconce = (x: number, face: 1 | -1, wallZ: number) => {
      const g = new THREE.Group();
      g.add(mesh(body, PublicMats.brass(), 'sconce', false));
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.12, 20, 1, true, 0, Math.PI), opal);
      g.add(glass);
      g.rotation.y = face > 0 ? -Math.PI / 2 : Math.PI / 2;
      g.position.set(x, Y1 + 1.75, wallZ + face * 0.002);
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.9), washMat);
      w.position.set(x, Y1 + 1.75, wallZ + face * 0.004);
      w.rotation.y = face > 0 ? 0 : Math.PI;
      w.renderOrder = 2;
      const to = face < 0 ? this.frontWall : this.group;
      to.add(g, w);
    };
    const between = (xs: number[], lo: number, hi: number) => {
      const out: number[] = [];
      const all = [lo, ...xs.slice().sort((a, b) => a - b), hi];
      for (let i = 0; i < all.length - 1; i++) if (all[i + 1] - all[i] > 2.0) out.push((all[i] + all[i + 1]) / 2);
      return out;
    };
    for (const x of between(BACK_DOORS.map((d) => d[0]), x0, s.x0 - 0.2).concat(between(BACK_DOORS.map((d) => d[0]).filter((x) => x > s.x1), s.x1 + 0.2, x1))) {
      if (x > s.x0 - 0.2 && x < s.x1 + 0.2) continue;
      sconce(x, 1, cz0);
    }
    for (const x of between(FRONT_DOORS.map((d) => d[0]), x0, x1)) sconce(x, -1, cz1 - 0.02);

    // downlights along the corridor and over the landing
    const disc = new THREE.CircleGeometry(0.055, 20).rotateX(Math.PI / 2);
    const discMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd9ad).multiplyScalar(3), toneMapped: false });
    this.lit.push({ m: discMat, base: discMat.color.clone() });
    for (let x = x0 + 1.1; x < x1 - 0.5; x += 2.2) {
      const d = new THREE.Mesh(disc, discMat);
      d.position.set(x, Y1 + CEIL - 0.002, (cz0 + cz1) / 2);
      this.group.add(d);
    }
    for (const z of [cz0 - 1.1, s.z1 - 0.7]) {
      const d = new THREE.Mesh(disc, discMat);
      d.position.set((s.x0 + s.x1) / 2 - 0.9, Y1 + CEIL - 0.002, z);
      this.group.add(d);
    }
    // exit sign over the south end (generic lettering)
    const exitTex = (() => {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 96;
      const g = c.getContext('2d')!;
      g.fillStyle = '#0f8a3c'; g.fillRect(0, 0, 256, 96);
      g.fillStyle = '#f4fff6'; g.font = '700 58px "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('EXIT', 128, 52);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const exitMat = new THREE.MeshBasicMaterial({ map: exitTex, color: new THREE.Color(1.6, 1.6, 1.6), toneMapped: false });
    const exit = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 0.36), [exitMat, exitMat, PublicMats.black(), PublicMats.black(), PublicMats.black(), PublicMats.black()]);
    exit.position.set(x1 - 0.04, Y1 + 2.45, (cz0 + cz1) / 2);
    this.group.add(exit);

    // over the open landing: in the 1.6 m corridor itself a point light sits
    // 0.8 m from both walls and hot-spots them (the spot then blooms)
    this.light = new THREE.PointLight(0xffcf94, 0, 11, 1.6);
    this.light.position.set((s.x0 + s.x1) / 2, Y1 + 2.1, cz0 - 1.0);
    this.group.add(this.light, this.frontWall);
    this.group.name = 'corridor';
    // one draw per material; the front wall merges on its own (the cutaway hides it)
    batchPlain(this.group);
    mergeStatic(this.frontWall);
    mergeStatic(this.group, [this.frontWall]);
  }

  setLights(v: number): void {
    this.light.intensity = 5 * v;
    this.stairLight.intensity = 5 * v;
    for (const { m, base } of this.lit) m.color.copy(base).multiplyScalar(v);
  }
}
