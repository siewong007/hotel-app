import * as THREE from '../vendor/three.module.min.js';
import { ROWS, PARKING } from './plan.js';
import {
  mat, box, instanced, canvasPlane, rand, polyline, alongLine,
  PALETTE, GROUND_STOREY, SHOPHOUSE_H, PARAPET_H,
} from './core.js';

// The neighbouring terraces, built from the traced tenant rows rather than
// from the old road-map footprint trace, which had them in roughly the right
// relationship to each other but the wrong place relative to Farley and the
// hotel. Each row is swept along its frontage the way the aerial shows, with
// a five-foot way in front.
//
// Farley-family tenants are named because "Farley" is already the page's own
// wayfinding language. Everyone else stays abstract: at the distances this
// camera works at their signage is colour and rhythm, never text.
const NAMED = /^Farley /;

const LOT_W = 6.4;

function tenantSign(label, width) {
  return canvasPlane(width, width * 0.22, (ctx, w, h) => {
    ctx.fillStyle = '#12543a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f2efe2';
    ctx.font = `700 ${h * 0.46}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = `${h * 0.02}px`;
    ctx.fillText(label, w / 2, h * 0.55);
  }, { emissive: true });
}

export function buildDressing(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const shells = [];
  const bandMats = [
    mat(PALETTE.cream, 0.9),
    mat(0xd6cdb4, 0.9),
    mat(0xc8cfd2, 0.9),
    mat(0xb9a894, 0.9),
  ];
  bandMats.forEach((m) => { m.transparent = true; });
  const roofSlab = mat(0x8f9591, 0.92);
  roofSlab.transparent = true;
  const glassMat = mat(PALETTE.windowDark, 0.2, 0.24, { transparent: true, opacity: 0.85 });
  const canopyMat = mat(0x39403f, 0.8);
  canopyMat.transparent = true;

  const blocks = [];
  const parapets = [];
  const fronts = [];
  const canopies = [];
  const columns = [];
  let seed = 0;

  for (const row of ROWS) {
    const pl = polyline(row.front);
    const n = Math.max(1, Math.round(pl.total / LOT_W));
    const w = pl.total / n;
    for (let i = 0; i < n; i++) {
      seed++;
      const f = alongLine(pl, (i + 0.5) * w);
      const inX = -f.nx;
      const inZ = -f.nz;
      const h = SHOPHOUSE_H + (rand(seed) < 0.25 ? -3.4 : 0);
      const cx = f.x + inX * (row.depth / 2);
      const cz = f.z + inZ * (row.depth / 2);
      blocks.push({ x: cx, y: h / 2, z: cz, ry: f.ry, sx: w, sy: h, sz: row.depth, color: [0xe0dcc6, 0xd6cdb4, 0xc8cfd2][Math.floor(rand(seed * 2.7) * 3)] });
      parapets.push({ x: cx, y: h + PARAPET_H / 2, z: cz, ry: f.ry, sx: w + 0.3, sz: row.depth + 0.3 });
      fronts.push({ x: f.x + inX * 0.2, y: (GROUND_STOREY - 0.6) / 2 + 3.6, z: f.z + inZ * 0.2, ry: f.ry, sx: w * 0.98 });
      canopies.push({ x: f.x + f.nx * 1.3, y: GROUND_STOREY - 0.5, z: f.z + f.nz * 1.3, ry: f.ry, sx: w });
      if (i % 2 === 0) columns.push({ x: f.x + f.nx * 2.4, y: (GROUND_STOREY - 0.6) / 2, z: f.z + f.nz * 2.4, ry: f.ry });
    }

    // Fascia signs for the Farley-family tenants, spaced along the row.
    row.tenants.forEach((name, k) => {
      if (!NAMED.test(name)) return;
      const t = ((k + 0.5) / row.tenants.length) * pl.total;
      const f = alongLine(pl, t);
      const sign = tenantSign(name.toUpperCase(), 11);
      sign.position.set(f.x + f.nx * 0.35, GROUND_STOREY - 0.75, f.z + f.nz * 0.35);
      sign.rotation.y = f.ry + Math.PI;
      group.add(sign);
    });
  }

  const push = (m) => { shells.push(m); return m; };
  push(instanced(group, new THREE.BoxGeometry(1, 1, 1), mat(0xffffff, 0.9), blocks, { cast: true }));
  push(instanced(group, new THREE.BoxGeometry(1, PARAPET_H, 1), bandMats[2], parapets, { cast: true }));
  push(instanced(group, new THREE.BoxGeometry(1, GROUND_STOREY - 0.6, 0.2), glassMat, fronts));
  push(instanced(group, new THREE.BoxGeometry(1, 0.35, 2.7), canopyMat, canopies, { cast: true }));
  push(instanced(group, new THREE.BoxGeometry(0.36, GROUND_STOREY - 0.6, 0.36), bandMats[2], columns));

  // Red-roofed terrace housing ringing the complex, as a background silhouette.
  const houses = [];
  const roofs = [];
  // Kept well outside the ring so they read as the horizon rather than as
  // walls across the complex.
  // Held inside the ground plate — a row that overhangs it floats — and low
  // enough to read as horizon rather than as a wall.
  const terraceRows = [
    { from: [-230, -28], to: [-206, 108], depth: 13 },
    { from: [-158, 186], to: [-24, 174], depth: 13 },
    { from: [74, 18], to: [80, 138], depth: 13 },
  ];
  for (const tr of terraceRows) {
    const pl = polyline([tr.from, tr.to]);
    const n = Math.round(pl.total / 7);
    const w = pl.total / n;
    for (let i = 0; i < n; i++) {
      const f = alongLine(pl, (i + 0.5) * w);
      const cx = f.x - f.nx * (tr.depth / 2);
      const cz = f.z - f.nz * (tr.depth / 2);
      houses.push({ x: cx, y: 3.4, z: cz, ry: f.ry, sx: w, sz: tr.depth });
      // 4-segment cone turned 45° is a hip roof; the radius scales must stay
      // under the lot or neighbouring roofs merge into one long ridge.
      roofs.push({ x: cx, y: 7.6, z: cz, ry: f.ry + Math.PI / 4, sx: w * 0.7, sz: tr.depth * 0.7, sy: 1.9 });
    }
  }
  push(instanced(group, new THREE.BoxGeometry(1, 6.8, 1), bandMats[3], houses, { cast: true }));
  push(instanced(group, new THREE.ConeGeometry(1, 1, 4), mat(PALETTE.roofRed, 0.94), roofs, { cast: true }));

  // ---- Props ---------------------------------------------------------------
  const props = new THREE.Group();
  scene.add(props);
  const poleMat = mat(0xa8adaa, 0.55, 0.35);

  // Banner poles down the middle of Farley's car park.
  const poles = [];
  const banners = [];
  const farleyLot = PARKING[2];
  for (let i = 0; i < 6; i++) {
    const u = (i - 2.5) * 10;
    const x = farleyLot.centre[0] + u * Math.cos(farleyLot.rot);
    const z = farleyLot.centre[1] + u * Math.sin(farleyLot.rot);
    poles.push({ x, y: 5.5, z, sy: 11 });
    banners.push({ x: x + 0.75, y: 7.4, z });
  }
  instanced(props, new THREE.CylinderGeometry(0.11, 0.13, 1, 6), poleMat, poles, { cast: true });
  instanced(props, new THREE.BoxGeometry(1.35, 4.4, 0.05),
    mat(0x15683f, 0.86, 0, { side: THREE.DoubleSide }), banners, { cast: true });

  // Flags by the Farley entrance.
  const flagPoles = [];
  const flags = [];
  for (let i = 0; i < 3; i++) {
    const x = -152 + i * 4.5;
    const z = 54 - i * 4.0;
    flagPoles.push({ x, y: 7, z, sy: 14 });
    flags.push({ x: x + 1.5, y: 12.4, z, color: [0xbe2c33, 0xf0eee6, 0x1c3f74][i] });
  }
  instanced(props, new THREE.CylinderGeometry(0.08, 0.1, 1, 6), poleMat, flagPoles, { cast: true });
  instanced(props, new THREE.BoxGeometry(2.7, 1.5, 0.04),
    mat(0xffffff, 0.9, 0, { side: THREE.DoubleSide }), flags);

  // Street lamps around the ring, and along the Salim Inn frontage.
  const lampPoles = [];
  const lampHeads = [];
  const lampLine = polyline([[-176, 100], [-150, 24], [-96, -26], [-30, -34], [16, 2], [24, 60], [-30, 118], [-118, 150]]);
  const nLamps = Math.round(lampLine.total / 34);
  for (let i = 0; i <= nLamps; i++) {
    const f = alongLine(lampLine, (i / nLamps) * lampLine.total);
    lampPoles.push({ x: f.x, y: 4.5, z: f.z, sy: 9 });
    lampHeads.push({ x: f.x + f.nx * 0.9, y: 9.1, z: f.z + f.nz * 0.9, ry: f.ry });
  }
  instanced(props, new THREE.CylinderGeometry(0.1, 0.14, 1, 6), poleMat, lampPoles, { cast: true });
  instanced(props, new THREE.BoxGeometry(1.5, 0.18, 0.5), mat(0xd7d3c6, 0.7), lampHeads);

  // Palms on the verges between the ring road and the terraces.
  const trunks = [];
  const fronds = [];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const r = 120 + rand(i * 4.4) * 70;
    const x = -70 + Math.cos(a) * r;
    const z = 50 + Math.sin(a) * r * 0.8;
    const hgt = 5 + rand(i * 7.1) * 3.5;
    trunks.push({ x, y: hgt / 2, z, sy: hgt });
    for (let k = 0; k < 5; k++) {
      fronds.push({ x, y: hgt, z, ry: (k / 5) * Math.PI * 2 + rand(i) * 2, rz: 0.75 + rand(i * k + 1) * 0.35 });
    }
  }
  instanced(props, new THREE.CylinderGeometry(0.18, 0.28, 1, 6), mat(0x5c5140, 0.95), trunks, { cast: true });
  instanced(props, new THREE.BoxGeometry(3.6, 0.1, 0.7),
    mat(0x2c5330, 0.94, 0, { side: THREE.DoubleSide }), fronds, { cast: true });

  return { group, props, shells };
}
