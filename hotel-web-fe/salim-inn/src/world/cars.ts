// Seven low-poly vehicles typical of a Sibu car park (hatchback, sedan,
// double-cab pickup, SUV, MPV, kei car, light box truck), built as lofts:
// rounded super-ellipse sections swept along the car over a smoothed side
// profile, with plan rounding at both ends, wheel arches cut into the sill
// line and a tumblehome greenhouse. Every body face carries a material kind
// (aKind: 0 paint, 1 glass, 2 black trim), so one batched mesh draws paint,
// glass and pillars with per-instance paint colour; lamps, tyres and rims go
// in a vertex-coloured trim mesh. Three levels of detail per model.
// Origin: centre of the footprint on the ground; the car points along +Z.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type P = [number, number];
interface Spec {
  name: string;
  L: number; W: number; r: number;
  wheels: [number, number];
  top: P[]; // lower-body top line, rear → front (x from the rear, y up)
  clear: number; // sill height between the wheels
  lift: [number, number]; // how far the underside rises at the rear / front ends
  cabin: P[]; // greenhouse top line, rear base → front base
  tumble: number; // greenhouse narrowing at the roof (share of the half-width)
  plan: [number, number]; // plan rounding length at the rear / front
  endW: number; // half-width share left at the extreme ends
  n: number; // lower-section squareness (2 = ellipse, higher = boxier)
  pillars: number[]; // B/C pillar x positions (blacked out)
  bed?: [number, number]; // pickup bed under a tonneau cover
  box?: [number, number, number]; // cargo box x0, x1, top
}

const SPECS: Spec[] = [
  { name: 'hatch', L: 3.9, W: 1.73, r: 0.3, wheels: [0.64, 3.2], clear: 0.3, lift: [0.14, 0.1], n: 3.0, tumble: 0.2, plan: [0.45, 0.6], endW: 0.8, pillars: [1.62],
    top: [[0, 0.9], [0.14, 0.99], [2.9, 1.02], [3.5, 0.88], [3.9, 0.7]],
    cabin: [[0.06, 0.95], [0.34, 1.46], [0.72, 1.5], [2.25, 1.5], [2.98, 0.96]] },
  { name: 'sedan', L: 4.45, W: 1.74, r: 0.31, wheels: [0.8, 3.44], clear: 0.3, lift: [0.12, 0.1], n: 3.0, tumble: 0.21, plan: [0.55, 0.62], endW: 0.78, pillars: [2.32],
    top: [[0, 0.84], [0.16, 0.97], [1.0, 1.0], [3.3, 1.0], [3.95, 0.86], [4.45, 0.68]],
    cabin: [[0.9, 0.94], [1.6, 1.42], [1.9, 1.46], [2.75, 1.46], [3.4, 0.95]] },
  { name: 'pickup', L: 5.3, W: 1.85, r: 0.38, wheels: [1.0, 4.12], clear: 0.44, lift: [0.1, 0.12], n: 4.2, tumble: 0.12, plan: [0.2, 0.55], endW: 0.86, pillars: [2.95], bed: [0.08, 2.0],
    top: [[0, 1.1], [0.06, 1.16], [3.95, 1.19], [4.55, 1.08], [5.3, 0.93]],
    cabin: [[2.02, 1.12], [2.1, 1.8], [2.3, 1.84], [3.45, 1.84], [4.08, 1.13]] },
  { name: 'suv', L: 4.55, W: 1.85, r: 0.36, wheels: [0.84, 3.56], clear: 0.38, lift: [0.1, 0.12], n: 3.4, tumble: 0.15, plan: [0.45, 0.62], endW: 0.8, pillars: [1.05, 2.1],
    top: [[0, 0.98], [0.1, 1.09], [3.5, 1.12], [4.1, 0.99], [4.55, 0.8]],
    cabin: [[0.08, 1.02], [0.36, 1.63], [0.78, 1.68], [2.9, 1.68], [3.58, 1.06]] },
  { name: 'mpv', L: 4.45, W: 1.74, r: 0.31, wheels: [0.78, 3.5], clear: 0.32, lift: [0.1, 0.1], n: 3.2, tumble: 0.14, plan: [0.4, 0.62], endW: 0.8, pillars: [1.2, 2.35],
    top: [[0, 0.94], [0.1, 1.04], [3.4, 1.07], [4.0, 0.91], [4.45, 0.72]],
    cabin: [[0.05, 0.98], [0.26, 1.62], [0.62, 1.68], [3.0, 1.68], [3.58, 1.0]] },
  { name: 'kei', L: 3.4, W: 1.5, r: 0.27, wheels: [0.56, 2.84], clear: 0.28, lift: [0.08, 0.08], n: 3.0, tumble: 0.18, plan: [0.35, 0.45], endW: 0.82, pillars: [1.45],
    top: [[0, 0.9], [0.08, 0.96], [2.6, 0.99], [3.05, 0.85], [3.4, 0.7]],
    cabin: [[0.04, 0.93], [0.2, 1.5], [0.5, 1.55], [2.2, 1.55], [2.78, 0.94]] },
  { name: 'truck', L: 5.2, W: 1.9, r: 0.38, wheels: [1.1, 4.3], clear: 0.46, lift: [0, 0.05], n: 5.5, tumble: 0.06, plan: [0.05, 0.25], endW: 0.9, pillars: [], box: [0.0, 3.45, 2.45],
    top: [[0, 0.95], [3.4, 0.95], [3.5, 1.24], [5.0, 1.26], [5.2, 1.12]],
    cabin: [[3.48, 1.18], [3.52, 2.08], [3.62, 2.12], [4.85, 2.12], [5.16, 1.2]] },
];

// ---------- profile helpers ----------
function lerpLine(line: P[], x: number): number {
  if (x <= line[0][0]) return line[0][1];
  for (let i = 0; i < line.length - 1; i++) {
    const [x0, y0] = line[i], [x1, y1] = line[i + 1];
    if (x <= x1) return y0 + (y1 - y0) * ((x - x0) / Math.max(1e-6, x1 - x0));
  }
  return line[line.length - 1][1];
}
/** Box-filtered line: rounds the kinks of the piecewise profile. */
function smoothLine(line: P[], x: number, w: number): number {
  let s = 0;
  for (let k = -3; k <= 3; k++) s += lerpLine(line, x + (k / 3) * w);
  return s / 7;
}
const sgnPow = (v: number, e: number) => Math.sign(v) * Math.pow(Math.abs(v), e);
const TOP_N = 1.6; // extra squareness above the waist: crisp shoulders, flat bonnet

interface Section { hw: number; yb: number; yt: number }

function bodySection(s: Spec, x: number): Section {
  const { L, W, r } = s;
  const d = Math.min(x, L - x);
  const pr = x < L / 2 ? s.plan[0] : s.plan[1];
  const t = THREE.MathUtils.clamp(d / pr, 0, 1);
  let hw = (W / 2) * (s.endW + (1 - s.endW) * Math.sqrt(1 - (1 - t) * (1 - t)));
  let yt = smoothLine(s.top, x, 0.18);
  // underside: sill line, rising over the overhangs
  let yb = s.clear;
  const [xr, xf] = s.wheels;
  if (x < xr) yb += s.lift[0] * THREE.MathUtils.smoothstep(xr - x, 0.2, xr);
  if (x > xf) yb += s.lift[1] * THREE.MathUtils.smoothstep(x - xf, 0.2, L - xf);
  // wheel arches
  const Ra = r + 0.075;
  for (const xw of s.wheels) {
    const dx = x - xw;
    if (Math.abs(dx) < Ra) yb = Math.max(yb, r + Math.sqrt(Ra * Ra - dx * dx) * 0.98);
  }
  // end fillet: sections shrink over the last 16 cm
  const f = THREE.MathUtils.clamp(d / 0.16, 0, 1);
  const k = 0.6 + 0.4 * Math.sqrt(1 - (1 - f) * (1 - f));
  const yc = (yt + yb) / 2;
  const hh = Math.max(0.03, (yt - yb) / 2) * k;
  hw *= k;
  yt = yc + hh;
  yb = yc - hh;
  return { hw, yb, yt };
}

/** Half-width of the body section at height y (−1 outside it). */
function sectionZ(s: Spec, sec: Section, y: number): number {
  const yc = (sec.yt + sec.yb) / 2, hh = (sec.yt - sec.yb) / 2;
  const q = (y - yc) / hh;
  if (Math.abs(q) >= 1) return -1;
  const n = q > 0 ? s.n + TOP_N : s.n;
  return sec.hw * Math.pow(1 - Math.pow(Math.abs(q), n), 1 / n);
}

// ---------- mesh assembly ----------
class Builder {
  pos: number[] = [];
  nrm: number[] = [];
  kind: number[] = [];

  /** Quad grid over rings (smooth normals), then one material kind per face. */
  grid(rings: THREE.Vector3[][], closed: boolean, kindOf: (j: number, c: THREE.Vector3) => number, capEnds = false): void {
    const m = rings[0].length;
    const verts: number[] = [];
    for (const ring of rings) for (const v of ring) verts.push(v.x, v.y, v.z);
    const idx: number[] = [];
    const faceKind: number[] = [];
    const segs = closed ? m : m - 1;
    const c = new THREE.Vector3();
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < segs; j++) {
        const j1 = (j + 1) % m;
        const a = i * m + j, b = i * m + j1, cc = (i + 1) * m + j, d = (i + 1) * m + j1;
        c.copy(rings[i][j]).add(rings[i][j1]).add(rings[i + 1][j]).add(rings[i + 1][j1]).multiplyScalar(0.25);
        const kd = kindOf(j, c);
        idx.push(a, cc, b, b, cc, d);
        faceKind.push(kd, kd);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const flat = g.toNonIndexed();
    const p = flat.getAttribute('position'), n = flat.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      this.kind.push(faceKind[Math.floor(i / 3)]);
    }
    if (capEnds) {
      for (const first of [true, false]) {
        const ring = first ? rings[0] : rings[rings.length - 1];
        const ctr = ring.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / ring.length);
        const nx = first ? -1 : 1;
        for (let j = 0; j < m; j++) {
          const a = ring[j], b = ring[(j + 1) % m];
          for (const v of first ? [ctr, a, b] : [ctr, b, a]) {
            this.pos.push(v.x, v.y, v.z);
            this.nrm.push(nx, 0, 0);
            this.kind.push(0);
          }
        }
      }
    }
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.kind, 1));
    return g;
  }
}

interface Detail { step: number; ring: number; gStep: number; wheelSeg: number; rims: boolean; lamps: boolean }
const DETAIL: Detail[] = [
  { step: 0.11, ring: 24, gStep: 0.08, wheelSeg: 18, rims: true, lamps: true },
  { step: 0.3, ring: 12, gStep: 0.24, wheelSeg: 10, rims: true, lamps: true },
  { step: 0.8, ring: 8, gStep: 0.6, wheelSeg: 6, rims: false, lamps: false },
];

function stations(x0: number, x1: number, step: number, extra: number[]): number[] {
  const xs = new Set<number>();
  const n = Math.max(2, Math.ceil((x1 - x0) / step));
  for (let i = 0; i <= n; i++) xs.add(+(x0 + ((x1 - x0) * i) / n).toFixed(4));
  for (const e of extra) if (e > x0 && e < x1) xs.add(+e.toFixed(4));
  return [...xs].sort((a, b) => a - b);
}

function buildBody(s: Spec, D: Detail): THREE.BufferGeometry {
  const B = new Builder();
  const { L } = s;
  const hi = D.step < 0.2;
  // denser stations at the end fillets and around the wheel arches
  const extra = hi ? [0.015, 0.04, 0.08, 0.13, L - 0.015, L - 0.04, L - 0.08, L - 0.13] : [0.05, L - 0.05];
  if (hi) for (const xw of s.wheels) for (let k = -5; k <= 5; k++) extra.push(xw + k * 0.075);
  const xs = stations(0, L, D.step, extra);
  const m = D.ring;
  const rings: THREE.Vector3[][] = xs.map((x) => {
    const { hw, yb, yt } = bodySection(s, x);
    const yc = (yt + yb) / 2, hh = (yt - yb) / 2;
    const ring: THREE.Vector3[] = [];
    for (let j = 0; j < m; j++) {
      const th = (j / m) * Math.PI * 2; // 0 = +z side, π/2 = top
      const n = Math.sin(th) > 0 ? s.n + TOP_N : s.n;
      ring.push(new THREE.Vector3(x, yc + hh * sgnPow(Math.sin(th), 2 / n), hw * sgnPow(Math.cos(th), 2 / n)));
    }
    return ring;
  });
  const bed = s.bed;
  B.grid(rings, true, (j, c) => {
    const sn = Math.sin(((j + 0.5) / m) * Math.PI * 2);
    if (bed && c.x > bed[0] && c.x < bed[1] && sn > 0.55) return 2; // tonneau cover
    if (sn < -0.6) return 2; // underside
    return 0;
  }, true);

  // greenhouse: sits on the waist 6 cm below the top line, tumbling inward
  const c0 = s.cabin[0][0], c1 = s.cabin[s.cabin.length - 1][0];
  const roofMax = Math.max(...s.cabin.map((q) => q[1]));
  const belt = (x: number) => smoothLine(s.top, x, 0.18) - 0.06;
  const H = (x: number) => {
    const taper = THREE.MathUtils.smoothstep(x, c0, c0 + 0.05) * (1 - THREE.MathUtils.smoothstep(x, c1 - 0.05, c1));
    return Math.max(0.003, (smoothLine(s.cabin, x, 0.07) - belt(x)) * taper);
  };
  const gx = stations(c0, c1, D.gStep, s.pillars.flatMap((p) => [p - 0.05, p + 0.05]));
  const maxH = Math.max(...gx.map(H));
  const tall = gx.filter((x) => H(x) > 0.5 * maxH);
  const sideX0 = tall[0], sideX1 = tall[tall.length - 1];
  const CORNER = 3;
  const gRing = (x: number) => {
    const yb = belt(x);
    const h = H(x);
    const wb = Math.max(0.2, sectionZ(s, bodySection(s, x), yb) - 0.004);
    const wt = wb - s.tumble * (s.W / 2);
    const cv = Math.min(0.45, 0.09 / h), cu = Math.min(0.35, 0.09 / wt);
    const uv: [number, number][] = [[1, 0], [1, 0.5 * (1 - cv)], [1, 1 - cv]];
    for (let k = 1; k < CORNER; k++) { const a = (k / CORNER) * Math.PI / 2; uv.push([1 - cu + cu * Math.cos(a), 1 - cv + cv * Math.sin(a)]); }
    uv.push([1 - cu, 1], [0.35, 1.012], [-0.35, 1.012], [-(1 - cu), 1]);
    for (let k = CORNER - 1; k >= 1; k--) { const a = (k / CORNER) * Math.PI / 2; uv.push([-(1 - cu + cu * Math.cos(a)), 1 - cv + cv * Math.sin(a)]); }
    uv.push([-1, 1 - cv], [-1, 0.5 * (1 - cv)], [-1, 0]);
    return uv.map(([u, v]) => new THREE.Vector3(x, yb + v * h, u * THREE.MathUtils.lerp(wb, wt, Math.min(1, v))));
  };
  const gRings = gx.map(gRing);
  // segment layout per ring: 2 side, 3 corner, 3 top, 3 corner, 2 side
  const segs = gRings[0].length - 1;
  B.grid(gRings, false, (j, c) => {
    if (c.y - belt(c.x) < 0.03) return 0; // waist line in body colour
    const side = j < 2 || j >= segs - 2;
    const corner = (j >= 2 && j < 2 + CORNER) || (j >= segs - 2 - CORNER && j < segs - 2);
    if (corner) return 0; // roof rails and A/C pillars
    if (side) {
      if (c.x < sideX0 || c.x > sideX1) return 2; // quarter panels
      for (const p of s.pillars) if (Math.abs(c.x - p) < 0.05) return 2; // blacked-out pillars
      return 1;
    }
    // top: flat roof in paint; windscreen and rear screen in glass
    return smoothLine(s.cabin, c.x, 0.07) > roofMax - 0.025 ? 0 : 1;
  });
  return B.toGeometry();
}

function colour(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const ng = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(ng.attributes)) if (k !== 'position' && k !== 'normal') ng.deleteAttribute(k);
  const n = ng.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  ng.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return ng;
}

/** x of the body surface at the rear (end 0) or front (end 1), at height y and offset z. */
function surfaceX(s: Spec, end: 0 | 1, y: number, z: number): number {
  for (let d = 0; d < 0.6; d += 0.005) {
    const x = end === 0 ? d : s.L - d;
    if (sectionZ(s, bodySection(s, x), y) >= Math.abs(z)) return x;
  }
  return end === 0 ? 0.3 : s.L - 0.3;
}

function buildTrim(s: Spec, D: Detail): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const hw = s.W / 2;
  for (const x of s.wheels) for (const side of [-1, 1]) {
    const tz = side * (hw - 0.14);
    parts.push(colour(new THREE.CylinderGeometry(s.r, s.r, 0.21, D.wheelSeg).rotateX(Math.PI / 2).translate(x, s.r, tz), 0x151617));
    if (D.rims) {
      parts.push(colour(new THREE.CylinderGeometry(s.r * 0.62, s.r * 0.62, 0.215, Math.max(6, D.wheelSeg - 6)).rotateX(Math.PI / 2).translate(x, s.r, tz + side * 0.003), 0x9ca2a7));
      parts.push(colour(new THREE.CylinderGeometry(s.r * 0.2, s.r * 0.2, 0.225, 6).rotateX(Math.PI / 2).translate(x, s.r, tz + side * 0.006), 0x3b3f43));
    }
  }
  if (s.box) {
    const [x0, x1, top] = s.box;
    parts.push(colour(new THREE.BoxGeometry(x1 - x0, top - 0.97, s.W + 0.06).translate((x0 + x1) / 2, 0.97 + (top - 0.97) / 2, 0), 0xdadcdd));
  }
  if (D.lamps) {
    const lamp = (end: 0 | 1, y: number, z: number, w: number, h: number, hex: number) => {
      const x = surfaceX(s, end, y, Math.abs(z) + w * 0.4);
      parts.push(colour(new THREE.BoxGeometry(0.06, h, w).translate(end === 0 ? x + 0.015 : x - 0.015, y, z), hex));
    };
    const yR = s.box ? 0.62 : lerpLine(s.top, 0) - (s.name === 'sedan' ? 0.08 : 0.13);
    const yF = lerpLine(s.top, s.L) - 0.07;
    for (const side of [-1, 1]) {
      lamp(0, yR, side * (hw * 0.68), 0.3, s.box ? 0.1 : 0.13, 0x9c1018);
      lamp(1, yF, side * (hw * 0.62), 0.36, 0.1, 0xd7dee4);
      // door mirrors
      const xm = s.cabin[s.cabin.length - 1][0] - 0.2;
      const ym = lerpLine(s.top, xm) + 0.06;
      parts.push(colour(new THREE.BoxGeometry(0.16, 0.1, 0.17).translate(xm, ym, side * (sectionZ(s, bodySection(s, xm), ym - 0.08) + 0.07)), 0x17191b));
    }
    // grille and blank number plates
    const yG = lerpLine(s.top, s.L) - 0.24;
    parts.push(colour(new THREE.BoxGeometry(0.06, 0.16, s.W * 0.42).translate(surfaceX(s, 1, yG, s.W * 0.21) - 0.012, yG, 0), 0x131416));
    const yP = s.box ? 0.62 : 0.52;
    parts.push(colour(new THREE.BoxGeometry(0.04, 0.12, 0.52).translate(surfaceX(s, 0, yP, 0.26) + 0.01, yP, 0), 0x0e0f10));
  }
  return mergeGeometries(parts, false)!;
}

export interface CarModel {
  name: string;
  /** per level of detail: body (paint / glass / trim kinds) and vertex-coloured trim */
  paint: THREE.BufferGeometry[];
  trim: THREE.BufferGeometry[];
  length: number;
  width: number;
}

function place(g: THREE.BufferGeometry, L: number): THREE.BufferGeometry {
  // model space: centre the footprint, point along +Z
  g.translate(-L / 2, 0, 0);
  g.rotateY(-Math.PI / 2);
  return g;
}

export function buildCarModels(): CarModel[] {
  return SPECS.map((s) => ({
    name: s.name,
    paint: DETAIL.map((D) => place(buildBody(s, D), s.L)),
    trim: DETAIL.map((D) => place(buildTrim(s, D), s.L)),
    length: s.L,
    width: s.W,
  }));
}

/** LOD switch distances (metres from the camera). */
export const CAR_LOD = [34, 130];

/** Weighted mix of models for a Sibu car park (pickups and compacts dominate). */
export const MODEL_WEIGHTS = [0.18, 0.2, 0.2, 0.13, 0.14, 0.11, 0.04];

/** Car paint colours, weighted toward white and silver as in the frames. */
export const CAR_PAINTS = [0xf2f2ef, 0xf4f4f1, 0xeeeeea, 0xe8e8e4, 0xc9ccce, 0xb2b6b9, 0x8d9195, 0x2a2c2f, 0x1b1d20, 0x5b0f14, 0x7c1b1f, 0x2c3e57, 0x9aa1a6, 0xa3301f, 0x46505a];
