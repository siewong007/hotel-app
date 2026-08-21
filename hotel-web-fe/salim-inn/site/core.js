import * as THREE from '../vendor/three.module.min.js';

// CALIBRATION
// One world unit is one metre, and site/plan.js is already in metres — traced
// from a Google Earth capture whose own scale bar gave 0.12481 m per pixel.
//
// Two earlier scale faults this replaces: plan coordinates were divided by 10
// while heights stayed in metres, so every building extruded to ~84 m; and the
// trace came from a road map at a different zoom, so the blocks sat in the
// wrong place relative to Farley and the hotel.
export const GROUND_STOREY = 4.2; // tall ground floor, five-foot way beneath
export const STOREY = 3.4;
export const SHOPHOUSE_H = GROUND_STOREY + STOREY * 2; // 11.0 m to roof slab
export const PARAPET_H = 0.9;

// Modelled ground. The origin is the Salim Inn pin at the north-east corner of
// the complex, so the plate is offset south-west to cover Farley and the car
// parks. See site/plan.js for the survey this is built on.
export const SITE_CENTRE = [-80, 55];
export const SITE_W = 320;
export const SITE_D = 290;

// Plan metres straight into three.js: +x east, +z south, y up.
export const planP = (x, z, y = 0) => new THREE.Vector3(x, y, z);

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smooth = (t) => t * t * (3 - 2 * t);
export const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export const range = (p, a, b) => smooth(clamp((p - a) / (b - a), 0, 1));

// Frontage polylines. Terraces here bend — the Salim Inn row turns twice — so
// rows are swept along a line rather than placed as one straight block.
// `at(t)` gives the point, the frontage direction, the outward (street-facing)
// normal, and the Y rotation that puts a box's local +x along the frontage
// with its local -z facing the street.
export function polyline(pts) {
  const segs = [];
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    segs.push({ ax, az, dx: (bx - ax) / len, dz: (bz - az) / len, len, start: acc });
    acc += len;
  }
  return { segs, total: acc };
}

export function alongLine(pl, t) {
  const s = pl.segs.find((q) => t <= q.start + q.len) || pl.segs[pl.segs.length - 1];
  const u = t - s.start;
  return {
    x: s.ax + s.dx * u,
    z: s.az + s.dz * u,
    dx: s.dx,
    dz: s.dz,
    nx: s.dz,
    nz: -s.dx,
    ry: Math.atan2(-s.dz, s.dx),
  };
}

export function mat(color, rough = 0.82, metal = 0.02, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
}

export function box(parent, x, y, z, w, h, d, m, cast = true) {
  const q = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  q.position.set(x, y, z);
  q.castShadow = cast;
  q.receiveShadow = true;
  parent.add(q);
  return q;
}

const _o = new THREE.Object3D();
const _c = new THREE.Color();

// Every repeated element in the scene — parking bays, facade fins, cars,
// trolleys, palms, condensers — goes through here so a few hundred visible
// objects stay a handful of draw calls.
export function instanced(parent, geo, material, transforms, { cast = false, receive = true } = {}) {
  const mesh = new THREE.InstancedMesh(geo, material, transforms.length);
  let tinted = false;
  transforms.forEach((t, i) => {
    _o.position.set(t.x || 0, t.y || 0, t.z || 0);
    _o.rotation.set(t.rx || 0, t.ry || 0, t.rz || 0);
    _o.scale.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1);
    _o.updateMatrix();
    mesh.setMatrixAt(i, _o.matrix);
    if (t.color !== undefined) {
      mesh.setColorAt(i, _c.set(t.color));
      tinted = true;
    }
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (tinted && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  parent.add(mesh);
  return mesh;
}

// Signage painted onto a plane rather than a Sprite. Sprites always turn to
// face the camera, which is right for a floating UI marker and wrong for
// lettering fixed to a wall — the old build's fascia signs swung as the camera
// tracked past them.
export function canvasPlane(width, height, draw, { px = 1024, emissive = false } = {}) {
  const c = document.createElement('canvas');
  c.width = px;
  c.height = Math.round((px * height) / width);
  draw(c.getContext('2d'), c.width, c.height);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const material = emissive
    ? new THREE.MeshBasicMaterial({ map, transparent: true, toneMapped: false })
    : new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.78, metalness: 0.02 });
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
}

// Floating marker label. Unlike wall signage this *should* turn to face the
// camera, so it stays a Sprite.
export function spriteLabel(text, accent = false, scale = 4) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  c.width = 1024;
  c.height = 256;
  ctx.fillStyle = accent ? 'rgba(10,30,23,.94)' : 'rgba(8,15,13,.88)';
  ctx.strokeStyle = accent ? 'rgba(217,181,114,.9)' : 'rgba(255,255,255,.2)';
  ctx.lineWidth = 5;
  ctx.roundRect(16, 24, 992, 208, 28);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = accent ? '#f4d89d' : '#fffdf7';
  ctx.font = '600 54px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 512, 128);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false }));
  s.scale.set(scale, scale * 0.25, 1);
  return s;
}

// Deterministic jitter. Cars, planting and window lights need to look
// unplanned, but a scroll-scrubbed scene must render identically every frame
// and on every reload, so nothing may call Math.random().
export function rand(seed) {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// Shared palette. Colours are read off the Google Earth footage: cream and
// charcoal shophouse bands, the multi-green Farley fin screen, dry asphalt.
//
// Resampled 2026-08-22 against the walkthrough: the previous surface values
// were mixed for a near-black clear colour, so under the daylight sky
// (site/sky.js) the aprons read as wet night asphalt where the footage shows
// dry mid-grey, and the verges as black where it shows bright turf.
export const PALETTE = {
  asphalt: 0x4c5153,
  asphaltLight: 0x5b6062,
  concrete: 0x8d9090,
  kerbWhite: 0xd8d4c8,
  kerbRed: 0x9c3f38,
  bayLine: 0xe4e0d0,
  roadLine: 0xdedac8,
  grass: 0x4a6b3c,
  cream: 0xeae4cd,
  creamDeep: 0xdbd4b9,
  charcoal: 0x2f3639,
  pier: 0x6f7375,
  windowDark: 0x222b30,
  mullion: 0xd5d8d5,
  canopy: 0x1b1f22,
  terracotta: 0xa4543a,
  farleyGreens: [0x0d7a45, 0x149c58, 0x2bb96d, 0x06603a],
  farleyPanel: 0x6c7478,
  farleyBase: 0xb9bdb8,
  tentWhite: 0xeef0ec,
  roofRed: 0x7c3b2c,
  trolley: 0x2f7a44,
  // Roof metals, read off the top-down capture: the commercial terraces are
  // mostly pale blue-grey and off-white standing seam, with two runs of the
  // red-brown that dominates the housing behind them.
  roofBlue: 0x76838b,
  roofPale: 0x9aa09a,
  roofBrown: 0x77463a,
  foliage: 0x3d6236,
  foliageLight: 0x517c42,
};

// ---------------------------------------------------------------------------
// Roofs.
//
// Every terrace in the Google Earth capture is a long pitched metal roof —
// blue-grey, off-white or red-brown — running the full depth of the block
// behind its street parapet. The rows here used to stop at a flat slab, which
// is why the establishing aerial read as a set of blank white boxes on a dark
// plate rather than as the block in the footage.
//
// The roof is swept along the same frontage polyline the terrace is, so it
// follows the bends instead of needing one prism per straight run. `u` runs
// along the ridge in metres and `v` across the slope, so the standing-seam
// texture below tiles at a real-world pitch.
export function gableRoof(pl, depth, rise, baseY, overhang = 0.5, step = 2) {
  const pos = [];
  const uv = [];
  const half = depth / 2;

  const sample = (t) => {
    const f = alongLine(pl, t);
    // -n is into the building, so the eave is `overhang` proud of the frontage
    // and the far eave hangs the same distance past the rear wall.
    return {
      o: [f.x + f.nx * overhang, baseY, f.z + f.nz * overhang],
      i: [f.x - f.nx * (depth + overhang), baseY, f.z - f.nz * (depth + overhang)],
      r: [f.x - f.nx * half, baseY + rise, f.z - f.nz * half],
    };
  };

  // a/c are the eave corners of one strip, b/d the ridge corners above them.
  const quad = (a, b, c, d, t0, t1) => {
    pos.push(...a, ...b, ...c, ...b, ...d, ...c);
    uv.push(t0, 0, t0, 1, t1, 0, t0, 1, t1, 1, t1, 0);
  };

  let prev = sample(0);
  for (let t = step; t <= pl.total + step * 0.5; t += step) {
    const tt = Math.min(t, pl.total);
    if (tt <= t - step) break;
    const cur = sample(tt);
    quad(prev.o, prev.r, cur.o, cur.r, t - step, tt); // street slope
    quad(prev.i, prev.r, cur.i, cur.r, t - step, tt); // rear slope
    prev = cur;
  }

  // Gable ends, so the roof is not see-through when the camera is level with it.
  for (const t of [0, pl.total]) {
    const s = sample(t);
    pos.push(...s.o, ...s.r, ...s.i);
    uv.push(0, 0, 0.5, 1, 1, 0);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

// Standing-seam ribs, as a stripe running down the slope. Tiled by setting
// `repeat.x = 1 / pitch` against UVs measured in metres along the ridge.
let _seam = null;
export function seamTexture(pitch = 0.62) {
  if (!_seam) {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 4;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 64, 4);
    ctx.fillStyle = 'rgba(0,0,0,.20)';
    ctx.fillRect(0, 0, 4, 4);
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.fillRect(4, 0, 3, 4);
    _seam = new THREE.CanvasTexture(c);
    _seam.colorSpace = THREE.SRGBColorSpace;
    _seam.wrapS = THREE.RepeatWrapping;
    _seam.wrapT = THREE.ClampToEdgeWrapping;
    _seam.anisotropy = 8;
  }
  const t = _seam.clone();
  t.needsUpdate = true;
  t.repeat.set(1 / pitch, 1);
  return t;
}

export function roofMaterial(color, pitch = 0.62) {
  return new THREE.MeshStandardMaterial({
    color, map: seamTexture(pitch), roughness: 0.74, metalness: 0.08,
    transparent: true, side: THREE.DoubleSide,
  });
}
