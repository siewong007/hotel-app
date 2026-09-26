// Road network from OSM as ribbons (one merged draw call) plus lane
// markings (a second). Beyond ROAD_MESH_RADIUS the land-cover map carries the
// roads; the haze hides the handover.
import * as THREE from 'three';
import { site, pts, type Pt, type Road } from '../data/site';
import { GROUND } from '../config/materials';
import { mergeAll, ribbon } from './geom';
import { asphalt, wornPaint } from './shaders';

const ROAD_MESH_RADIUS = 2600;
const LIFT: Record<string, number> = { primary: 0.11, primary_link: 0.105, secondary: 0.1, tertiary: 0.095, tertiary_link: 0.09, unclassified: 0.085, residential: 0.08, service: 0.075, track: 0.07 };

function dashes(line: Pt[], dash: number, gap: number, width: number, y: number, offset = 0): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  let carry = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-3) continue;
    const dx = (bx - ax) / L, dz = (bz - az) / L;
    const nx = -dz, nz = dx;
    let s = carry;
    while (s < L) {
      const e = Math.min(L, s + dash);
      if (e - s > 0.3) {
        const p0: Pt = [ax + dx * s + nx * offset, az + dz * s + nz * offset];
        const p1: Pt = [ax + dx * e + nx * offset, az + dz * e + nz * offset];
        const g = ribbon([p0, p1], width, y);
        if (g) out.push(g);
      }
      s += dash + gap;
    }
    carry = s - L;
  }
  return out;
}

function offsetLine(line: Pt[], off: number): Pt[] {
  return line.map((p, i) => {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    return [p[0] - dz * off, p[1] + dx * off];
  });
}

export class Roads {
  readonly group = new THREE.Group();
  readonly surface: THREE.Mesh;
  readonly markings: THREE.Mesh;
  readonly kerbs: THREE.Mesh;

  constructor() {
    const surf: THREE.BufferGeometry[] = [];
    const marks: THREE.BufferGeometry[] = [];
    const kerbs: THREE.BufferGeometry[] = [];
    const near = (r: Road) => {
      for (let i = 0; i < r.p.length; i += 2) if (Math.hypot(r.p[i], r.p[i + 1]) < ROAD_MESH_RADIUS) return true;
      return false;
    };
    for (const r of site.roads) {
      if (!near(r)) continue;
      const line = pts(r.p);
      const y = LIFT[r.c] ?? 0.08;
      const g = ribbon(line, r.w, y);
      if (g) surf.push(g);
      const major = r.c === 'primary' || r.c === 'secondary' || r.c === 'tertiary' || r.c.endsWith('_link');
      if (!r.o && r.w >= 6) marks.push(...dashes(line, 3, 6, 0.14, y + 0.012));
      if (major && r.c !== 'primary_link' && Math.hypot(r.p[0], r.p[1]) < 1600) {
        // raised concrete kerbs on both edges of the main roads
        for (const side of [-1, 1]) {
          const kl = offsetLine(line, side * (r.w / 2 + 0.12));
          const k1 = ribbon(kl, 0.24, y + 0.13);
          if (k1) kerbs.push(k1);
        }
      }
      if (major) {
        const edge = r.w / 2 - 0.35;
        for (const s of [-1, 1]) {
          const g2 = ribbon(offsetLine(line, s * edge), 0.13, y + 0.012);
          if (g2) marks.push(g2);
        }
        if (r.o && r.w >= 7) marks.push(...dashes(line, 3, 6, 0.13, y + 0.012));
      }
    }
    const surfMat = asphalt(new THREE.MeshStandardMaterial({ color: 0x505356, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    this.surface = new THREE.Mesh(mergeAll(surf, ['position', 'normal', 'uv']), surfMat);
    this.surface.receiveShadow = true;
    this.surface.name = 'roads';
    const markMat = wornPaint(new THREE.MeshStandardMaterial({ color: GROUND.lineWhite, roughness: 0.7, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), new THREE.Color(0x46494b));
    this.markings = new THREE.Mesh(mergeAll(marks, ['position', 'normal']), markMat);
    this.markings.receiveShadow = true;
    this.markings.name = 'road-markings';
    this.kerbs = new THREE.Mesh(mergeAll(kerbs, ['position', 'normal']), new THREE.MeshStandardMaterial({ color: GROUND.kerb, roughness: 0.85 }));
    this.kerbs.receiveShadow = true;
    this.kerbs.name = 'road-kerbs';
    this.group.add(this.surface, this.markings, this.kerbs);
  }
}
