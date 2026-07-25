import * as THREE from '../vendor/three.module.min.js';
import { PARKING, TENTS } from './plan.js';
import { mat, instanced, rand, PALETTE } from './core.js';

// Parking laid into the surfaced areas the aerial actually shows: the nose-in
// strip hard against the Salim Inn frontage where guests stop, and Farley's
// own car park with its marquees. The previous build put one invented block of
// bays midway between the two buildings, on ground that is really a service
// road and a planted verge.
const BAY_W = 2.5;
const BAY_L = 5;

const CAR_COLORS = [
  0xe8e9e6, 0xe8e9e6, 0xe8e9e6, 0xb9bcbd, 0xb9bcbd, 0x9aa0a2,
  0x24282a, 0x24282a, 0x3b4247, 0x8d2f2c, 0x27405e, 0x6d7a6a,
];

export function buildCarPark(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const meshes = [];
  const lines = [];
  const bodies = [];
  const cabins = [];
  const wheels = [];
  let seed = 0;
  let carCount = 0;

  for (const lot of PARKING) {
    const [cx, cz] = lot.centre;
    const c = Math.cos(lot.rot);
    const s = Math.sin(lot.rot);
    // local u runs along the lot, v across it
    const place = (u, v) => ({ x: cx + u * c - v * s, z: cz + u * s + v * c });
    const perRow = Math.floor(lot.along / BAY_W);
    const rowGap = lot.rows > 1 ? lot.across / lot.rows : lot.across;

    for (let r = 0; r < lot.rows; r++) {
      const v = (r - (lot.rows - 1) / 2) * rowGap;
      for (let b = 0; b <= perRow; b++) {
        const u = (b - perRow / 2) * BAY_W;
        const p = place(u, v);
        lines.push({ x: p.x, y: 0.06, z: p.z, ry: -lot.rot });
      }
      for (let b = 0; b < perRow; b++) {
        seed++;
        if (rand(seed * 7.3) < 0.3) continue;
        const u = (b - perRow / 2 + 0.5) * BAY_W;
        const p = place(u, v + (rand(seed * 3.1) - 0.5) * 0.3);
        const ry = -lot.rot + (r % 2 ? Math.PI : 0) + (rand(seed) - 0.5) * 0.05;
        const color = CAR_COLORS[Math.floor(rand(seed * 5.7) * CAR_COLORS.length)];
        const len = BAY_L * (0.82 + rand(seed * 2.1) * 0.1);
        bodies.push({ x: p.x, y: 0.68, z: p.z, ry, sz: len / BAY_L, color });
        cabins.push({ x: p.x, y: 1.28, z: p.z, ry, sz: len / BAY_L });
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            wheels.push({
              x: p.x + sx * 0.74 * Math.cos(ry) - sz * len * 0.32 * Math.sin(ry),
              y: 0.32,
              z: p.z - sx * 0.74 * Math.sin(ry) - sz * len * 0.32 * Math.cos(ry),
              ry, rz: Math.PI / 2,
            });
          }
        }
        carCount++;
      }
    }
  }

  const carMat = mat(0xffffff, 0.42, 0.16);
  carMat.transparent = true;
  const glassMat = mat(0x2c3336, 0.14, 0.3, { transparent: true, opacity: 0.82 });

  meshes.push(instanced(group, new THREE.BoxGeometry(BAY_W - 0.06, 0.02, BAY_L),
    new THREE.MeshBasicMaterial({ color: PALETTE.bayLine, transparent: true, opacity: 0.5 }), lines));
  meshes.push(instanced(group, new THREE.BoxGeometry(1.74, 0.78, BAY_L), carMat, bodies, { cast: true }));
  meshes.push(instanced(group, new THREE.BoxGeometry(1.56, 0.62, BAY_L * 0.52), glassMat, cabins));
  meshes.push(instanced(group, new THREE.CylinderGeometry(0.32, 0.32, 0.22, 8), mat(0x16191a, 0.8), wheels));

  // Marquees in the Farley car park, at their traced positions.
  const tentMat = mat(PALETTE.tentWhite, 0.88, 0.02);
  tentMat.transparent = true;
  tentMat.side = THREE.DoubleSide;
  const canopies = [];
  const valances = [];
  const legs = [];
  TENTS.forEach(([tx, tz], i) => {
    const sc = 0.86 + rand(i * 9.1) * 0.3;
    canopies.push({ x: tx, y: 3.5, z: tz, ry: Math.PI / 4, sx: sc, sy: sc, sz: sc });
    valances.push({ x: tx, y: 2.62, z: tz, ry: Math.PI / 4, sx: sc, sz: sc });
    for (const [ox, oz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      legs.push({ x: tx + ox * 3.1 * sc, y: 1.3, z: tz + oz * 3.1 * sc });
    }
  });
  meshes.push(instanced(group, new THREE.ConeGeometry(4.6, 2.5, 4), tentMat, canopies, { cast: true }));
  meshes.push(instanced(group, new THREE.BoxGeometry(6.4, 0.42, 6.4), tentMat, valances));
  meshes.push(instanced(group, new THREE.CylinderGeometry(0.07, 0.07, 2.6, 6), mat(0xbfc3c0, 0.6, 0.3), legs));

  // Trolley bays beside Farley's entrance canopy.
  const carts = [];
  const rails = [];
  for (let t = 0; t < 3; t++) {
    const x = -156 + t * 5.5;
    const z = 84 + t * 1.4;
    rails.push({ x, y: 1.35, z, ry: 0.7 });
    for (let k = 0; k < 7; k++) carts.push({ x: x + k * 0.32, y: 0.5, z: z - 1.6 + k * 0.28, ry: 0.7 });
  }
  meshes.push(instanced(group, new THREE.BoxGeometry(1.5, 0.1, 5.2), mat(0xa9adaa, 0.7, 0.2), rails));
  meshes.push(instanced(group, new THREE.BoxGeometry(0.92, 0.78, 0.5), mat(PALETTE.trolley, 0.62, 0.24), carts));

  // Motorbikes along the Salim Inn five-foot way, clear of the entrance.
  const bikes = [];
  const bikeWheels = [];
  for (let b = 0; b < 14; b++) {
    const x = -44 + b * 1.2;
    const z = -30 - b * 0.24;
    bikes.push({ x, y: 0.6, z, ry: 0.19, color: b % 3 ? 0x1e2224 : 0x7a2a26 });
    for (const oz of [-0.6, 0.6]) bikeWheels.push({ x, y: 0.3, z: z + oz, rz: Math.PI / 2 });
  }
  meshes.push(instanced(group, new THREE.BoxGeometry(0.44, 0.5, 1.7), mat(0xffffff, 0.5, 0.2), bikes, { cast: true }));
  meshes.push(instanced(group, new THREE.CylinderGeometry(0.29, 0.29, 0.14, 8), mat(0x16191a, 0.8), bikeWheels));

  return { group, meshes, carCount };
}
