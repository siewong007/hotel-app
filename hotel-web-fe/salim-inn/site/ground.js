import * as THREE from '../vendor/three.module.min.js';
import { ROWS, SALIM_FRONT, SALIM_DEPTH, FARLEY_CENTRE, FARLEY_W, FARLEY_D, FARLEY_FRONT } from './plan.js';
import { mat, instanced, polyline, alongLine, PALETTE, SITE_W, SITE_D, SITE_CENTRE } from './core.js';

// The ground used to be a 530 KB base64 screenshot of a Google road map — 93%
// of the page's JavaScript, and the reason the scene read as a floating map
// rather than a place. It is now geometry: asphalt, painted bays, kerbs and
// verges, with a schematic plan drawn onto a canvas at runtime to preserve
// what the "Map alignment" toggle cross-fades. All coordinates are traced
// plan metres; see site/plan.js.

const ROADS = [
  // Jalan Tun Ahmad Zaidi Adruce, the dual carriageway on the north-east side.
  { w: 22, pts: [[54, -42], [68, 17], [66, 51], [51, 91], [31, 130]] },
  // Jalan Salim, running down the western edge.
  { w: 14, pts: [[-168, -35], [-176, 30], [-185, 131]] },
  // Lorong Salim 17 along the bottom.
  { w: 12, pts: [[-200, 158], [-150, 180], [-84, 192]] },
  // The internal ring the complex is built around — the route a guest walks.
  {
    w: 12,
    pts: [[-162, 62], [-152, 16], [-120, -20], [-70, -40], [-16, -24],
      [16, 22], [8, 84], [-32, 132], [-104, 156], [-152, 124], [-164, 88]],
  },
];

const VERGES = [
  { c: [38, 30], w: 26, d: 150, rot: 0.28 },
  { c: [-206, 60], w: 26, d: 130, rot: -0.1 },
  { c: [-70, 178], w: 150, d: 20, rot: 0.12 },
];

function ribbon(pts, width) {
  // Quads between consecutive centreline points, mitred by averaging the
  // normals at each joint so the carriageway does not gap on corners.
  const v = pts.map((p) => new THREE.Vector2(p[0], p[1]));
  const normals = v.map((_, i) => {
    const a = v[Math.max(0, i - 1)];
    const b = v[Math.min(v.length - 1, i + 1)];
    const d = new THREE.Vector2(b.x - a.x, b.y - a.y).normalize();
    return new THREE.Vector2(-d.y, d.x);
  });
  const pos = [];
  const uv = [];
  for (let i = 0; i < v.length - 1; i++) {
    const h = width / 2;
    const [p0, p1] = [v[i], v[i + 1]];
    const [n0, n1] = [normals[i], normals[i + 1]];
    const a = [p0.x + n0.x * h, p0.y + n0.y * h];
    const b = [p0.x - n0.x * h, p0.y - n0.y * h];
    const c = [p1.x + n1.x * h, p1.y + n1.y * h];
    const d = [p1.x - n1.x * h, p1.y - n1.y * h];
    pos.push(a[0], 0, a[1], b[0], 0, b[1], c[0], 0, c[1]);
    pos.push(b[0], 0, b[1], d[0], 0, d[1], c[0], 0, c[1]);
    uv.push(0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

// Schematic plan for the "Map alignment" underlay. Drawn as a survey overlay
// rather than opaque paper: an opaque plan reads as a white sheet under the
// model and washes every material above it out.
function schematicTexture() {
  const S = 2; // px per metre
  const c = document.createElement('canvas');
  c.width = SITE_W * S;
  c.height = SITE_D * S;
  const ctx = c.getContext('2d');
  const X = (x) => (x - SITE_CENTRE[0] + SITE_W / 2) * S;
  const Y = (z) => (z - SITE_CENTRE[1] + SITE_D / 2) * S;
  ctx.clearRect(0, 0, c.width, c.height);

  ctx.strokeStyle = 'rgba(196,214,224,.30)';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const r of ROADS) {
    ctx.lineWidth = r.w * S;
    ctx.beginPath();
    r.pts.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
    ctx.stroke();
  }

  const slab = (pl, depth) => {
    const a = alongLine(pl, 0);
    const b = alongLine(pl, pl.total);
    ctx.beginPath();
    ctx.moveTo(X(a.x), Y(a.z));
    for (let t = 0; t <= pl.total; t += 4) {
      const f = alongLine(pl, t);
      ctx.lineTo(X(f.x), Y(f.z));
    }
    ctx.lineTo(X(b.x - b.nx * depth), Y(b.z - b.nz * depth));
    for (let t = pl.total; t >= 0; t -= 4) {
      const f = alongLine(pl, t);
      ctx.lineTo(X(f.x - f.nx * depth), Y(f.z - f.nz * depth));
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(233,214,166,.24)';
    ctx.strokeStyle = 'rgba(226,201,143,.65)';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
  };

  slab(polyline(SALIM_FRONT), SALIM_DEPTH);
  for (const row of ROWS) slab(polyline(row.front), row.depth);

  // Farley, as a rotated rectangle on its traced bearing.
  const [ax, az] = FARLEY_FRONT[0];
  const [bx, bz] = FARLEY_FRONT[1];
  const ang = Math.atan2(bz - az, bx - ax);
  ctx.save();
  ctx.translate(X(FARLEY_CENTRE[0]), Y(FARLEY_CENTRE[1]));
  ctx.rotate(ang);
  ctx.fillStyle = 'rgba(200,214,224,.22)';
  ctx.strokeStyle = 'rgba(178,199,212,.6)';
  ctx.fillRect(-FARLEY_W / 2 * S, -FARLEY_D / 2 * S, FARLEY_W * S, FARLEY_D * S);
  ctx.strokeRect(-FARLEY_W / 2 * S, -FARLEY_D / 2 * S, FARLEY_W * S, FARLEY_D * S);
  ctx.restore();

  ctx.fillStyle = 'rgba(190,208,218,.7)';
  ctx.font = `${5.5 * S}px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.save();
  ctx.translate(X(58), Y(40));
  ctx.rotate(1.32);
  ctx.fillText('JALAN TUN AHMAD ZAIDI ADRUCE', 0, 0);
  ctx.restore();
  ctx.save();
  ctx.translate(X(-178), Y(50));
  ctx.rotate(1.48);
  ctx.fillText('JALAN SALIM', 0, 0);
  ctx.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildGround(scene, renderer) {
  const group = new THREE.Group();
  scene.add(group);

  // Hinterland. The surfaced plate is only 320 x 290 m, so from the
  // establishing camera its edge used to cut a hard rectangle out of the
  // horizon with empty sky beyond. This runs the vegetated ground out well
  // past the fog's reach; nothing is modelled on it, it exists to close the
  // horizon the way the capture's does.
  const hinterland = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600),
    mat(0x4e6046, 0.97, 0)
  );
  hinterland.rotation.x = -Math.PI / 2;
  hinterland.position.set(SITE_CENTRE[0], -0.06, SITE_CENTRE[1]);
  group.add(hinterland);

  const pad = new THREE.Mesh(new THREE.PlaneGeometry(SITE_W, SITE_D), mat(PALETTE.asphalt, 0.95, 0.02));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(SITE_CENTRE[0], 0, SITE_CENTRE[1]);
  pad.receiveShadow = true;
  group.add(pad);

  const verge = mat(PALETTE.grass, 0.96, 0);
  for (const v of VERGES) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(v.w, v.d), verge);
    g.rotation.x = -Math.PI / 2;
    g.rotation.z = v.rot;
    g.position.set(v.c[0], 0.015, v.c[1]);
    g.receiveShadow = true;
    group.add(g);
  }

  const roadMat = mat(PALETTE.asphaltLight, 0.92, 0.03);
  for (const r of ROADS) {
    const road = new THREE.Mesh(ribbon(r.pts, r.w), roadMat);
    road.position.y = 0.03;
    road.receiveShadow = true;
    group.add(road);
  }

  // Lane markings. Without them the carriageways read as bare grey ribbons
  // from above, where the capture shows a clearly striped road grid — the
  // detail that tells the eye it is looking at a town rather than a diagram.
  const dashes = [];
  const edges = [];
  for (const r of ROADS) {
    const pl = polyline(r.pts);
    const n = Math.floor(pl.total / 9);
    for (let i = 0; i < n; i++) {
      const f = alongLine(pl, (i + 0.5) * 9);
      dashes.push({ x: f.x, y: 0.045, z: f.z, ry: f.ry });
      for (const s of [-1, 1]) {
        edges.push({ x: f.x + f.nx * s * (r.w / 2 - 0.6), y: 0.045, z: f.z + f.nz * s * (r.w / 2 - 0.6), ry: f.ry });
      }
    }
  }
  const lineMat = new THREE.MeshBasicMaterial({ color: PALETTE.roadLine, transparent: true, opacity: 0.68 });
  instanced(group, new THREE.BoxGeometry(4.2, 0.02, 0.22), lineMat, dashes);
  instanced(group, new THREE.BoxGeometry(8.4, 0.02, 0.16), lineMat, edges);

  // Red-and-white striped kerbs edging the Salim Inn frontage bays.
  const kerbs = [];
  const kerbLine = polyline([[-72, -44], [-28, -36], [6, -18], [18, 8]]);
  const n = Math.floor(kerbLine.total);
  for (let i = 0; i < n; i++) {
    const f = alongLine(kerbLine, i);
    kerbs.push({ x: f.x, y: 0.11, z: f.z, ry: f.ry, color: i % 2 ? PALETTE.kerbRed : PALETTE.kerbWhite });
  }
  instanced(group, new THREE.BoxGeometry(1, 0.22, 0.3), mat(0xffffff, 0.88), kerbs);

  const underlay = new THREE.Mesh(
    new THREE.PlaneGeometry(SITE_W, SITE_D),
    new THREE.MeshBasicMaterial({ map: schematicTexture(), transparent: true, opacity: 0.94, depthWrite: false })
  );
  underlay.rotation.x = -Math.PI / 2;
  underlay.position.set(SITE_CENTRE[0], 0.055, SITE_CENTRE[1]);
  underlay.renderOrder = 1;
  scene.add(underlay);
  if (renderer) underlay.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();

  return { group, underlay, underlayMat: underlay.material };
}
