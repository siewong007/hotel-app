// The shop rows' hipped roofs (world/hipRoof.ts). A roof is right when it
// covers its footprint exactly once, faces up everywhere, and stands at the
// height its straight skeleton gives: never above the pitch times the
// distance to the nearest wall, never below the pitch times the distance to
// the nearest wall's line. The second half runs that on the real footprints,
// whose bent rows the old per-facade prisms crossed over.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { hipRoof } from './world/hipRoof';
import { footprints } from './world/layout';
import { signedArea } from './world/geom';

const SLOPE = 0.2;
const v = (x: number, y: number) => new THREE.Vector2(x, y);

interface Tri { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; up: boolean; area: number }

function triangles(g: THREE.BufferGeometry): Tri[] {
  const p = g.getAttribute('position');
  const out: Tri[] = [];
  for (let i = 0; i < p.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(p, i), b = new THREE.Vector3().fromBufferAttribute(p, i + 1), c = new THREE.Vector3().fromBufferAttribute(p, i + 2);
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    out.push({ a, b, c, up: n.y > 0, area: Math.abs(n.y) / 2 });
  }
  return out;
}

/** The roof's height over (x, z), from the top face that covers it. */
function heightAt(top: Tri[], x: number, z: number): number | null {
  for (const { a, b, c } of top) {
    const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d;
    const l2 = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return l1 * a.y + l2 * b.y + l3 * c.y;
  }
  return null;
}

function inside(ring: THREE.Vector2[], x: number, z: number): boolean {
  let r = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a.y > z !== b.y > z && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
}

function segDist(px: number, pz: number, a: THREE.Vector2, b: THREE.Vector2): number {
  const dx = b.x - a.x, dz = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.y) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (a.x + dx * t), pz - (a.y + dz * t));
}

/** Pitch × distance to the nearest wall: no roof point stands higher. */
const ceiling = (ring: THREE.Vector2[], x: number, z: number) => SLOPE * Math.min(...ring.map((a, i) => segDist(x, z, a, ring[(i + 1) % ring.length])));
/** Pitch × distance to the nearest wall's line (on the inside): none lower. */
function floor(ring: THREE.Vector2[], x: number, z: number): number {
  const ccw = signedArea(ring) > 0 ? 1 : -1;
  let m = Infinity;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const d = b.clone().sub(a).normalize();
    const s = ccw * (d.x * (z - a.y) - d.y * (x - a.x)); // positive on the inside
    if (s >= 0) m = Math.min(m, s);
  });
  return SLOPE * m;
}

function check(ring: THREE.Vector2[], maxRun = Infinity) {
  const tris = triangles(hipRoof(ring, 0, SLOPE, maxRun));
  const top = tris.filter((t) => t.up), under = tris.filter((t) => !t.up);
  const area = Math.abs(signedArea(ring));
  const topArea = top.reduce((s, t) => s + t.area, 0);
  const flatArea = top.filter((t) => Math.abs(t.a.y - t.b.y) + Math.abs(t.a.y - t.c.y) < 1e-6 && t.a.y > 1e-6).reduce((s, t) => s + t.area, 0);
  // the heights, on a grid over the footprint
  const box = new THREE.Box2().setFromPoints(ring);
  const step = Math.max(box.max.x - box.min.x, box.max.y - box.min.y) / 60;
  let worst = 0, missing = 0, samples = 0;
  for (let x = box.min.x + step / 2; x < box.max.x; x += step) {
    for (let z = box.min.y + step / 2; z < box.max.y; z += step) {
      if (!inside(ring, x, z)) continue;
      samples++;
      const h = heightAt(top, x, z);
      if (h === null) { missing++; continue; }
      const hi = Math.min(ceiling(ring, x, z), SLOPE * maxRun), lo = Math.min(floor(ring, x, z), SLOPE * maxRun);
      worst = Math.max(worst, h - hi, lo - h);
    }
  }
  return { area, topArea, underArea: under.reduce((s, t) => s + t.area, 0), flatArea, worst, missing, samples, maxH: Math.max(...top.flatMap((t) => [t.a.y, t.b.y, t.c.y])) };
}

describe('hip roofs', () => {
  it('ridges a rectangle along its length at half its width', () => {
    const r = check([v(0, 0), v(40, 0), v(40, 20), v(0, 20)]);
    expect(r.topArea).toBeCloseTo(800, 3);
    expect(r.underArea).toBeCloseTo(800, 3);
    expect(r.maxH).toBeCloseTo(SLOPE * 10, 6);
    expect(r.worst).toBeLessThan(1e-6);
    expect(r.missing).toBe(0);
  });

  it('turns an L-shaped row with a valley inside the bend', () => {
    const ring = [v(0, 0), v(60, 0), v(60, 18), v(18, 18), v(18, 50), v(0, 50)];
    const r = check(ring);
    expect(r.topArea).toBeCloseTo(r.area, 3);
    expect(r.maxH).toBeLessThanOrEqual(SLOPE * 9 * Math.SQRT2 + 1e-6); // the corner square's centre is the farthest point from the walls
    expect(r.worst).toBeLessThan(1e-6);
    expect(r.flatArea).toBe(0);
    expect(r.missing).toBe(0);
  });

  it('either winding gives the same roof', () => {
    const ring = [v(0, 0), v(60, 0), v(60, 18), v(18, 18), v(18, 50), v(0, 50)];
    expect(check(ring.slice().reverse()).topArea).toBeCloseTo(check(ring).topArea, 6);
  });

  it('goes flat at maxRun', () => {
    const r = check([v(0, 0), v(40, 0), v(40, 30), v(0, 30)], 6);
    expect(r.maxH).toBeCloseTo(SLOPE * 6, 6);
    expect(r.flatArea).toBeCloseTo((40 - 12) * (30 - 12), 3);
    expect(r.worst).toBeLessThan(1e-6);
  });

  const rows = footprints.filter((f) => f.kind === 'row' && Math.abs(signedArea(f.outer)) > 50);
  it('has the shop rows to roof', () => expect(rows.length).toBeGreaterThanOrEqual(3));
  for (const f of rows) {
    it(`roofs ${f.id} once, all the way, at its skeleton's heights`, () => {
      const r = check(f.outer);
      expect(r.topArea / r.area).toBeCloseTo(1, 4);
      expect(r.underArea / r.area).toBeCloseTo(1, 4);
      expect(r.missing).toBe(0);
      expect(r.worst).toBeLessThan(1e-4);
      expect(r.flatArea).toBeLessThan(r.area * 1e-3); // no outline gave up and capped
    });
  }
});
