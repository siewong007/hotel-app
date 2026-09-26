// The film's single continuous camera path: control points for position,
// look-target, FOV and roll, grouped by chapter. Exterior points come from the
// converted Earth Studio keyframes; ground-level and interior points are
// placed in the Salim Inn block frame so they follow the building if its
// calibration changes.
import * as THREE from 'three';
import { EXTERIOR_KEYS, FILM_FOV_C3 } from '../data/keyframes';
import { POINTS, salimLocal, SALIM_WIDTH } from '../world/layout';
import { DIM, FLOOR_Y } from '../config/dimensions';
import { bearingToXZ } from '../data/geo';
import { PLAN, SHOWCASE_WINDOW } from '../world/SalimInnBuilding';

export interface PathPoint {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  fov: number; // design vertical FOV at 16:9
  roll?: number; // degrees
}

export interface PathChapter {
  id: number;
  points: PathPoint[]; // the chapter's own points; the first joins the previous chapter's last
  weight: 'altitude' | 'even';
}

const K = EXTERIOR_KEYS;
const L = (x: number, y: number, z: number) => salimLocal(x, y, z);
const lobbyCx = (PLAN.door.x0 + PLAN.door.x1) / 2 + 0.2;
const winX = SHOWCASE_WINDOW.centre; // the open panes the camera exits through
const stairCx = (PLAN.stair.x0 + PLAN.stair.x1) / 2;
const doorCx = (PLAN.showcaseDoor.x0 + PLAN.showcaseDoor.x1) / 2;
const counter = PLAN.counter;
const y1 = FLOOR_Y.level1;
const eye = DIM.eyeHeight;
const eyeW = eye + 0.15; // on the five-foot way / lobby (one step up)

// FOV plan: the pack's 58° → 31° run is compressed so no chapter changes FOV
// by more than 6° (brief §6.4).
const FOV = { c1: [58, 54], c2: [54, 49], c3: [49, 44], c4: [44, 50], c5: [50, 54], c6: [54, 58], c7: [58, 52], c8: [52, 48] };

const kp = (i: number, fov: number, roll = 0): PathPoint => ({ pos: K[i].pos.clone(), target: K[i].target.clone(), fov, roll });

/** Opening frame: same position as KF0 but aimed 22° below the horizon, so
 *  the dusk sky and the cloud deck fill the top of the frame; the camera then
 *  tilts down onto the ring on its way to KF1. */
function opening(fov: number): PathPoint {
  const p = K[0].pos.clone();
  const toRing = K[0].target.clone().sub(p).setY(0).normalize();
  const reach = p.y / Math.tan(THREE.MathUtils.degToRad(22));
  return { pos: p, target: p.clone().setY(0).addScaledVector(toRing, reach), fov, roll: 0 };
}

function over(bearing: number, dist: number, alt: number, target: THREE.Vector3, fov: number, roll = 0): PathPoint {
  const d = bearingToXZ(bearing);
  return { pos: new THREE.Vector3(target.x + d.x * dist, alt, target.z + d.z * dist), target: target.clone(), fov, roll };
}

const hotel = POINTS.hotelCentre;

/** Chapter 4's arrival frame: eye height in the aisle behind the free bay at
 *  the door — the free bay, the guest cars, the canopy and the entrance in one
 *  view (also the chapter's screenshot frame). */
export const ARRIVAL: PathPoint = { pos: L(lobbyCx - 0.3, eye, 11.2), target: L(lobbyCx + 0.4, 2.35, -3), fov: 48.5 };
const ringView = hotel.clone().lerp(new THREE.Vector3(55, 0, -52), 0.55).setY(0);

export const PATH: PathChapter[] = [
  // 1 · Establish — KF0 → KF1
  { id: 1, weight: 'altitude', points: [opening(FOV.c1[0]), kp(1, FOV.c1[1])] },
  // 2 · Community sweep — KF2 … KF5
  {
    id: 2,
    weight: 'altitude',
    points: [kp(2, 52.5, -1.5), kp(3, 51, -2), kp(4, 50, -1.5), kp(5, FOV.c2[1], 0)],
  },
  // 3 · Lock-on and half-orbit — KF6 … KF9 (hero)
  {
    id: 3,
    weight: 'altitude',
    points: [kp(6, FILM_FOV_C3[0], 1.5), kp(7, FILM_FOV_C3[1], 3), kp(8, FILM_FOV_C3[2], 2.5), kp(9, FILM_FOV_C3[3], 0)],
  },
  // 4 · Arrival: swing round to face the entrance, come down over the car
  // park, land at eye height behind the free bay, and dolly across it to the
  // canopy and the door
  {
    id: 4,
    weight: 'altitude',
    points: [
      { pos: L(lobbyCx + 9, 13, 33), target: L(lobbyCx - 1, 3.6, -2), fov: 46 },
      { pos: L(lobbyCx + 2.2, 3.4, 17.5), target: L(lobbyCx - 0.4, 2.7, -2), fov: 47.5 },
      ARRIVAL,
      { pos: L(lobbyCx - 0.05, eye, 5.0), target: L(lobbyCx, 1.9, -6), fov: 49 },
      { pos: L(lobbyCx, eye, 1.2), target: L(lobbyCx, 1.75, -8), fov: 49.5 },
      { pos: L(lobbyCx, eyeW, -1.4), target: L(lobbyCx, 1.7, -9.5), fov: FOV.c4[1] },
    ],
  },
  // 5 · Reception: push to the counter, then a gentle 20° arc
  {
    id: 5,
    weight: 'even',
    points: [
      { pos: L(lobbyCx, eyeW, -3.6), target: L(counter.x, 1.4, counter.z), fov: 51 },
      { pos: L(counter.x + 0.1, 1.55, counter.z + 3.0), target: L(counter.x, 1.12, counter.z), fov: 52.5 },
      { pos: L(counter.x + 1.25, 1.5, counter.z + 2.75), target: L(counter.x + 0.1, 1.2, counter.z - 0.2), fov: FOV.c5[1] },
    ],
  },
  // 6 · Rooms: rise through the stair core to the level-1 corridor, the door
  // swings open, into the room above the lobby
  {
    id: 6,
    weight: 'even',
    points: [
      { pos: L(stairCx, eye, -9.6), target: L(stairCx, 2.2, -15), fov: 54.5 },
      { pos: L(stairCx, eye + 0.3, -13.4), target: L(stairCx, y1 + 1.8, -14.6), fov: 55 },
      { pos: L(stairCx, y1 + eye, -13.6), target: L(stairCx + 0.2, y1 + 1.5, -8.4), fov: 55.5 },
      { pos: L(stairCx + 0.2, y1 + eye, -10.4), target: L(doorCx, y1 + 1.4, -6), fov: 56 },
      { pos: L(doorCx, y1 + eye, -8.4), target: L(doorCx - 0.2, y1 + 1.2, -4), fov: 56.5 },
      { pos: L(doorCx - 0.1, y1 + eye, -6.6), target: L(winX, y1 + 1.0, -2.5), fov: 57 },
      { pos: L(doorCx - 0.45, y1 + eye + 0.05, -5.6), target: L(winX - 0.5, y1 + 0.95, -2.2), fov: FOV.c6[1] },
    ],
  },
  // 7 · Within footsteps: back out through the window, up to 60 m over the ring
  {
    id: 7,
    weight: 'altitude',
    points: [
      { pos: L(winX, y1 + 1.62, -1.6), target: L(winX, y1 + 1.5, 6), fov: 56 },
      // through the open panes, then up over the cafe.cafe letters on the canopy
      { pos: L(winX, y1 + 1.86, 0.0), target: L(winX, y1 + 1.7, 8), fov: 55.8 },
      { pos: L(winX, y1 + 2.35, 1.3), target: L(winX, y1 + 1.6, 10), fov: 55.5 },
      { pos: L(winX, y1 + 3.2, 3.8), target: L(winX, y1 + 1.0, 14), fov: 55 },
      over(305, 48, 32, ringView, 53.5),
      over(318, 88, 60, ringView, FOV.c7[1]),
    ],
  },
  // 8 · Book: settle on the dusk hero angle
  {
    id: 8,
    weight: 'altitude',
    points: [over(326, 84, 40, hotel, 50), over(330, 86, 38, hotel, FOV.c8[1])],
  },
];

export const HOTEL_TARGET = hotel;
export const SALIM_SPAN = SALIM_WIDTH;
