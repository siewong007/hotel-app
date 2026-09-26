// A tiny stroke font for 3D signage letters. Each glyph is a set of stroke
// centre-lines (unit em: x 0..advance, y 0 = baseline, cap/x-height ≈ 1);
// strokes are thickened into outlines and extruded with a bevel. The shapes
// are deliberately plain geometric lettering — they reproduce no logo or
// brand artwork (brief §11: "cafe.cafe" is generic lettering).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type P = [number, number];
interface Glyph { adv: number; strokes: P[][]; dots?: P[] }

const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 18): P[] => {
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
};
const D = Math.PI / 180;

// lowercase geometric (x-height 1)
const LOWER: Record<string, Glyph> = {
  c: { adv: 1.0, strokes: [arc(0.5, 0.5, 0.44, 0.47, 45 * D, 315 * D, 26)] },
  a: { adv: 1.06, strokes: [arc(0.48, 0.5, 0.42, 0.47, 0, 360 * D, 32), [[0.92, 1.0], [0.92, 0.0]]] },
  e: { adv: 1.0, strokes: [[[0.08, 0.5], [0.93, 0.5], ...arc(0.5, 0.5, 0.44, 0.47, 0, 320 * D, 28).slice(1)]] },
  f: { adv: 0.62, strokes: [[[0.26, 0.0], [0.26, 1.18], ...arc(0.56, 1.18, 0.3, 0.3, 180 * D, 40 * D, 10).slice(1)], [[0.02, 0.96], [0.56, 0.96]]] },
  '.': { adv: 0.42, strokes: [], dots: [[0.2, 0.09]] },
};

// uppercase bold (cap height 1)
const UPPER: Record<string, Glyph> = {
  S: {
    adv: 0.82,
    strokes: [[...arc(0.41, 0.745, 0.33, 0.235, 20 * D, 270 * D, 16), ...arc(0.41, 0.255, 0.33, 0.235, 90 * D, -160 * D, 16).slice(1)]],
  },
  A: { adv: 0.92, strokes: [[[0.04, 0], [0.46, 1], [0.88, 0]], [[0.22, 0.33], [0.7, 0.33]]] },
  L: { adv: 0.7, strokes: [[[0.1, 1], [0.1, 0], [0.66, 0]]] },
  I: { adv: 0.34, strokes: [[[0.17, 0], [0.17, 1]]] },
  M: { adv: 1.06, strokes: [[[0.08, 0], [0.08, 1], [0.53, 0.28], [0.98, 1], [0.98, 0]]] },
  N: { adv: 0.9, strokes: [[[0.09, 0], [0.09, 1], [0.81, 0], [0.81, 1]]] },
  ' ': { adv: 0.4, strokes: [] },
};

/** Thicken a polyline into a closed outline (butt caps, mitred joins). */
function strokeOutline(pts: P[], w: number): THREE.Vector2[] {
  const n = pts.length;
  const left: THREE.Vector2[] = [];
  const right: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const p = new THREE.Vector2(...pts[i]);
    const a = new THREE.Vector2(...pts[Math.max(0, i - 1)]);
    const b = new THREE.Vector2(...pts[Math.min(n - 1, i + 1)]);
    const d0 = p.clone().sub(a).normalize();
    const d1 = b.clone().sub(p).normalize();
    if (i === 0) d0.copy(d1);
    if (i === n - 1) d1.copy(d0);
    const t = d0.clone().add(d1).normalize();
    const nrm = new THREE.Vector2(-t.y, t.x);
    const cos = Math.max(0.35, nrm.dot(new THREE.Vector2(-d1.y, d1.x)));
    const h = w / 2 / cos;
    left.push(p.clone().addScaledVector(nrm, h));
    right.push(p.clone().addScaledVector(nrm, -h));
  }
  return left.concat(right.reverse());
}

export interface TextOpts {
  size: number; // cap or x-height in metres
  weight: number; // stroke width as a fraction of size
  depth: number; // extrusion (m)
  bevel?: number;
  tracking?: number; // extra advance (em)
  italic?: number; // shear (x per y)
  case: 'lower' | 'upper';
}

/** Build merged 3D text, baseline at y = 0, starting at x = 0, face +Z.
 *  Returns the geometry and its width. */
export function buildText(text: string, o: TextOpts): { geo: THREE.BufferGeometry; width: number } {
  const set = o.case === 'lower' ? LOWER : UPPER;
  const parts: THREE.BufferGeometry[] = [];
  let x = 0;
  const w = o.weight;
  const bev = o.bevel ?? Math.min(0.02, o.depth * 0.25);
  for (const ch of text) {
    const g = set[ch] ?? set[ch.toUpperCase()] ?? set[' '] ?? { adv: 0.5, strokes: [] };
    const shapes: THREE.Shape[] = [];
    for (const s of g.strokes) {
      const outline = strokeOutline(s, w).map((v) => new THREE.Vector2(x + v.x + (o.italic ?? 0) * v.y, v.y));
      shapes.push(new THREE.Shape(outline));
    }
    for (const d of g.dots ?? []) {
      const sh = new THREE.Shape();
      sh.absarc(x + d[0], d[1], w * 0.62, 0, Math.PI * 2, false);
      shapes.push(sh);
    }
    for (const sh of shapes) {
      const geo = new THREE.ExtrudeGeometry(sh, { depth: o.depth / o.size, bevelEnabled: true, bevelThickness: bev / o.size, bevelSize: bev / o.size, bevelSegments: 2, curveSegments: 6 });
      parts.push(geo);
    }
    x += g.adv + (o.tracking ?? 0.08);
  }
  const width = (x - (o.tracking ?? 0.08)) * o.size;
  if (!parts.length) return { geo: new THREE.BufferGeometry(), width: 0 };
  const merged = mergeGeometries(parts.map((p) => { p.deleteAttribute('uv'); return p; }), false)!;
  parts.forEach((p) => p.dispose());
  merged.scale(o.size, o.size, o.size);
  merged.computeVertexNormals();
  return { geo: merged, width };
}
