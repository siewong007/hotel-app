// The stair and the level-1 corridor (brief §4.5), from the owner's photos of
// the stair and the level-1 and level-2 corridors (2026-10-02) and the
// owner's walk-through video (2026-10-12):
//   · the stair (PLAN.stair): through the brown door in the lobby's back wall,
//     three steps up to a landing, a right turn, and one long straight flight
//     behind the cafe's lot to level 1 — burgundy loop-pile carpet over treads
//     and risers with aluminium nosings, cream walls, a stainless post-and-
//     rail with ball finials beside the three steps and a wall handrail up
//     the flight on the right; on its left-hand wall a trailing-succulent
//     canvas, dried-flower wreaths and a monstera print, a white cabinet high
//     on the landing's wall, a fire extinguisher and KELUAR exit signs. The
//     video stops at the top of the flight: the level-1 landing and its short
//     passage to the corridor are inferred;
//   · the corridor: the same carpet, cream walls, dark brown doors with red
//     numbers on clear acrylic plates and stainless card locks, red
//     wayfinding plates facing the passage, a Wi-Fi sign, hexagonal and
//     blossom canvases, downlights and dome cameras.
// The numbering is a placeholder sequence — odd numbers on the facade side,
// even behind, rising from the corner end; the showcase room is 103. The
// plates list whichever rooms lie each way.
// Built in the Salim block frame; the corridor runs along x at level 1.
import * as THREE from 'three';
import { PLAN } from '../world/SalimInnBuilding';
import { FLOOR_Y } from '../config/dimensions';
import { SALIM_WIDTH } from '../world/layout';
import { batchPlain, boxAt, mergeAll, mergeStatic, metricUV, tube, wallWithOpenings } from '../world/geom';
import { acrylicNumberTexture, blossomTexture, exitTexture, hexArtTexture, monsteraTexture, noSmokingTexture, PublicMats, succulentTexture, wayfindingTexture, wifiTexture } from './lobbyMaterials';

const Y1 = FLOOR_Y.level1;
const CEIL = 2.7; // corridor ceiling above the level-1 floor
export const DOOR_W = 0.96;
const DOOR_H = 2.08;
/** Door centres along the corridor: [x, number]. Front doors are fixed clear
 *  of the configurator room's widest footprint, bar its own (103). */
export const FRONT_DOORS: [number, number][] = [[1.05, 101], [(PLAN.showcaseDoor.x0 + PLAN.showcaseDoor.x1) / 2, 103], [11.0, 105], [13.45, 107], [15.9, 109], [18.35, 111], [20.8, 113]];
export const BACK_DOORS: [number, number][] = [[1.3, 102], [4.3, 104], [7.3, 106], [10.6, 108], [13.9, 110], [19.1, 112], [21.55, 114]];
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

/** Where the passage from the stair meets the corridor (its centre line). */
export const PASSAGE_X = (PLAN.stair.passage.x0 + PLAN.stair.passage.x1) / 2;

/** The wayfinding plates facing the passage: the rooms to either hand, seen
 *  coming out of it into the corridor (the +x rooms are on the left). */
export function landingPlates(): { left: string; right: string } {
  const all = [...FRONT_DOORS, ...BACK_DOORS];
  return {
    left: roomRanges(all.filter(([x]) => x > PASSAGE_X).map(([, num]) => num)),
    right: roomRanges(all.filter(([x]) => x < PASSAGE_X).map(([, num]) => num)),
  };
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
    const st = PLAN.stair, sw = st.well, sd = st.door, R = st.rise;
    const W = SALIM_WIDTH;
    const cz0 = PLAN.corridor.z0, cz1 = PLAN.corridor.z1; // back, front faces
    const x0 = 0.2, x1 = W - 0.2;
    const wallMat = PublicMats.corridorWall();
    const carpet = PublicMats.carpet();
    const steel = PublicMats.stainless();
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

    // ------------------------------------------------------------ stair
    const gy = PLAN.floor;
    const zDoor = PLAN.lobby.z0 - 0.2; // the lobby back wall's rear face: the first riser
    const ne = st.entry.risers, er = st.entry.run;
    const landY = gy + ne * R;
    const fx0 = st.flight.x0, run = st.flight.run, nf = st.flight.risers;
    const topX = fx0 + (nf - 1) * run; // the top riser; the level-1 landing beyond
    const px0 = st.passage.x0, px1 = st.passage.x1, tx1 = st.top.x1;
    const top = Y1 + CEIL; // level 1's ceiling
    const skin = 0.012; // cream skins stand this far proud of the building's walls
    const steps: THREE.BufferGeometry[] = []; // carpeted treads and risers, solid to the ground
    const nosings: THREE.BufferGeometry[] = [];
    // the threshold through the wall, the three steps (risers facing +z) and the landing
    steps.push(boxAt(sd.x0, 0, zDoor, sd.x1, gy + 0.014, PLAN.lobby.z0));
    for (let k = 1; k < ne; k++) {
      const za = zDoor - k * er, zb = zDoor - (k - 1) * er, y = gy + k * R;
      steps.push(boxAt(sw.x0, 0, za, fx0, y, zb));
      nosings.push(boxAt(sw.x0 + 0.02, y - 0.003, zb - 0.05, fx0 - 0.02, y + 0.004, zb + 0.004), boxAt(sw.x0 + 0.02, y - 0.03, zb, fx0 - 0.02, y, zb + 0.004));
    }
    steps.push(boxAt(sw.x0, 0, sw.z0, fx0, landY, sw.z1));
    nosings.push(boxAt(sw.x0 + 0.02, landY - 0.003, sw.z1 - 0.05, fx0 - 0.02, landY + 0.004, sw.z1 + 0.004), boxAt(sw.x0 + 0.02, landY - 0.03, sw.z1, fx0 - 0.02, landY, sw.z1 + 0.004));
    // the long flight (risers facing −x), up to the level-1 landing
    for (let k = 1; k < nf; k++) {
      const xa = fx0 + (k - 1) * run, xb = xa + run, y = landY + k * R;
      steps.push(boxAt(xa, 0, sw.z0, xb, y, sw.z1));
      nosings.push(boxAt(xa - 0.004, y - 0.003, sw.z0 + 0.02, xa + 0.05, y + 0.004, sw.z1 - 0.02), boxAt(xa - 0.004, y - 0.03, sw.z0 + 0.02, xa, y, sw.z1 - 0.02));
    }
    // the top riser in front of the slab's edge, then the level-1 landing and the passage
    steps.push(boxAt(topX - 0.012, landY + (nf - 1) * R, sw.z0, topX, Y1 + 0.012, sw.z1));
    nosings.push(boxAt(topX - 0.016, Y1 + 0.009, sw.z0 + 0.02, topX + 0.05, Y1 + 0.016, sw.z1 - 0.02));
    steps.push(boxAt(topX, Y1 - 0.01, sw.z0, tx1, Y1 + 0.012, sw.z1), boxAt(px0, Y1 - 0.01, sw.z1, px1, Y1 + 0.012, cz0));
    this.group.add(mesh(metricUV(merged(steps)), carpet, 'stair-steps'));
    this.group.add(mesh(merged(nosings), PublicMats.brushed(), 'stair-nosings', false));

    // stainless rails: a post-and-rail with ball finials beside the three
    // steps, and a handrail on brackets up the flight's right-hand wall,
    // 0.9 m above the pitch line
    const rails: THREE.BufferGeometry[] = [];
    const balls: THREE.BufferGeometry[] = [];
    // the pitch lines run through the nosings
    const pitch = (z: number) => gy + R * THREE.MathUtils.clamp(1 + (zDoor - z) / er, 1, ne);
    const treadAt = (z: number) => gy + R * Math.min(ne, Math.floor((zDoor - z) / er) + 1);
    const flightPitch = (x: number) => landY + R * THREE.MathUtils.clamp(1 + (x - fx0) / run, 1, nf);
    const rx = fx0 - 0.09, za = zDoor - 0.12, zt = sw.z1 - 0.1;
    for (const z of [za, zt]) {
      rails.push(tube(v(rx, treadAt(z), z), v(rx, pitch(z) + 0.98, z), 0.024));
      balls.push(new THREE.SphereGeometry(0.04, 14, 8).translate(rx, pitch(z) + 1.0, z));
    }
    for (const h of [0.9, 0.6, 0.3]) rails.push(tube(v(rx, pitch(za) + h, za), v(rx, pitch(zt) + h, zt), h === 0.9 ? 0.022 : 0.011));
    const zr = sw.z1 - 0.06; // the flight's handrail, on its right-hand wall
    rails.push(tube(v(fx0, flightPitch(fx0) + 0.9, zr), v(topX, Y1 + 0.9, zr), 0.022), tube(v(topX, Y1 + 0.9, zr), v(px0 - 0.06, Y1 + 0.9, zr), 0.022));
    for (let j = 0; j <= 4; j++) {
      const x = fx0 + 0.2 + ((topX - fx0 - 0.4) * j) / 4, y = flightPitch(x) + 0.84;
      rails.push(tube(v(x, y, zr), v(x, y, sw.z1 - skin), 0.008));
    }
    this.group.add(mesh(merged([...rails, ...balls]), steel, 'stair-rails'));

    // cream skins over the building's walls on the ground floor, and the
    // walls, ceiling and skins of the well, the landing and the passage at level 1
    this.group.add(mesh(merged([
      boxAt(sw.x0, 0, sw.z0, sw.x0 + skin, Y1, zDoor), // beside the steps and the landing
      boxAt(sw.x0, 0, sw.z0, tx1, top, sw.z0 + skin), // behind the flight
      boxAt(fx0, 0, sw.z1 - skin, px0, top, sw.z1), // in front of the flight, up to the passage
      boxAt(fx0 - skin, 0, sw.z1, fx0, Y1, zDoor), // beside the steps, right
      boxAt(tx1 - skin, Y1, sw.z0, tx1, top, cz0), // the far end, and the passage's right
      boxAt(px0, Y1, sw.z1, px0 + skin, top, cz0), // the passage's left
      // the back wall's rear face, round the door
      boxAt(sw.x0, 0, zDoor - skin, sd.x0, Y1, zDoor),
      boxAt(sd.x1, 0, zDoor - skin, fx0, Y1, zDoor),
      boxAt(sd.x0, gy + sd.h, zDoor - skin, sd.x1, Y1, zDoor),
    ]), wallMat, 'stair-walls'));
    this.group.add(mesh(merged([
      boxAt(fx0 - 0.2, Y1, sw.z0, fx0, top, sw.z1 + 0.2), // the well's near end at level 1
      boxAt(fx0 - 0.2, Y1, sw.z1, px0 - 0.2, top, sw.z1 + 0.2), // the well's front at level 1
      boxAt(px0 - 0.2, Y1, sw.z1, px0, top, cz0 - 0.2), // the passage's left wall
      boxAt(tx1, Y1, sw.z0 - 0.2, tx1 + 0.2, top, cz0 - 0.2), // the far end and the passage's right wall
      boxAt(fx0 - 0.2, Y1, sw.z0 - 0.2, tx1 + 0.2, top, sw.z0), // the well's back at level 1
    ]), wallMat, 'stair-walls-l1'));
    this.group.add(mesh(merged([
      boxAt(fx0 - 0.2, top, sw.z0 - 0.2, tx1 + 0.2, top + 0.04, sw.z1 + 0.2),
      boxAt(px0 - 0.2, top, sw.z1, tx1 + 0.2, top + 0.04, cz0),
    ]), PublicMats.ceiling(), 'stair-ceiling', false));

    // art up the flight's left-hand wall, rising with it, and the landing's
    // cabinet; the extinguisher on the landing
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
    const onWall = sw.z0 + skin + 0.025; // the left-hand wall's face, plus a canvas's depth
    const pitchY = (x: number) => landY + THREE.MathUtils.clamp((x - fx0) / run, 0, nf) * R;
    const wreathAt = (x: number, y: number) => {
      const g = wreath();
      g.rotation.y = Math.PI / 2; // its face towards +z, off the left-hand wall
      g.position.set(x, y, sw.z0 + skin + 0.06);
      this.group.add(g);
    };
    art(succulentTexture(), 'succulent', 0.45, 0.6, v(fx0 + 0.75, pitchY(fx0 + 0.75) + 1.6, onWall), 0);
    wreathAt(fx0 + 1.6, pitchY(fx0 + 1.6) + 1.55);
    art(monsteraTexture(), 'monstera', 0.42, 0.56, v(fx0 + 2.6, pitchY(fx0 + 2.6) + 1.65, onWall), 0);
    wreathAt(fx0 + 3.45, pitchY(fx0 + 3.45) + 1.5);
    // one more at the top, on the level-1 landing's end wall, ahead of the climb
    this.group.add(wreath().translateX(tx1 - skin - 0.06).translateY(Y1 + 1.55).translateZ((sw.z0 + sw.z1) / 2));
    this.group.add(mesh(boxAt(sw.x0 + 0.2, landY + 1.95, sw.z0 + skin, sw.x0 + 0.8, landY + 2.42, sw.z0 + 0.2), PublicMats.white(), 'landing-cabinet'));
    this.group.add(extinguisher().translateX(sw.x0 + skin).translateY(landY).translateZ(sw.z0 + 0.45));
    // KELUAR over the door, seen coming down
    const exitMat = new THREE.MeshBasicMaterial({ map: exitTexture(), color: new THREE.Color(1.5, 1.5, 1.5), toneMapped: false });
    const exitBox = (pos: THREE.Vector3, rotY: number) => {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.113, 0.03), [PublicMats.white(), PublicMats.white(), PublicMats.white(), PublicMats.white(), exitMat, PublicMats.white()]);
      e.position.copy(pos);
      e.rotation.y = rotY;
      e.name = 'keluar';
      this.group.add(e);
    };
    exitBox(v((sd.x0 + sd.x1) / 2, gy + sd.h + 0.28, zDoor - skin - 0.016), Math.PI);
    // one lamp for the whole stair, in the well just under level 1's floor:
    // above the lobby's ceiling and below the corridor's carpet, so neither
    // takes its light through the slab. The well is 1.24 m wide, so the lamp
    // is never more than 0.62 m from a wall: a gentle falloff keeps that
    // from a hot spot (which bloomed) and still reaches both ends
    this.stairLight = new THREE.PointLight(0xffe0bc, 0, 10, 0.9);
    this.stairLight.position.set(fx0 + 1.0, Y1 - 0.15, (sw.z0 + sw.z1) / 2); // (x past the lobby's side wall, which would take it)
    this.group.add(this.stairLight);

    // ------------------------------------------------------------ corridor shell
    this.group.add(mesh(metricUV(boxAt(x0, Y1 - 0.01, cz0, x1, Y1 + 0.012, cz1)), carpet, 'corridor-carpet', false));
    this.group.add(mesh(boxAt(x0, top, cz0, x1, top + 0.04, cz1), PublicMats.ceiling(), 'corridor-ceiling', false));
    // back wall with the passage's opening
    this.group.add(
      mesh(boxAt(x0, Y1, cz0 - 0.2, px0, top, cz0), wallMat, 'corridor-wall-back'),
      mesh(boxAt(px1, Y1, cz0 - 0.2, x1, top, cz0), wallMat, 'corridor-wall-back'),
      mesh(boxAt(px0, Y1 + 2.3, cz0 - 0.2, px1, top, cz0), wallMat, 'corridor-bulkhead'),
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
      mesh(boxAt(x1 - 0.02, Y1, cz0, x1, top, cz1), wallMat, 'corridor-end-s'),
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

    // ------------------------------------------------------------ the plates, signs and art at the passage
    const { left, right } = landingPlates();
    const signPlate = (tex: THREE.Texture, key: string, x: number, y: number, w: number, h: number, transparent = false) => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), PublicMats.print(tex, key, transparent));
      p.rotation.y = Math.PI; // facing −z, towards the passage
      p.position.set(x, Y1 + y, cz1 - 0.024);
      p.name = `sign-${key}`;
      this.frontWall.add(p);
    };
    // on the stretch of the room wall facing the passage, between its two doors
    const lo = Math.max(...FRONT_DOORS.map(([x]) => x).filter((x) => x < PASSAGE_X)) + DOOR_W / 2 + 0.05;
    const hi = Math.min(...FRONT_DOORS.map(([x]) => x).filter((x) => x > PASSAGE_X)) - DOOR_W / 2 - 0.05;
    const mid = (lo + hi) / 2;
    signPlate(wayfindingTexture(left, 'left'), 'way-l', mid + 0.26, 2.0, 0.46, 0.115);
    signPlate(wayfindingTexture(right, 'right'), 'way-r', mid - 0.26, 2.0, 0.46, 0.115);
    signPlate(wifiTexture(), 'wifi', mid, 1.6, 0.16, 0.16, true);
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
    hexArt('navy', px0 - 0.75, Y1 + 1.85);
    hexArt('green', px0 - 0.42, Y1 + 1.5);
    const ns = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.25), PublicMats.print(noSmokingTexture(), 'no-smoking'));
    ns.position.set(px1 + 0.55, Y1 + 1.55, cz0 + 0.004);
    ns.name = 'sign-no-smoking';
    this.group.add(ns);
    const longArt = new THREE.Group();
    longArt.add(mesh(boxAt(-0.6, -0.15, -0.025, 0.6, 0.15, 0), PublicMats.white(), 'canvas-edge', false));
    const blossom = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), PublicMats.print(blossomTexture(), 'blossom'));
    blossom.position.z = 0.001;
    longArt.add(blossom);
    longArt.position.set((BACK_DOORS[2][0] + BACK_DOORS[3][0]) / 2, Y1 + 1.65, cz0 + 0.026);
    longArt.name = 'art-blossom';
    this.group.add(longArt);
    // KELUAR over the opening, pointing the corridor to the stair
    exitBox(v(PASSAGE_X, Y1 + 2.48, cz0 + 0.03), 0);

    // ------------------------------------------------------------ downlights, cameras
    const disc = new THREE.CircleGeometry(0.055, 20).rotateX(Math.PI / 2);
    const discMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe4c2).multiplyScalar(3), toneMapped: false });
    this.lit.push({ m: discMat, base: discMat.color.clone() });
    const downlight = (x: number, z: number) => {
      const d = new THREE.Mesh(disc, discMat);
      d.position.set(x, top - 0.002, z);
      this.group.add(d);
    };
    for (let x = x0 + 1.1; x < x1 - 0.5; x += 2.2) downlight(x, (cz0 + cz1) / 2);
    // the passage, the level-1 landing and the well
    for (const z of [cz0 - 1.0, sw.z1 - 0.1]) downlight(PASSAGE_X, z);
    for (const x of [fx0 + 1.1, fx0 + 3.0]) downlight(x, (sw.z0 + sw.z1) / 2);
    const domeMat = new THREE.MeshPhysicalMaterial({ color: 0x1a1c1f, roughness: 0.08, clearcoat: 1 });
    for (const x of [PASSAGE_X + 0.6, 4.2, 18.6]) {
      const g = new THREE.Group();
      g.add(mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 24).translate(0, -0.01, 0), PublicMats.white(), 'cctv-base', false));
      g.add(mesh(new THREE.SphereGeometry(0.055, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(0, -0.02, 0), domeMat, 'cctv-dome', false));
      g.position.set(x, top, (cz0 + cz1) / 2 + 0.25);
      g.name = 'cctv';
      this.group.add(g);
    }
    // the exit sign over the south end
    exitBox(v(x1 - 0.04, Y1 + 2.45, (cz0 + cz1) / 2), -Math.PI / 2);

    // in the passage, where it meets the landing, lighting the corridor down
    // it: 0.65 m from the passage's walls, so with the same gentle falloff
    // (a steep one hot-spots them, and the spot blooms)
    this.light = new THREE.PointLight(0xffd8a8, 0, 11, 0.9);
    this.light.position.set(PASSAGE_X, Y1 + 2.2, sw.z1 + 0.4);
    this.group.add(this.light, this.frontWall);
    this.group.name = 'corridor';
    // one draw per material; the front wall merges on its own (the cutaway hides it)
    batchPlain(this.group);
    mergeStatic(this.frontWall);
    mergeStatic(this.group, [this.frontWall]);
  }

  setLights(v: number): void {
    this.light.intensity = 2.2 * v;
    this.stairLight.intensity = 2.7 * v;
    for (const { m, base } of this.lit) m.color.copy(base).multiplyScalar(v);
  }
}

/** A dried-flower wreath with a hanging charm (up the flight). */
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
