// Small procedural-geometry toolkit shared by the world and interior builders.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Pt } from '../data/site';

export { mergeGeometries, mergeVertices };

/** Axis-aligned box with its min corner at (x0,y0,z0) — handy for walls. */
export function boxAt(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

/** Rounded box via ExtrudeGeometry bevel (brief: bevel every hard edge). */
export function roundedBox(w: number, h: number, d: number, r = 0.02, seg = 1): THREE.BufferGeometry {
  const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const shape = new THREE.Shape();
  const x = -w / 2 + rr, y = -h / 2 + rr, W = w - 2 * rr, H = h - 2 * rr;
  shape.moveTo(x, y);
  shape.lineTo(x + W, y);
  shape.lineTo(x + W, y + H);
  shape.lineTo(x, y + H);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(1e-3, d - 2 * rr), bevelEnabled: true, bevelThickness: rr, bevelSize: rr, bevelSegments: seg, curveSegments: 1 });
  g.translate(0, 0, -(d - 2 * rr) / 2);
  g.computeVertexNormals();
  return g;
}

export interface Opening {
  u0: number; // along the wall
  u1: number;
  v0: number; // height from wall base
  v1: number;
}

/** A straight wall from local x=0..length (along +X), height h, thickness t
 *  (occupying z ∈ [−t, 0]), with rectangular openings cut out. */
export function wallWithOpenings(length: number, h: number, t: number, openings: Opening[] = []): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const ops = openings.slice().sort((a, b) => a.u0 - b.u0);
  // columns between openings (full height), plus above/below each opening
  let cursor = 0;
  for (const o of ops) {
    if (o.u0 > cursor + 1e-4) parts.push(boxAt(cursor, 0, -t, o.u0, h, 0));
    if (o.v0 > 1e-4) parts.push(boxAt(o.u0, 0, -t, o.u1, o.v0, 0));
    if (o.v1 < h - 1e-4) parts.push(boxAt(o.u0, o.v1, -t, o.u1, h, 0));
    cursor = Math.max(cursor, o.u1);
  }
  if (cursor < length - 1e-4) parts.push(boxAt(cursor, 0, -t, length, h, 0));
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()), false)!;
  parts.forEach((p) => p.dispose());
  return g;
}

/** Ribbon along a polyline on the ground (y), width w, with mitred joins.
 *  UV.x = distance along, UV.y = 0..1 across. */
export function ribbon(points: Pt[], w: number, y = 0, maxMiter = 2.5): THREE.BufferGeometry | null {
  const pts = points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 0.05);
  if (pts.length < 2) return null;
  const n = pts.length;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const idx: number[] = [];
  let dist = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    let d0x = p[0] - prev[0], d0z = p[1] - prev[1];
    let d1x = next[0] - p[0], d1z = next[1] - p[1];
    const l0 = Math.hypot(d0x, d0z) || 1, l1 = Math.hypot(d1x, d1z) || 1;
    d0x /= l0; d0z /= l0; d1x /= l1; d1z /= l1;
    if (i === 0) { d0x = d1x; d0z = d1z; }
    if (i === n - 1) { d1x = d0x; d1z = d0z; }
    let tx = d0x + d1x, tz = d0z + d1z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    // normal to the tangent
    const nx = -tz, nz = tx;
    const cos = nx * -d1z + nz * d1x; // dot(normal, segment normal)
    const m = Math.min(maxMiter, 1 / Math.max(0.2, Math.abs(cos)));
    const hw = (w / 2) * m;
    if (i > 0) dist += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    pos.set([p[0] + nx * hw, y, p[1] + nz * hw, p[0] - nx * hw, y, p[1] - nz * hw], i * 6);
    uv.set([dist, 0, dist, 1], i * 4);
    if (i < n - 1) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // make sure the ribbon faces up regardless of winding
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  if (nrm.count && nrm.getY(0) < 0) {
    const index = g.getIndex()!;
    const arr = index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < arr.length; i += 3) { const t = arr[i + 1]; arr[i + 1] = arr[i + 2]; arr[i + 2] = t; }
    g.computeVertexNormals();
  }
  return g;
}

/** Flat polygon (outer ring + optional holes) triangulated at height y. */
export function flatPolygon(outer: THREE.Vector2[], holes: THREE.Vector2[][] = [], y = 0): THREE.BufferGeometry {
  const shape = new THREE.Shape(outer.map((p) => new THREE.Vector2(p.x, -p.y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, -p.y))));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  // planar UVs in metres
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i); uv[i * 2 + 1] = pos.getZ(i); }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Extruded prism from a footprint (x,z) between y0 and y1. */
export function prism(outer: THREE.Vector2[], y0: number, y1: number, holes: THREE.Vector2[][] = []): THREE.BufferGeometry {
  const shape = new THREE.Shape(outer.map((p) => new THREE.Vector2(p.x, -p.y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, -p.y))));
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

export function signedArea(ring: THREE.Vector2[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Offset a convex polygon outward by r with rounded corners (n segs/corner). */
export function bufferConvex(poly: THREE.Vector2[], r: number, seg = 6): THREE.Vector2[] {
  const ccw = signedArea(poly) > 0;
  const P = ccw ? poly : poly.slice().reverse();
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < P.length; i++) {
    const prev = P[(i - 1 + P.length) % P.length], p = P[i], next = P[(i + 1) % P.length];
    const e0 = p.clone().sub(prev).normalize();
    const e1 = next.clone().sub(p).normalize();
    const n0 = new THREE.Vector2(e0.y, -e0.x);
    const n1 = new THREE.Vector2(e1.y, -e1.x);
    let a0 = Math.atan2(n0.y, n0.x);
    let a1 = Math.atan2(n1.y, n1.x);
    while (a1 < a0) a1 += Math.PI * 2;
    if (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
    for (let s = 0; s <= seg; s++) {
      const a = a0 + ((a1 - a0) * s) / seg;
      out.push(new THREE.Vector2(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r));
    }
  }
  return out;
}

export function convexHull(points: THREE.Vector2[]): THREE.Vector2[] {
  const p = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: THREE.Vector2[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper: THREE.Vector2[] = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pointInPolygon(x: number, z: number, ring: ArrayLike<number>): boolean {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2], zi = ring[i * 2 + 1], xj = ring[j * 2], zj = ring[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Colour a geometry with a constant vertex colour (for merged meshes). */
export function paint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Drop attributes not shared by all parts so mergeGeometries succeeds. */
export function normaliseForMerge(parts: THREE.BufferGeometry[], keep = ['position', 'normal', 'uv', 'color']): THREE.BufferGeometry[] {
  return parts.map((g0) => {
    const g = g0.index ? g0.toNonIndexed() : g0;
    for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name);
    if (keep.includes('uv') && !g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    if (keep.includes('color') && !g.getAttribute('color')) paint(g, 0xffffff);
    if (keep.includes('normal') && !g.getAttribute('normal')) g.computeVertexNormals();
    g.clearGroups();
    return g;
  });
}

export function mergeAll(parts: THREE.BufferGeometry[], keep?: string[]): THREE.BufferGeometry {
  const norm = normaliseForMerge(parts, keep);
  const g = mergeGeometries(norm, false);
  if (!g) throw new Error('mergeGeometries failed');
  return g;
}

/** Rounded box between two corners (bevelled edges, brief §4.3). */
export function rbox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r = 0.02): THREE.BufferGeometry {
  const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0), d = Math.abs(z1 - z0);
  const g = roundedBox(w, h, d, Math.min(r, w / 3, h / 3, d / 3));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

/** Replace a geometry's UVs with metric, face-aligned ones (1 unit = 1 m). */
export function metricUV(g: THREE.BufferGeometry, rotate = false): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const nrm = g.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
    let u: number, v: number;
    if (ny > 0.5) { u = x; v = z; } else if (nx > 0.5) { u = z; v = y; } else { u = x; v = y; }
    if (rotate) [u, v] = [v, u];
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
