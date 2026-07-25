import * as THREE from '../vendor/three.module.min.js';
import { SALIM_FRONT, SALIM_DEPTH, SALIM_TENANTS, SALIM_AT } from './plan.js';
import {
  mat, box, instanced, canvasPlane, rand, polyline, alongLine as at,
  PALETTE, GROUND_STOREY, STOREY, SHOPHOUSE_H, PARAPET_H,
} from './core.js';

// The Salim Inn row, built along the traced frontage rather than as one
// straight block. The terrace bends twice — gently at the Hometown Pharmacy
// end and sharply inward just past the hotel — so each lot is placed and
// turned individually and the party walls follow the bends.
const LOT_W = 6.1;

function roofSign(width) {
  // Flat red wordmark on a white panel, as the sign actually is. The earlier
  // build drew it as red-and-blue neon.
  return canvasPlane(width, width * 0.2, (ctx, w, h) => {
    ctx.fillStyle = '#f4f2ec';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#b9b3a4';
    ctx.lineWidth = h * 0.05;
    ctx.strokeRect(h * 0.025, h * 0.025, w - h * 0.05, h - h * 0.05);
    ctx.fillStyle = '#b0242c';
    ctx.font = `900 ${h * 0.6}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = `${h * 0.04}px`;
    ctx.fillText('SALIM INN', w / 2, h * 0.56);
  });
}

function groundSign(width) {
  return canvasPlane(width, width * 0.42, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8d3a33';
    ctx.font = `600 ${h * 0.24}px "PingFang SC", "Noto Sans SC", sans-serif`;
    ctx.fillText('沙林酒店', w / 2, h * 0.24);
    ctx.fillStyle = '#b0242c';
    ctx.font = `900 ${h * 0.46}px Inter, sans-serif`;
    ctx.letterSpacing = `${h * 0.03}px`;
    ctx.fillText('SALIM INN', w / 2, h * 0.66);
  });
}

function cafeWordmark(width) {
  return canvasPlane(width, width * 0.2, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f2f1ea';
    ctx.font = `800 ${h * 0.74}px Inter, sans-serif`;
    ctx.fillText('cafe.cafe', w / 2, h * 0.54);
  }, { emissive: true });
}

export function buildSalim(scene) {
  const group = new THREE.Group();
  scene.add(group); // plan metres, origin on the Salim Inn pin — no transform

  const pl = polyline(SALIM_FRONT);
  const nLots = Math.round(pl.total / LOT_W);
  const lotW = pl.total / nLots;

  const exterior = [];
  const track = (m) => { m.material.transparent = true; exterior.push(m); return m; };
  const facadeMat = (c, r = 0.86) => { const m = mat(c, r); m.transparent = true; return m; };

  const creamMat = facadeMat(PALETTE.cream, 0.9);
  const deepMat = facadeMat(PALETTE.creamDeep, 0.9);
  const pierMat = facadeMat(PALETTE.pier, 0.8);
  const glassMat = mat(PALETTE.windowDark, 0.18, 0.28, { transparent: true, opacity: 0.9 });
  const mullionMat = facadeMat(PALETTE.mullion, 0.7);
  const canopyMat = facadeMat(PALETTE.canopy, 0.72);
  const whiteMat = facadeMat(0xf0ede2, 0.9);
  const stoneMat = facadeMat(0x9a9184, 0.95);

  const tenantAt = (t) =>
    SALIM_TENANTS.find((x) => t >= x.at - x.w / 2 && t <= x.at + x.w / 2);

  const CANOPY_Y = GROUND_STOREY - 0.5;
  const shells = [];
  const parapets = [];
  const spandrels = [];
  const windows = [];
  const piers = [];
  const mullions = [];
  const condensers = [];
  const canopies = [];
  const columns = [];
  const lights = [];
  const shopfronts = [];

  for (let i = 0; i < nLots; i++) {
    const t = (i + 0.5) * lotW;
    const f = at(pl, t);
    const inX = -f.nx; // into the building
    const inZ = -f.nz;
    const cx = f.x + inX * (SALIM_DEPTH / 2);
    const cz = f.z + inZ * (SALIM_DEPTH / 2);

    shells.push({ x: cx, y: SHOPHOUSE_H / 2, z: cz, ry: f.ry, sx: lotW, sz: SALIM_DEPTH });
    parapets.push({ x: cx, y: SHOPHOUSE_H + PARAPET_H / 2, z: cz, ry: f.ry, sx: lotW + 0.3, sz: SALIM_DEPTH + 0.3 });

    // Facade sits just proud of the frontage line.
    const fx = f.x + inX * 0.18;
    const fz = f.z + inZ * 0.18;

    for (let fl = 1; fl <= 2; fl++) {
      const sill = GROUND_STOREY + (fl - 1) * STOREY;
      spandrels.push({ x: fx, y: sill + 0.55, z: fz, ry: f.ry, sx: lotW });
      windows.push({ x: fx - inX * 0.06, y: sill + 2.25, z: fz - inZ * 0.06, ry: f.ry, sx: lotW * 0.99 });
      for (let m = 0; m < 3; m++) {
        const off = (m / 3 - 0.5 + 1 / 6) * lotW;
        mullions.push({
          x: fx + f.dx * off - inX * 0.18, y: sill + 2.25, z: fz + f.dz * off - inZ * 0.18, ry: f.ry,
        });
      }
      if (rand(i * 3 + fl) > 0.45) {
        for (const s of [-1, 1]) {
          const off = s * 0.5 + (rand(i + fl * 7) - 0.5) * 1.6;
          condensers.push({
            x: fx + f.dx * off - inX * 0.42, y: sill + 1.55, z: fz + f.dz * off - inZ * 0.42, ry: f.ry,
          });
        }
      }
    }

    // Pier on the party wall between lots.
    const p = at(pl, i * lotW);
    piers.push({
      x: p.x - p.nx * 0.34, y: (GROUND_STOREY + SHOPHOUSE_H) / 2 - 0.2, z: p.z - p.nz * 0.34, ry: p.ry,
    });

    // Five-foot way: canopy, columns, downlights.
    canopies.push({ x: f.x + f.nx * 1.3, y: CANOPY_Y, z: f.z + f.nz * 1.3, ry: f.ry, sx: lotW });
    if (i % 2 === 0) {
      columns.push({ x: f.x + f.nx * 2.5, y: (CANOPY_Y - 0.5) / 2, z: f.z + f.nz * 2.5, ry: f.ry });
    }
    for (const s of [-0.25, 0.25]) {
      lights.push({ x: f.x + f.dx * s * lotW + f.nx * 1.1, y: CANOPY_Y - 0.25, z: f.z + f.dz * s * lotW + f.nz * 1.1 });
    }

    // Ground floor: glazed shopfront, except the hotel bay which gets its own
    // stone / blank wall / recessed door arrangement below.
    const tn = tenantAt(t);
    if (!tn || tn.kind !== 'hotel') {
      shopfronts.push({ x: fx, y: (GROUND_STOREY - 0.6) / 2, z: fz, ry: f.ry, sx: lotW * 0.98 });
    }
  }

  const push = (m) => { exterior.push(m); return m; };
  push(instanced(group, new THREE.BoxGeometry(1, SHOPHOUSE_H, 1), deepMat, shells, { cast: true }));
  push(instanced(group, new THREE.BoxGeometry(1, PARAPET_H, 1), creamMat, parapets, { cast: true }));
  push(instanced(group, new THREE.BoxGeometry(1, 1.1, 0.4), creamMat, spandrels));
  push(instanced(group, new THREE.BoxGeometry(1, 2.1, 0.22), glassMat, windows));
  push(instanced(group, new THREE.BoxGeometry(0.09, 2.2, 0.16), mullionMat, mullions));
  push(instanced(group, new THREE.BoxGeometry(0.72, 0.5, 0.36), whiteMat, condensers, { cast: true }));
  push(instanced(group, new THREE.BoxGeometry(0.52, SHOPHOUSE_H - GROUND_STOREY + 0.9, 0.5), pierMat, piers, { cast: true }));
  push(instanced(group, new THREE.BoxGeometry(1, 0.42, 2.9), canopyMat, canopies, { cast: true }));
  push(instanced(group, new THREE.BoxGeometry(0.44, CANOPY_Y - 0.5, 0.44), facadeMat(0xbdb9ad, 0.88), columns, { cast: true }));
  push(instanced(group, new THREE.CylinderGeometry(0.13, 0.13, 0.05, 10),
    new THREE.MeshBasicMaterial({ color: 0xffe6b8, transparent: true, toneMapped: false }), lights));
  push(instanced(group, new THREE.BoxGeometry(1, GROUND_STOREY - 0.6, 0.2), glassMat, shopfronts));

  // ---- The hotel bay -------------------------------------------------------
  const h = at(pl, SALIM_AT);
  const hIn = { x: -h.nx, z: -h.nz };
  const along = (o) => ({ x: h.x + h.dx * o, z: h.z + h.dz * o });
  const place = (o, depth, w, height, y, m) => {
    const p = along(o);
    const q = box(group, p.x + hIn.x * depth, y, p.z + hIn.z * depth, w, height, 0.16, m);
    q.rotation.y = h.ry;
    return track(q);
  };

  // Left to right as you face it: stone cladding, blank wall, glazed doors,
  // then the sign wall.
  place(-5.2, 0.3, 3.0, GROUND_STOREY - 0.6, (GROUND_STOREY - 0.6) / 2, stoneMat);
  place(-2.2, 0.3, 3.0, GROUND_STOREY - 0.6, (GROUND_STOREY - 0.6) / 2, whiteMat);
  place(1.4, 0.05, 4.0, 2.7, 1.35, glassMat);
  place(5.6, 0.3, 3.6, GROUND_STOREY - 0.6, (GROUND_STOREY - 0.6) / 2, whiteMat);

  const stones = [];
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 5; c++) {
      const o = -6.5 + c * 0.62 + (r % 2) * 0.3;
      const p = along(o);
      stones.push({ x: p.x + hIn.x * 0.18, y: 0.28 + r * 0.36, z: p.z + hIn.z * 0.18, ry: h.ry, sz: 0.7 + rand(r * 5 + c) * 0.6 });
    }
  }
  push(instanced(group, new THREE.BoxGeometry(0.56, 0.32, 0.12), stoneMat, stones));

  const sign = groundSign(4.4);
  const sp = along(5.6);
  sign.position.set(sp.x + hIn.x * 0.42, 2.5, sp.z + hIn.z * 0.42);
  sign.rotation.y = h.ry + Math.PI; // PlaneGeometry faces +z; the street is -z
  group.add(sign);
  exterior.push(sign);

  const roof = roofSign(12);
  const rp = along(2.5);
  roof.position.set(rp.x + hIn.x * 0.1, SHOPHOUSE_H + PARAPET_H + 0.75, rp.z + hIn.z * 0.1);
  roof.rotation.y = h.ry + Math.PI;
  group.add(roof);

  // cafe.cafe sits 17 m to the hotel's right along the frontage, which is
  // toward *decreasing* distance — the previous build had it on the far side.
  const cafeT = SALIM_TENANTS.find((x) => x.kind === 'cafe').at;
  const c = at(pl, cafeT);
  const cafe = cafeWordmark(11);
  cafe.position.set(c.x + c.nx * 1.45, CANOPY_Y - 0.24, c.z + c.nz * 1.45);
  cafe.rotation.y = c.ry + Math.PI;
  group.add(cafe);

  // Terracotta planters along the whole frontage.
  const planters = [];
  const shrubs = [];
  for (let i = 0; i < 14; i++) {
    const t = 6 + i * ((pl.total - 12) / 13);
    const f = at(pl, t);
    const px = f.x + f.nx * 3.6;
    const pz = f.z + f.nz * 3.6;
    planters.push({ x: px, y: 0.35, z: pz, ry: f.ry });
    for (let s = -1; s <= 1; s++) {
      shrubs.push({ x: px + f.dx * s * 0.55, y: 0.95 + rand(i * 3 + s) * 0.18, z: pz + f.dz * s * 0.55, sx: 0.9 + rand(i + s) * 0.3 });
    }
  }
  push(instanced(group, new THREE.BoxGeometry(1.9, 0.7, 0.9), mat(PALETTE.terracotta, 0.92), planters, { cast: true }));
  push(instanced(group, new THREE.SphereGeometry(0.34, 8, 6), mat(0x33562f, 0.95), shrubs));

  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const doorP = along(1.4);

  return {
    group, exterior, polyline: pl, at: (t) => at(pl, t),
    lotW, roofSignMesh: roof, cafeMesh: cafe,
    hotel: h,
    doorWorld: V(doorP.x + h.nx * 2.4, 1.7, doorP.z + h.nz * 2.4),
    // Where the walk ends. 27 m back at a ~45° FOV spans about 40 m of
    // frontage, which is what it takes to hold cafe.cafe (17 m to the right)
    // and the inward bend (18 m to the left) in the same frame as the hotel.
    standWorld: V(h.x + h.nx * 27, 5.0, h.z + h.nz * 27),
    // Aimed between the hotel and the cafe rather than dead-on the hotel, so
    // both clear the phase panel that occupies the right of the layout.
    facadeTarget: (() => { const m = at(pl, SALIM_AT - 7); return V(m.x + m.nx * 0.2, 5.2, m.z + m.nz * 0.2); })(),
    frontWorld: V(h.x + h.nx * 34, 7.5, h.z + h.nz * 34),
  };
}
