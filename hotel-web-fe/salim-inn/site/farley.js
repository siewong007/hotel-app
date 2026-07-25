import * as THREE from '../vendor/three.module.min.js';
import { FARLEY_CENTRE, FARLEY_FRONT, FARLEY_DOOR, FARLEY_W, FARLEY_D, FARLEY_H } from './plan.js';
import { mat, box, instanced, canvasPlane, rand, PALETTE } from './core.js';

// Farley Sibu, the anchor supermarket. Its glazed fin frontage faces WNW
// across its own car park — away from Salim Inn, which is why the walk between
// them goes around the block rather than straight across. Position, bearing
// and the front door are all traced; see site/plan.js.
const GROUND_H = 4.6;

function roofSign(width) {
  return canvasPlane(width, width * 0.19, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${h * 0.64}px "PingFang SC", "Noto Sans SC", Inter, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#b4292c';
    ctx.fillText('华利', w * 0.42, h * 0.54);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#3b4a44';
    ctx.font = `800 ${h * 0.6}px Inter, sans-serif`;
    ctx.letterSpacing = `${h * 0.03}px`;
    ctx.fillText('FARLEY', w * 0.48, h * 0.54);
  }, { emissive: true });
}

export function buildFarley(scene) {
  const [ax, az] = FARLEY_FRONT[0];
  const [bx, bz] = FARLEY_FRONT[1];
  const len = Math.hypot(bx - ax, bz - az);
  const dx = (bx - ax) / len;
  const dz = (bz - az) / len;
  const nx = dz;   // outward normal, WNW onto the car park
  const nz = -dx;

  const group = new THREE.Group();
  group.position.set(FARLEY_CENTRE[0], 0, FARLEY_CENTRE[1]);
  group.rotation.y = Math.atan2(-dz, dx); // local +x along frontage, -z to the street
  scene.add(group);

  const front = -FARLEY_D / 2;
  const shell = [];
  const track = (m) => { m.material.transparent = true; shell.push(m); return m; };

  const panelMat = mat(PALETTE.farleyPanel, 0.8, 0.04);
  panelMat.transparent = true;
  const baseMat = mat(PALETTE.farleyBase, 0.84);
  baseMat.transparent = true;
  const glassMat = mat(0x33474a, 0.16, 0.34, { transparent: true, opacity: 0.88 });
  const darkMat = mat(0x2a3436, 0.66, 0.05);
  darkMat.transparent = true;

  track(box(group, 0, FARLEY_H / 2, 0, FARLEY_W, FARLEY_H, FARLEY_D, panelMat));
  track(box(group, 0, FARLEY_H + 0.45, 0, FARLEY_W + 0.6, 0.9, FARLEY_D + 0.6, darkMat));

  // The fin screen: widths, depths and greens vary fin to fin, with runs of
  // grey breaking them into vertical bands.
  const fins = [];
  const greens = PALETTE.farleyGreens;
  let x = -FARLEY_W / 2 + 0.6;
  let i = 0;
  while (x < FARLEY_W / 2 - 0.6) {
    const w = 0.28 + rand(i) * 0.34;
    const grey = Math.floor(i / 7) % 3 === 2 && rand(i * 2.3) < 0.65;
    const top = FARLEY_H - 0.4 - rand(i * 1.7) * 0.7;
    fins.push({
      x: x + w / 2, y: GROUND_H + (top - GROUND_H) / 2, z: front - 0.32,
      sx: w, sy: top - GROUND_H,
      color: grey ? 0x7b8286 : greens[Math.floor(rand(i * 3.1) * greens.length)],
    });
    x += w + 0.34 + rand(i * 5.3) * 0.5;
    i++;
  }
  shell.push(instanced(group, new THREE.BoxGeometry(1, 1, 0.42), mat(0xffffff, 0.62, 0.03), fins, { cast: true }));

  track(box(group, 0, (GROUND_H + FARLEY_H) / 2 - 0.2, front - 0.06, FARLEY_W, FARLEY_H - GROUND_H, 0.14, darkMat));
  track(box(group, 0, GROUND_H / 2, front - 0.16, FARLEY_W, GROUND_H, 0.24, glassMat));

  const mullions = [];
  for (let m = 0; m <= 44; m++) mullions.push({ x: -FARLEY_W / 2 + (m * FARLEY_W) / 44, y: GROUND_H / 2, z: front - 0.3 });
  shell.push(instanced(group, new THREE.BoxGeometry(0.13, GROUND_H, 0.16), baseMat, mullions));
  track(box(group, 0, 0.35, front - 0.5, FARLEY_W + 0.5, 0.7, 1.4, baseMat));

  // Entrance canopy, centred on the traced front door.
  const doorLocal = (FARLEY_DOOR[0] - FARLEY_CENTRE[0]) * dx + (FARLEY_DOOR[1] - FARLEY_CENTRE[1]) * dz;
  track(box(group, doorLocal, GROUND_H + 0.4, front - 3.4, 18, 0.5, 6.8, darkMat));
  const posts = [];
  for (const px of [doorLocal - 7.5, doorLocal + 7.5]) posts.push({ x: px, y: (GROUND_H + 0.15) / 2, z: front - 6.4 });
  shell.push(instanced(group, new THREE.CylinderGeometry(0.18, 0.18, GROUND_H + 0.15, 8), baseMat, posts, { cast: true }));

  const sign = roofSign(22);
  sign.position.set(doorLocal, FARLEY_H + 2.6, front - 0.5);
  sign.rotation.y = Math.PI; // PlaneGeometry faces +z; the frontage faces -z
  group.add(sign);

  const V = (vx, vy, vz) => new THREE.Vector3(vx, vy, vz);
  const door = V(FARLEY_DOOR[0], 0, FARLEY_DOOR[1]);

  return {
    group, shell, front, normal: [nx, nz],
    door,
    // Standing just outside the doors under the canopy, looking back at the fins.
    doorStand: V(FARLEY_DOOR[0] + nx * 9, 2.0, FARLEY_DOOR[1] + nz * 9),
    facadeWorld: V(FARLEY_DOOR[0] + nx * 0.5, 8.5, FARLEY_DOOR[1] + nz * 0.5),
    viewWorld: V(FARLEY_DOOR[0] + nx * 62, 22, FARLEY_DOOR[1] + nz * 62),
  };
}
