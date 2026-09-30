// Uniform-grid spatial index over road segments and building footprints, used
// to keep procedural houses, trees and cars off roads and out of buildings.
import { site, type Road } from '../data/site';
import { footprints } from './layout';

const CELL = 40;

interface Seg {
  ax: number; az: number; bx: number; bz: number; hw: number; cls: string;
}

/** A ring with its edges bucketed by 10 m row bands: a point-in-ring ray
 *  only meets the edges in its own band (the river and land rings run to
 *  thousands of vertices, and far-field placement asks hundreds of
 *  thousands of times). */
interface Poly { ring: number[]; x0: number; x1: number; z0: number; z1: number; rows: Map<number, number[]> }
const ROW = 10;

// numeric cell keys (±32k cells of 40 m): string keys allocated on every
// lookup, and far-field placement makes hundreds of thousands of them
const segGrid = new Map<number, Seg[]>();
const polyGrid = new Map<number, Poly[]>();
const key = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);

function addSeg(s: Seg) {
  const pad = s.hw + 2;
  const i0 = Math.floor((Math.min(s.ax, s.bx) - pad) / CELL), i1 = Math.floor((Math.max(s.ax, s.bx) + pad) / CELL);
  const j0 = Math.floor((Math.min(s.az, s.bz) - pad) / CELL), j1 = Math.floor((Math.max(s.az, s.bz) + pad) / CELL);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const k = key(i, j);
    let arr = segGrid.get(k);
    if (!arr) segGrid.set(k, (arr = []));
    arr.push(s);
  }
}

function addPoly(flat: number[]) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < flat.length; i += 2) { x0 = Math.min(x0, flat[i]); x1 = Math.max(x1, flat[i]); z0 = Math.min(z0, flat[i + 1]); z1 = Math.max(z1, flat[i + 1]); }
  const rows = new Map<number, number[]>();
  const n = flat.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const za = flat[i * 2 + 1], zb = flat[j * 2 + 1];
    for (let r = Math.floor(Math.min(za, zb) / ROW); r <= Math.floor(Math.max(za, zb) / ROW); r++) {
      let list = rows.get(r);
      if (!list) rows.set(r, (list = []));
      list.push(i);
    }
  }
  const poly: Poly = { ring: flat, x0, x1, z0, z1, rows };
  for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
    const k = key(i, j);
    let arr = polyGrid.get(k);
    if (!arr) polyGrid.set(k, (arr = []));
    arr.push(poly);
  }
}

// built on first use, not at import: the film's module evaluation is one
// task, and the placement steps that need the index can pay for it
let built = false;
function build(): void {
  built = true;
  for (const r of site.roads as Road[]) {
    for (let i = 0; i + 3 < r.p.length; i += 2) addSeg({ ax: r.p[i], az: r.p[i + 1], bx: r.p[i + 2], bz: r.p[i + 3], hw: r.w / 2, cls: r.c });
  }
  for (const b of site.buildings) addPoly(b.p);
  for (const f of footprints) addPoly(f.outer.flatMap((v) => [v.x, v.y]));
  for (const w of site.water) for (const ring of w.rings) addPoly(ring);
}

function pointInRing(x: number, z: number, p: Poly): boolean {
  const edges = p.rows.get(Math.floor(z / ROW));
  if (!edges) return false;
  const ring = p.ring, n = ring.length / 2;
  let inside = false;
  for (const i of edges) {
    const j = (i + n - 1) % n;
    const xi = ring[i * 2], zi = ring[i * 2 + 1], xj = ring[j * 2], zj = ring[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Clearance from (x,z) to the nearest road edge (negative = on a road). */
export function roadClearance(x: number, z: number, ignoreService = false): number {
  if (!built) build();
  const arr = segGrid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!arr) return Infinity;
  let best = Infinity;
  for (const s of arr) {
    if (ignoreService && (s.cls === 'service' || s.cls === 'track')) continue;
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const L = dx * dx + dz * dz || 1e-9;
    let t = ((x - s.ax) * dx + (z - s.az) * dz) / L;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - s.ax - t * dx, z - s.az - t * dz) - s.hw;
    if (d < best) best = d;
  }
  return best;
}

export function insideAnyPolygon(x: number, z: number): boolean {
  if (!built) build();
  const arr = polyGrid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!arr) return false;
  for (const p of arr) if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1 && pointInRing(x, z, p)) return true;
  return false;
}

/** Axis-free rectangle test by sampling its corners, edge midpoints and centre. */
export function rectClear(cx: number, cz: number, ux: number, uz: number, halfL: number, halfD: number, roadPad: number): boolean {
  const vx = -uz, vz = ux;
  for (const a of [-1, -0.5, 0, 0.5, 1]) for (const b of [-1, 0, 1]) {
    const x = cx + ux * halfL * a + vx * halfD * b;
    const z = cz + uz * halfL * a + vz * halfD * b;
    if (roadClearance(x, z) < roadPad) return false;
    if (insideAnyPolygon(x, z)) return false;
  }
  return true;
}
