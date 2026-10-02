// Stair core and the level-1 corridor (brief §4.5), from the owner's photos
// of the stair and the level-1 and level-2 corridors (2026-10-02):
//   · a dog-leg stair at the back of the lobby, opposite the reception:
//     burgundy loop-pile carpet over treads and risers with aluminium
//     nosings, cream walls, stainless wall handrails on brackets and a
//     stainless post-and-rail balustrade round the well; a monstera print and
//     a dried-flower wreath up the first flight, an abstract canvas on the
//     landing, a fire extinguisher at the foot and KELUAR exit signs;
//   · the corridor: the same carpet, cream walls, dark brown doors with red
//     numbers on clear acrylic plates and stainless card locks, red
//     wayfinding plates at the stair landing, a Wi-Fi sign, hexagonal and
//     blossom canvases, downlights and dome cameras.
// The numbering is a placeholder sequence — odd numbers on the facade side,
// even behind, rising from the corner end; the showcase room is 103. The
// landing's plates list whichever rooms lie each way.
// Built in the Salim block frame; the corridor runs along x at level 1.
import * as THREE from 'three';
import { PLAN } from '../world/SalimInnBuilding';
import { FLOOR_Y } from '../config/dimensions';
import { SALIM_WIDTH } from '../world/layout';
import { batchPlain, boxAt, mergeAll, mergeStatic, metricUV, wallWithOpenings } from '../world/geom';
import { abstractTexture, acrylicNumberTexture, blossomTexture, exitTexture, hexArtTexture, monsteraTexture, noSmokingTexture, PublicMats, wayfindingTexture, wifiTexture } from './lobbyMaterials';

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

const merged = (parts: THREE.BufferGeometry[]) => mergeAll(parts, ['position', 'normal']);

/** "101–104, 106": consecutive numbers folded into ranges. */
export function roomRanges(nums: number[]): string {
  const s = [...nums].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j > i ? `${s[i]}–${s[j]}` : `${s[i]}`);
    i = j + 1;
  }
  return out.join(', ');
}

/** The level-1 landing's two wayfinding plates: the rooms to either hand,
 *  seen from the top of the stair facing the corridor (the +x rooms are on
 *  the left). */
export function landingPlates(): { left: string; right: string } {
  const midX = (PLAN.stair.x0 + PLAN.stair.x1) / 2;
  const all = [...FRONT_DOORS, ...BACK_DOORS];
  return {
    left: roomRanges(all.filter(([x]) => x > midX).map(([, num]) => num)),
    right: roomRanges(all.filter(([x]) => x < midX).map(([, num]) => num)),
  };
}

/** A round tube from a to b (rails, posts). */
function tube(a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, 10, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
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
    const wallMat = PublicMats.corridorWall();
    const carpet = PublicMats.carpet();
    const steel = PublicMats.stainless();
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

    // ------------------------------------------------------------ stair
    const n = 12, rise = Y1 / (2 * n), run = 0.27, fw = 1.0;
    const steps: THREE.BufferGeometry[] = []; // carpeted treads and risers
    const nosings: THREE.BufferGeometry[] = [];
    const bodies: THREE.BufferGeometry[] = [];
    const z1Start = s.z1 - 0.3; // flight 1 climbs from here towards −z
    const z2Start = z1Start - n * run - 1.0; // flight 2 climbs back towards +z
    const plate = 0.16;
    for (let i = 0; i < n; i++) {
      // flight 1: party-wall side; its risers face +z
      {
        const za = z1Start - (i + 1) * run, zb = z1Start - i * run, y = (i + 1) * rise;
        steps.push(boxAt(s.x1 - fw, y - rise, za, s.x1, y, zb));
        bodies.push(boxAt(s.x1 - fw, Math.max(0, y - rise - plate), za, s.x1, y - rise, zb));
        nosings.push(boxAt(s.x1 - fw + 0.02, y - 0.003, zb - 0.05, s.x1 - 0.02, y + 0.004, zb + 0.004), boxAt(s.x1 - fw + 0.02, y - 0.03, zb, s.x1 - 0.02, y, zb + 0.004));
      }
      // flight 2: lobby side, back towards the corridor; its risers face −z
      {
        const za = z2Start + i * run, zb = z2Start + (i + 1) * run, y = Y1 / 2 + (i + 1) * rise;
        steps.push(boxAt(s.x0, y - rise, za, s.x0 + fw, y, zb));
        bodies.push(boxAt(s.x0, y - rise - plate, za, s.x0 + fw, y - rise, zb));
        nosings.push(boxAt(s.x0 + 0.02, y - 0.003, za - 0.004, s.x0 + fw - 0.02, y + 0.004, za + 0.05), boxAt(s.x0 + 0.02, y - 0.03, za - 0.004, s.x0 + fw - 0.02, y, za));
      }
    }
    // mid landing and the level-1 landing over the void
    const midZ = z1Start - n * run;
    steps.push(boxAt(s.x0, Y1 / 2 - 0.03, s.z0 + 0.2, s.x1, Y1 / 2, midZ));
    bodies.push(boxAt(s.x0, Y1 / 2 - plate - 0.03, s.z0 + 0.2, s.x1, Y1 / 2 - 0.03, midZ));
    const topZ = z2Start + n * run; // where flight 2 arrives
    steps.push(boxAt(s.x0, Y1 - 0.03, topZ, s.x1, Y1 + 0.012, s.z1));
    bodies.push(boxAt(s.x0, Y1 - 0.25, topZ, s.x1, Y1 - 0.03, s.z1));
    this.group.add(mesh(metricUV(merged(steps)), carpet, 'stair-steps'));
    this.group.add(mesh(merged(nosings), PublicMats.brushed(), 'stair-nosings', false));
    this.group.add(mesh(merged(bodies), wallMat, 'stair'));

    // stainless balustrade round the well: posts, a top rail and two mid rails
    const rails: THREE.BufferGeometry[] = [];
    const railH = 0.92;
    const run2 = (a: THREE.Vector3, b: THREE.Vector3) => {
      const k = Math.max(1, Math.round(a.distanceTo(b) / 1.0));
      for (let j = 0; j <= k; j++) {
        const p = a.clone().lerp(b, j / k);
        rails.push(tube(p, p.clone().setY(p.y + railH), 0.02));
      }
      for (const h of [railH, 0.62, 0.32]) rails.push(tube(a.clone().setY(a.y + h), b.clone().setY(b.y + h), h === railH ? 0.024 : 0.011));
    };
    const wellL = s.x0 + fw, wellR = s.x1 - fw;
    run2(v(wellR, rise, z1Start - run), v(wellR, Y1 / 2, midZ)); // flight 1, well side
    run2(v(wellL, Y1 / 2 + rise, z2Start + 0.15), v(wellL, Y1, topZ)); // flight 2, well side
    run2(v(wellL, Y1 / 2, midZ), v(wellR, Y1 / 2, midZ)); // the well's end at the mid landing
    run2(v(wellL, Y1, topZ), v(s.x1, Y1, topZ)); // the level-1 landing's edge over flight 1
    // wall handrails on brackets, 0.9 m above the pitch line
    const wallRail = (x: number, za: number, ya: number, zb: number, yb: number) => {
      rails.push(tube(v(x, ya + 0.9, za), v(x, yb + 0.9, zb), 0.022));
      const k = Math.max(1, Math.round(Math.abs(zb - za) / 1.2));
      const wx = x + (x > (s.x0 + s.x1) / 2 ? 0.06 : -0.06);
      for (let j = 0; j <= k; j++) {
        const t = j / k, z = za + (zb - za) * t, y = ya + (yb - ya) * t + 0.9;
        rails.push(tube(v(x, y - 0.06, z), v(wx, y - 0.06, z), 0.008));
      }
    };
    wallRail(s.x1 - 0.06, z1Start, 0, midZ, Y1 / 2); // flight 1, on the party wall
    wallRail(s.x0 + 0.06, z2Start, Y1 / 2, topZ, Y1); // flight 2, on the core wall
    this.group.add(mesh(merged(rails), steel, 'stair-rails'));

    // cream skins over the building's own core walls on the ground floor
    this.group.add(mesh(merged([
      boxAt(s.x1 - 0.012, 0, s.z0, s.x1, Y1, s.z1),
      boxAt(s.x0, 0, s.z0, s.x0 + 0.012, Y1, s.z1),
      boxAt(s.x0, 0, s.z0, s.x1, Y1, s.z0 + 0.012),
    ]), wallMat, 'core-skin-ground'));
    // stair core walls at level 1 (the ground floor ones belong to the building),
    // and a ceiling over the core and the landing
    this.group.add(
      mesh(boxAt(s.x0 - 0.2, Y1, s.z1, s.x0, Y1 + CEIL, cz0 - 0.2), wallMat, 'core-wall-left'),
      mesh(boxAt(s.x0, Y1, s.z0, s.x0 + 0.01, Y1 + CEIL, s.z1), wallMat, 'core-skin-left'),
      mesh(boxAt(s.x0, Y1, s.z0, s.x1, Y1 + CEIL, s.z0 + 0.01), wallMat, 'core-skin-back'),
      mesh(boxAt(s.x1, Y1, s.z1, s.x1 + 0.2, Y1 + CEIL, cz0 - 0.2), wallMat, 'core-wall-right'),
      mesh(boxAt(s.x1 - 0.01, Y1, s.z0, s.x1, Y1 + CEIL, s.z1), wallMat, 'core-skin-right'),
      mesh(boxAt(s.x0 - 0.2, Y1 + CEIL, s.z0, s.x1 + 0.2, Y1 + CEIL + 0.04, cz0), PublicMats.ceiling(), 'core-ceiling', false),
    );

    // art up the first flight (party wall) and on the landing's back wall
    const art = (tex: THREE.Texture, key: string, w: number, h: number, pos: THREE.Vector3, rotY: number, depth = 0.025) => {
      const g = new THREE.Group();
      g.add(mesh(boxAt(-w / 2, -h / 2, -depth, w / 2, h / 2, 0), PublicMats.white(), 'canvas-edge', false));
      const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), PublicMats.print(tex, key));
      face.position.z = 0.001;
      g.add(face);
      g.rotation.y = rotY;
      g.position.copy(pos);
      g.name = `art-${key}`;
      this.group.add(g);
      return g;
    };
    art(monsteraTexture(), 'monstera', 0.42, 0.56, v(s.x1 - 0.026, 2.05, z1Start - 1.9), -Math.PI / 2);
    this.group.add(wreath().translateX(s.x1 - 0.06).translateY(1.75).translateZ(z1Start - 0.9));
    art(abstractTexture(), 'abstract', 0.5, 1.0, v((s.x0 + s.x1) / 2, Y1 / 2 + 1.55, s.z0 + 0.04), 0);
    // fire extinguisher at the foot of the stair, on the core wall
    this.group.add(extinguisher().translateX(s.x0 + 0.02).translateZ(z1Start - 0.4));
    // KELUAR over the core's opening, seen coming down (the lobby side has its own)
    const exitMat = new THREE.MeshBasicMaterial({ map: exitTexture(), color: new THREE.Color(1.5, 1.5, 1.5), toneMapped: false });
    const exitBox = (pos: THREE.Vector3, rotY: number) => {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.113, 0.03), [PublicMats.white(), PublicMats.white(), PublicMats.white(), PublicMats.white(), exitMat, PublicMats.white()]);
      e.position.copy(pos);
      e.rotation.y = rotY;
      e.name = 'keluar';
      this.group.add(e);
    };
    exitBox(v((s.x0 + s.x1) / 2, 2.62, s.z1 - 0.03), Math.PI);
    // one lamp for both flights: over the well, between the floors, so the
    // ground-floor flight is lit and not just the landing above it
    this.stairLight = new THREE.PointLight(0xffe0bc, 0, 10, 1.7);
    this.stairLight.position.set((wellL + wellR) / 2, Y1 * 0.78, midZ + 0.6);
    this.group.add(this.stairLight);

    // ------------------------------------------------------------ corridor shell
    // carpet (corridor + the landing in front of the stair)
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

    // ------------------------------------------------------------ doors and their plates
    const leafMat = PublicMats.door();
    const frameMat = PublicMats.frame();
    const leaves: THREE.BufferGeometry[] = [], frames: THREE.BufferGeometry[] = [], metal: THREE.BufferGeometry[] = [];
    const frontLeaves: THREE.BufferGeometry[] = [], frontFrames: THREE.BufferGeometry[] = [], frontMetal: THREE.BufferGeometry[] = [];
    const door = (x: number, num: number, face: 1 | -1, wallZ: number, withLeaf: boolean) => {
      // face: +1 = the door faces +z (back wall), −1 = faces −z (front wall)
      const onFront = face < 0;
      const L_ = onFront ? frontLeaves : leaves, F = onFront ? frontFrames : frames, M = onFront ? frontMetal : metal;
      const z = wallZ + face * 0.001;
      const a = 0.05, t = 0.02; // casing width and projection
      F.push(boxAt(x - DOOR_W / 2 - a, Y1, Math.min(z, z + face * t), x - DOOR_W / 2, Y1 + DOOR_H + a, Math.max(z, z + face * t)));
      F.push(boxAt(x + DOOR_W / 2, Y1, Math.min(z, z + face * t), x + DOOR_W / 2 + a, Y1 + DOOR_H + a, Math.max(z, z + face * t)));
      F.push(boxAt(x - DOOR_W / 2, Y1 + DOOR_H, Math.min(z, z + face * t), x + DOOR_W / 2, Y1 + DOOR_H + a, Math.max(z, z + face * t)));
      if (!withLeaf) return; // the showcase room's own door carries its plate (RoomBuilder)
      L_.push(boxAt(x - DOOR_W / 2, Y1 + 0.01, Math.min(z, z + face * 0.012), x + DOOR_W / 2, Y1 + DOOR_H, Math.max(z, z + face * 0.012)));
      // lever handle on the latch side, the stainless card lock above it
      const hx = x - (DOOR_W / 2 - 0.1); // latch on the −x side, like the showcase door
      const hz = z + face * 0.012;
      M.push(boxAt(hx - 0.02, Y1 + 0.98, Math.min(hz, hz + face * 0.06), hx + 0.02, Y1 + 1.06, Math.max(hz, hz + face * 0.06)));
      M.push(boxAt(Math.min(hx, hx + face * 0.12), Y1 + 1.01, Math.min(hz + face * 0.045, hz + face * 0.065), Math.max(hx, hx + face * 0.12), Y1 + 1.03, Math.max(hz + face * 0.045, hz + face * 0.065)));
      M.push(boxAt(hx - 0.035, Y1 + 1.1, Math.min(hz, hz + face * 0.018), hx + 0.035, Y1 + 1.32, Math.max(hz, hz + face * 0.018)));
      // red number on clear acrylic, high on the leaf
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.075), PublicMats.print(acrylicNumberTexture(num), `acrylic-${num}`, true));
      pl.position.set(x, Y1 + 1.66, hz + face * 0.006);
      pl.rotation.y = face > 0 ? 0 : Math.PI;
      pl.name = `plaque-${num}`;
      (onFront ? this.frontWall : this.group).add(pl);
    };
    for (const [x, num] of BACK_DOORS) door(x, num, 1, cz0, true);
    for (const [x, num] of FRONT_DOORS) door(x, num, -1, cz1 - 0.02, num !== SHOWCASE_NUMBER);
    const addMerged = (parts: THREE.BufferGeometry[], m: THREE.Material, name: string, to: THREE.Object3D) => { if (parts.length) to.add(mesh(merged(parts), m, name)); };
    addMerged(leaves, leafMat, 'door-leaves', this.group);
    addMerged(frames, frameMat, 'door-frames', this.group);
    addMerged(metal, steel, 'door-hardware', this.group);
    addMerged(frontLeaves, leafMat, 'door-leaves', this.frontWall);
    addMerged(frontFrames, frameMat, 'door-frames', this.frontWall);
    addMerged(frontMetal, steel, 'door-hardware', this.frontWall);

    // ------------------------------------------------------------ the landing's plates, signs and art
    const midX = (s.x0 + s.x1) / 2;
    const { left, right } = landingPlates();
    const signPlate = (tex: THREE.Texture, key: string, x: number, w: number, h: number, transparent = false) => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), PublicMats.print(tex, key, transparent));
      p.rotation.y = Math.PI; // facing −z, towards the landing
      p.position.set(x, Y1 + 2.0, cz1 - 0.024);
      p.name = `sign-${key}`;
      this.frontWall.add(p);
    };
    const doorAhead = FRONT_DOORS.find(([x]) => Math.abs(x - midX) < 0.8)?.[0] ?? midX;
    signPlate(wayfindingTexture(left, 'left'), `way-l`, doorAhead + DOOR_W / 2 + 0.42, 0.46, 0.115);
    signPlate(wayfindingTexture(right, 'right'), `way-r`, doorAhead - DOOR_W / 2 - 0.42, 0.46, 0.115);
    signPlate(wifiTexture(), 'wifi', doorAhead + DOOR_W / 2 + 0.88, 0.16, 0.16, true);
    // on the back wall beside the opening: two hexagonal canvases, the
    // no-smoking notice and, further along, the long blossom canvas
    const hexArt = (kind: 'navy' | 'green', x: number, y: number) => {
      const g = new THREE.Group();
      const shape = new THREE.CircleGeometry(0.2, 6);
      g.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 6).rotateX(Math.PI / 2).translate(0, 0, -0.015), PublicMats.white(), 'hex-edge', false));
      const face = new THREE.Mesh(shape, PublicMats.print(hexArtTexture(kind), `hex-${kind}`));
      face.position.z = 0.001;
      g.add(face);
      g.position.set(x, y, cz0 + 0.03);
      g.name = `art-hex-${kind}`;
      this.group.add(g);
    };
    hexArt('navy', s.x0 - 0.75, Y1 + 1.85);
    hexArt('green', s.x0 - 0.42, Y1 + 1.5);
    const ns = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.25), PublicMats.print(noSmokingTexture(), 'no-smoking'));
    ns.position.set(s.x1 + 0.55, Y1 + 1.55, cz0 + 0.004);
    ns.name = 'sign-no-smoking';
    this.group.add(ns);
    const longArt = new THREE.Group();
    longArt.add(mesh(boxAt(-0.6, -0.15, -0.025, 0.6, 0.15, 0), PublicMats.white(), 'canvas-edge', false));
    const blossom = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), PublicMats.print(blossomTexture(), 'blossom'));
    blossom.position.z = 0.001;
    longArt.add(blossom);
    longArt.position.set(15.2, Y1 + 1.65, cz0 + 0.026);
    longArt.name = 'art-blossom';
    this.group.add(longArt);
    // KELUAR over the opening, pointing the corridor to the stair
    exitBox(v(midX, Y1 + 2.48, cz0 + 0.03), 0);

    // ------------------------------------------------------------ downlights, cameras
    const disc = new THREE.CircleGeometry(0.055, 20).rotateX(Math.PI / 2);
    const discMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe4c2).multiplyScalar(3), toneMapped: false });
    this.lit.push({ m: discMat, base: discMat.color.clone() });
    for (let x = x0 + 1.1; x < x1 - 0.5; x += 2.2) {
      const d = new THREE.Mesh(disc, discMat);
      d.position.set(x, Y1 + CEIL - 0.002, (cz0 + cz1) / 2);
      this.group.add(d);
    }
    for (const z of [cz0 - 1.1, s.z1 - 0.7]) {
      const d = new THREE.Mesh(disc, discMat);
      d.position.set(midX - 0.9, Y1 + CEIL - 0.002, z);
      this.group.add(d);
    }
    const domeMat = new THREE.MeshPhysicalMaterial({ color: 0x1a1c1f, roughness: 0.08, clearcoat: 1 });
    for (const x of [midX + 0.6, 4.2, 18.6]) {
      const g = new THREE.Group();
      g.add(mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 24).translate(0, -0.01, 0), PublicMats.white(), 'cctv-base', false));
      g.add(mesh(new THREE.SphereGeometry(0.055, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(0, -0.02, 0), domeMat, 'cctv-dome', false));
      g.position.set(x, Y1 + CEIL, (cz0 + cz1) / 2 + 0.25);
      g.name = 'cctv';
      this.group.add(g);
    }
    // the exit sign over the south end
    exitBox(v(x1 - 0.04, Y1 + 2.45, (cz0 + cz1) / 2), -Math.PI / 2);

    // over the open landing: in the 1.6 m corridor itself a point light sits
    // 0.8 m from both walls and hot-spots them (the spot then blooms)
    this.light = new THREE.PointLight(0xffd8a8, 0, 11, 1.6);
    this.light.position.set(midX, Y1 + 2.1, cz0 - 1.0);
    this.group.add(this.light, this.frontWall);
    this.group.name = 'corridor';
    // one draw per material; the front wall merges on its own (the cutaway hides it)
    batchPlain(this.group);
    mergeStatic(this.frontWall);
    mergeStatic(this.group, [this.frontWall]);
  }

  setLights(v: number): void {
    this.light.intensity = 5 * v;
    this.stairLight.intensity = 6 * v;
    for (const { m, base } of this.lit) m.color.copy(base).multiplyScalar(v);
  }
}

/** A dried-flower wreath with a hanging charm (the stair's first flight). */
function wreath(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.TorusGeometry(0.15, 0.035, 8, 28).rotateY(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.9 }), 'wreath', false));
  const leaf = new THREE.MeshStandardMaterial({ color: 0x6f8a52, roughness: 0.8 });
  const bloom = new THREE.MeshStandardMaterial({ color: 0xb85a4a, roughness: 0.8 });
  const leaves: THREE.BufferGeometry[] = [], blooms: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const p = new THREE.Vector3(-0.03, Math.sin(a) * 0.15, Math.cos(a) * 0.15);
    (i % 3 === 0 ? blooms : leaves).push(new THREE.IcosahedronGeometry(i % 3 === 0 ? 0.03 : 0.025, 0).translate(p.x, p.y, p.z));
  }
  g.add(mesh(merged(leaves), leaf, 'wreath-leaves', false), mesh(merged(blooms), bloom, 'wreath-blooms', false));
  g.add(mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.22, 4).translate(-0.03, -0.26, 0), PublicMats.frame(), 'wreath-cord', false));
  g.add(mesh(new THREE.ConeGeometry(0.03, 0.08, 8).rotateX(Math.PI).translate(-0.03, -0.4, 0), new THREE.MeshStandardMaterial({ color: 0x5b8fb0, roughness: 0.6 }), 'wreath-charm', false));
  g.name = 'wreath';
  return g;
}

/** A red extinguisher on a wall bracket, its hose and black head. */
function extinguisher(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.46, 20).translate(0.09, 0.45, 0), PublicMats.red(), 'extinguisher'));
  g.add(mesh(new THREE.SphereGeometry(0.075, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0.09, 0.68, 0), PublicMats.red(), 'extinguisher-top', false));
  g.add(mesh(boxAt(0.06, 0.72, -0.02, 0.12, 0.8, 0.02), PublicMats.black(), 'extinguisher-head', false));
  g.add(mesh(new THREE.TorusGeometry(0.1, 0.008, 6, 20, Math.PI).rotateY(Math.PI / 2).translate(0.15, 0.62, 0.05), PublicMats.black(), 'extinguisher-hose', false));
  g.add(mesh(boxAt(0, 0.55, -0.05, 0.02, 0.62, 0.05), PublicMats.darkMetal(), 'extinguisher-bracket', false));
  g.name = 'extinguisher';
  return g;
}
