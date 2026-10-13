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
const entryCx = (PLAN.door.x0 + PLAN.door.x1) / 2; // between the middle pair of glass doors
const winX = SHOWCASE_WINDOW.centre; // the open panes the camera exits through
const doorCx = (PLAN.showcaseDoor.x0 + PLAN.showcaseDoor.x1) / 2;
const counter = PLAN.counter;
const y1 = FLOOR_Y.level1;
const eye = DIM.eyeHeight;
const fl = PLAN.floor; // the five-foot way and the lobby, 0.6 m above the car park
const eyeL = fl + eye;
// the stair (Corridor.ts): four steps up in the lobby to its door in the
// left-hand wall, the landing behind it, the long flight's centre line and
// pitch, the door at its top and the passage back to the corridor
const st = PLAN.stair;
const wallL = PLAN.lobby.x0;
const stairDoorCz = (st.door.z0 + st.door.z1) / 2;
const landY = fl + st.entry.risers * st.rise;
const stepsX = wallL + st.entry.risers * st.entry.run; // the first riser
/** Eye height climbing the four steps (along their pitch line). */
const onSteps = (x: number) => fl + eye + (landY - fl) * THREE.MathUtils.clamp((stepsX - x) / (stepsX - wallL), 0, 1);
const topDoorCz = (st.top.door.z0 + st.top.door.z1) / 2;
const flightX = (st.well.x0 + st.well.x1) / 2;
const flightTop = st.flight.z0 - (st.flight.risers - 1) * st.flight.run;
const onFlight = (z: number) => landY + st.rise * THREE.MathUtils.clamp(1 + (st.flight.z0 - z) / st.flight.run, 1, st.flight.risers);
const passageCx = (st.passage.x0 + st.passage.x1) / 2;

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
  // park, land at eye height behind the free bay, and dolly across it, up
  // onto the raised five-foot way, to the doors
  {
    id: 4,
    weight: 'altitude',
    points: [
      { pos: L(lobbyCx + 9, 13, 33), target: L(lobbyCx - 1, 3.6, -2), fov: 46 },
      { pos: L(lobbyCx + 2.2, 3.4, 17.5), target: L(lobbyCx - 0.4, 2.7, -2), fov: 47.5 },
      ARRIVAL,
      { pos: L(entryCx + 0.12, eye + 0.05, 5.0), target: L(entryCx + 0.05, fl + 1.45, -6), fov: 49 },
      { pos: L(entryCx + 0.06, eye + 0.4, 1.2), target: L(entryCx, fl + 1.4, -8), fov: 49.5 },
      { pos: L(entryCx, eyeL, -1.4), target: L(entryCx, fl + 1.4, -9.5), fov: FOV.c4[1] },
    ],
  },
  // 5 · Reception: through the doors and round to the right, to the counter
  // in the right-hand wall beside the entrance (it faces across the lobby),
  // then in close
  {
    id: 5,
    weight: 'even',
    points: [
      { pos: L(entryCx + 0.05, eyeL, -3.0), target: L(counter.x + 0.3, fl + 1.4, -5.6), fov: 50.5 },
      // the reception: pillars, bulkhead, the mural and the counter
      { pos: L(counter.x - 2.95, fl + 1.45, counter.z + 0.02), target: L(counter.x + 0.2, fl + 1.3, counter.z + 0.1), fov: 51.5 },
      { pos: L(counter.x - 2.1, fl + 1.49, counter.z + 0.3), target: L(counter.x - 0.1, fl + 1.15, counter.z - 0.08), fov: 52.5 },
      // close enough to read the registration card and the key cards
      { pos: L(counter.x - 1.75, fl + 1.53, counter.z + 0.45), target: L(counter.x - 0.12, fl + 1.03, counter.z - 0.06), fov: FOV.c5[1] },
    ],
  },
  // 6 · Rooms: turn from the counter across the lobby to the stair door in
  // the left-hand wall, up the four steps and through it, right on the
  // landing and up the long flight; right through the door at the top and
  // right again down the passage, left along the corridor, the door swings
  // open, into the room above the lobby
  {
    id: 6,
    weight: 'even',
    points: [
      // turning away from the counter, towards the benches and the stair door
      { pos: L(counter.x - 2.2, eyeL, counter.z - 0.6), target: L(stepsX + 0.4, fl + 1.35, stairDoorCz + 0.1), fov: 54.2 },
      { pos: L(stepsX + 1.85, eyeL, stairDoorCz + 0.1), target: L(wallL - 1.4, landY + 1.0, stairDoorCz - 0.05), fov: 54.5 },
      // up the four steps to the door (its head is 2.1 m over the top one),
      // through it to the landing and the cabinet on the wall ahead
      { pos: L(stepsX + 0.45, eyeL, stairDoorCz), target: L(wallL - 3.5, landY + 1.3, stairDoorCz - 0.1), fov: 54.6 },
      { pos: L(stepsX - 0.5, onSteps(stepsX - 0.5), stairDoorCz), target: L(wallL - 2.8, landY + 1.15, stairDoorCz - 0.3), fov: 54.7 },
      { pos: L(wallL - 0.1, landY + eye - 0.04, stairDoorCz), target: L(wallL - 2.5, landY + 1.05, stairDoorCz - 0.8), fov: 54.8 },
      // round to the right on the landing, and up the long flight
      { pos: L(st.well.x1 - 0.3, landY + eye, stairDoorCz - 0.3), target: L(flightX - 0.2, landY + 1.9, st.flight.z0 - 2.0), fov: 54.9 },
      { pos: L(flightX, landY + eye, st.flight.z0 + 0.3), target: L(flightX, onFlight(st.flight.z0 - 4) + 1.4, st.flight.z0 - 4), fov: 55.1 },
      { pos: L(flightX, onFlight(st.flight.z0 - 2.0) + eye, st.flight.z0 - 2.0), target: L(flightX + 0.2, y1 + 1.45, flightTop - 1.0), fov: 55.3 },
      // the level-1 landing: right, through the door in its right-hand wall,
      // and right again down the passage back to the corridor
      { pos: L(flightX + 0.03, y1 + eye, flightTop - 0.35), target: L(st.passage.x1, y1 + 1.45, topDoorCz), fov: 55.4 },
      { pos: L(st.well.x1 + 0.1, y1 + eye, topDoorCz), target: L(st.passage.x1, y1 + 1.55, topDoorCz + 0.25), fov: 55.5 },
      { pos: L(passageCx, y1 + eye, flightTop - 0.35), target: L(passageCx + 0.25, y1 + 1.45, -10.0), fov: 55.6 },
      { pos: L(passageCx, y1 + eye, -11.4), target: L(passageCx + 0.6, y1 + 1.45, -8.2), fov: 55.7 },
      // into the corridor and left, past the doors to the showcase room's
      { pos: L(passageCx + 0.15, y1 + eye, -8.45), target: L(doorCx + 1.5, y1 + 1.4, -8.0), fov: 56 },
      { pos: L(doorCx - 1.4, y1 + eye, -8.45), target: L(doorCx + 0.5, y1 + 1.35, -7.4), fov: 56.2 },
      { pos: L(doorCx - 0.2, y1 + eye, -8.3), target: L(doorCx + 0.1, y1 + 1.2, -4), fov: 56.5 },
      { pos: L(doorCx - 0.1, y1 + eye, -6.6), target: L(winX, y1 + 1.0, -2.5), fov: 57 },
      // (kept on the door side: in the Standard Queen the ensuite wall is 0.5 m to the left)
      { pos: L(doorCx - 0.1, y1 + eye + 0.05, -5.6), target: L(winX - 0.5, y1 + 0.95, -2.2), fov: FOV.c6[1] },
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
