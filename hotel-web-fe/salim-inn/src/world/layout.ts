// Farley ring layout: the single source of truth for where things are.
// Footprints come from OSM (ways 269472227–30); the Salim Inn block is carved
// out of the NW block at the position established from Street View (see
// config/dimensions.ts). Everything else in the scene asks this module for
// positions rather than hard-coding coordinates.
import * as THREE from 'three';
import polygonClipping, { type MultiPolygon, type Polygon, type Ring } from 'polygon-clipping';
import { buildingById, FARLEY_IDS, pts, type Pt } from '../data/site';
import { DIM, FLOOR_Y } from '../config/dimensions';

const nw = pts(buildingById(FARLEY_IDS.nwBlock).p);
const se = pts(buildingById(FARLEY_IDS.seBlock).p);

function nearest(list: Pt[], x: number, z: number): Pt {
  let best = list[0];
  let bd = Infinity;
  for (const p of list) {
    const d = (p[0] - x) ** 2 + (p[1] - z) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

const v2 = (p: Pt) => new THREE.Vector2(p[0], p[1]);

// ---------------------------------------------------------------------------
// West arm of the NW block: NW corner C → west corner W.
const C = v2(nearest(nw, -10, -120));
const W = v2(nearest(nw, -40, -69));
const TIP_E = v2(nearest(nw, 16, -126));
export const armDir = W.clone().sub(C).normalize(); // u: along the facade, SSW
export const armOut = new THREE.Vector2(armDir.y, -armDir.x); // n: outward (WNW)
if (armOut.dot(new THREE.Vector2(-1, -0.5)) < 0) armOut.negate();
const tipDir = TIP_E.clone().sub(C).normalize();
const tipIn = new THREE.Vector2(-tipDir.y, tipDir.x);
if (tipIn.dot(new THREE.Vector2(0.2, 1)) < 0) tipIn.negate();

const S = DIM.salim;
export const SALIM_WIDTH = S.length;
const A = C.clone().addScaledVector(armDir, S.startAlong); // facade, corner end
const B = A.clone().addScaledVector(armDir, SALIM_WIDTH); // facade, south end

/** Salim Inn block frame: origin at the corner end of the facade at ground
 *  level; +X runs along the facade to the south end (the viewer's right when
 *  facing the entrance from the car park), +Z points out to the car park. */
export const salimFrame = new THREE.Object3D();
salimFrame.position.set(A.x, 0, A.y);
salimFrame.rotation.y = Math.atan2(-armDir.y, armDir.x);
salimFrame.updateMatrixWorld(true);

export function salimLocal(x: number, y: number, z: number, target = new THREE.Vector3()): THREE.Vector3 {
  return target.set(x, y, z).applyMatrix4(salimFrame.matrixWorld);
}

/** Heading (radians, three.js Y rotation) that makes a local −Z look into the building. */
export const salimYaw = salimFrame.rotation.y;

// ---------------------------------------------------------------------------
// Footprints
const toRing = (p: THREE.Vector2[]): Ring => {
  const r = p.map((v) => [v.x, v.y] as [number, number]);
  r.push(r[0]);
  return r;
};

export const salimFootprint: THREE.Vector2[] = [
  A.clone(),
  B.clone(),
  B.clone().addScaledVector(armOut, -S.depth),
  A.clone().addScaledVector(armOut, -S.depth),
];

// Area removed from the OSM NW block: the hotel block, the covered walkway
// south of it, and the open corner wedge between it and the tip building.
const gapEnd = B.clone().addScaledVector(armDir, S.walkwayGap);
const cutGap: THREE.Vector2[] = [B.clone().addScaledVector(armOut, 2), gapEnd.clone().addScaledVector(armOut, 2), gapEnd.clone().addScaledVector(armOut, -30), B.clone().addScaledVector(armOut, -30)];
const cutWedge: THREE.Vector2[] = [
  C.clone().addScaledVector(armOut, 3).addScaledVector(tipDir, -3),
  A.clone().addScaledVector(armOut, 3),
  A.clone().addScaledVector(armOut, -30),
  C.clone().addScaledVector(tipIn, 30),
  C.clone().addScaledVector(tipDir, -3),
];

function closeRing(list: Pt[]): Ring {
  const r = list.map((p) => [p[0], p[1]] as [number, number]);
  r.push([list[0][0], list[0][1]]);
  return r;
}

const nwRest: MultiPolygon = polygonClipping.difference([closeRing(nw)], [toRing(salimFootprint)], [toRing(cutGap)], [toRing(cutWedge)]);

export interface Footprint {
  id: string;
  outer: THREE.Vector2[]; // open ring, CCW/CW as produced
  holes: THREE.Vector2[][];
  height: number;
  kind: 'row' | 'salim' | 'bar' | 'mart';
}

const ROW_H = FLOOR_Y.parapetTop;

function fromPoly(id: string, poly: Polygon, height: number, kind: Footprint['kind']): Footprint {
  const ring = (r: Ring) => r.slice(0, -1).map(([x, z]) => new THREE.Vector2(x, z));
  return { id, outer: ring(poly[0]), holes: poly.slice(1).map(ring), height, kind };
}

// SE block: the supermarket takes the south arm (frontage facing SSW onto its
// car park and the white marquees), the rest are shophouse rows.
const seV = se.map(v2);
const martCut: THREE.Vector2[] = [
  v2(nearest(se, 32.7, -4)).addScaledVector(new THREE.Vector2(-0.48, 0.88), 4).add(new THREE.Vector2(-4, 0)),
  v2(nearest(se, 83.7, 24)).add(new THREE.Vector2(0, 6)),
  v2(nearest(se, 112.8, 18.6)).add(new THREE.Vector2(6, 4)),
  v2(nearest(se, 98.6, -3.3)).add(new THREE.Vector2(3, -2)),
  v2(nearest(se, 87.9, 2.1)).add(new THREE.Vector2(0, -1.5)),
  v2(nearest(se, 43, -22.6)).add(new THREE.Vector2(-1, -3)),
];
const seMart = polygonClipping.intersection([toRing(seV)], [toRing(martCut)]);
const seRest = polygonClipping.difference([toRing(seV)], [toRing(martCut)]);

export const footprints: Footprint[] = [
  ...nwRest.map((p, i) => fromPoly(`nw-${i}`, p, ROW_H, 'row')),
  fromPoly('salim', [toRing(salimFootprint)], ROW_H, 'salim'),
  fromPoly('nw-bar', [closeRing(pts(buildingById(FARLEY_IDS.nwBar).p))], ROW_H, 'bar'),
  fromPoly('se-bar', [closeRing(pts(buildingById(FARLEY_IDS.seBar).p))], ROW_H, 'bar'),
  ...seRest.map((p, i) => fromPoly(`se-${i}`, p, ROW_H, 'row')),
  ...seMart.map((p, i) => fromPoly(`mart-${i}`, p, DIM.supermarket.height, 'mart')),
];

// ---------------------------------------------------------------------------
// Key points (world space). Local coordinates are in the Salim frame.
const L = (x: number, y: number, z: number) => salimLocal(x, y, z);
const lobbyCx = (S.entrance.x0 + S.entrance.x1) / 2; // centre of the glazed entrance

export const POINTS = {
  corner: new THREE.Vector3(C.x, 0, C.y),
  /** Hotel block centre at mid-height — the exterior camera's lock-on target. */
  hotelCentre: L(SALIM_WIDTH / 2, 6.5, -S.depth / 2),
  /** Lobby door, on the recessed shopfront line under the five-foot way. */
  lobbyDoor: L(lobbyCx, 0, -DIM.fiveFootWay),
  /** Where a guest stands under the canopy before the door. */
  canopyStand: L(lobbyCx, DIM.eyeHeight, 0.6),
  /** Guest parking bay directly in front of the lobby. */
  guestBay: L(lobbyCx, 0, 4.4),
  /** Aisle in front of the guest bays. */
  aisle: L(lobbyCx + 1.5, 0, 10.5),
  /** Pin / beam anchor above the block. */
  pin: L(lobbyCx, FLOOR_Y.parapetTop + 1.5, -4),
  /** Reception counter (lobby, back half of the corner bay). */
  counter: L(lobbyCx, 0, -9.8),
  /** Stair core at the back of the lobby bay. */
  stair: L(lobbyCx + 1.2, 0, -14.8),
  /** Level-1 corridor runs along the block, 1.6 m wide, behind the front rooms. */
  corridorStart: L(1.2, FLOOR_Y.level1, -10.4),
  corridorEnd: L(SALIM_WIDTH - 1.2, FLOOR_Y.level1, -10.4),
};

/** Level-1 showcase room: front room of the middle bay, window on the facade. */
export const SHOWCASE_ROOM = {
  // local-frame anchor: the room's window wall centre on the facade line
  windowCentre: new THREE.Vector3(S.bayWidth * 1.5, FLOOR_Y.level1, 0),
  door: new THREE.Vector3(S.bayWidth * 1.5, FLOOR_Y.level1, -9.6),
};

export const RING_CENTRE = new THREE.Vector3(55, 0, -52);
