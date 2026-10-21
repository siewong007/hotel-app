// A hipped roof over any simple footprint, from its straight skeleton: every
// edge of the outline moves inward at the same speed, and a point's height is
// the time the moving outline takes to reach it, times the pitch. Ridges,
// hips and valleys fall where the moving edges meet, so a bent shophouse row
// gets one continuous roof (ridge along the row, hipped ends, a valley on the
// inside of each bend) instead of a prism per facade that cross each other.
//
// The outline is traced event by event (Aichholzer et al.; Felkel and
// Obdržálek): an edge event when an edge shrinks to nothing, a split event
// when a reflex corner runs into an edge across the outline and cuts it in
// two. Between events every edge sweeps one flat quad of the roof. A
// footprint is a few dozen corners at most, so each event is found by brute
// force. Past `maxRun` (and if the outline ever degenerates) what is left is
// capped flat, so the result is always one closed solid.
import * as THREE from 'three';

/** An edge's line as it moves: n·p = c + t (n the inward unit normal). */
interface Line { nx: number; ny: number; c: number }
/** A corner of the moving outline: its position at the front's time, and its velocity. */
interface Corner { x: number; y: number; vx: number; vy: number }
/** One closed outline at time t; corners[k] starts lines[k]. */
interface Front { t: number; lines: Line[]; corners: Corner[] }

const EPS = 1e-7;
/** A corner faster than this sits between two nearly opposite edges: the
 *  outline there has no width left (capped). */
const MAX_SPEED = 1e4;

function velocity(a: Line, b: Line): [number, number] | null {
  const det = a.nx * b.ny - a.ny * b.nx;
  if (Math.abs(det) < 1e-9) {
    // collinear, same way: the corner moves with both
    return a.nx * b.nx + a.ny * b.ny > 0 ? [a.nx, a.ny] : null;
  }
  const vx = (b.ny - a.ny) / det, vy = (a.nx - b.nx) / det;
  return Math.hypot(vx, vy) > MAX_SPEED ? null : [vx, vy];
}

function corner(x: number, y: number, a: Line, b: Line): Corner | null {
  const v = velocity(a, b);
  return v ? { x, y, vx: v[0], vy: v[1] } : null;
}

/** The ring counter-clockwise (interior on the left), without repeated or
 *  collinear corners. */
function clean(ring: THREE.Vector2[]): THREE.Vector2[] {
  let r = ring.filter((p, i) => p.distanceTo(ring[(i + 1) % ring.length]) > 1e-3);
  let area = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; area += p.x * q.y - q.x * p.y; }
  if (area < 0) r = r.slice().reverse();
  for (let changed = true; changed && r.length > 3;) {
    changed = false;
    for (let i = 0; i < r.length; i++) {
      const a = r[(i - 1 + r.length) % r.length], p = r[i], b = r[(i + 1) % r.length];
      const d0 = p.clone().sub(a).normalize(), d1 = b.clone().sub(p).normalize();
      if (Math.abs(d0.x * d1.y - d0.y * d1.x) < 2e-3 && d0.dot(d1) > 0) {
        r.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return r;
}

interface Event { t: number; kind: 'edge' | 'split'; k: number; j: number; x: number; y: number }

/** The earliest event of one front, or null if it has none. */
function nextEvent(f: Front): Event | null {
  const n = f.lines.length;
  let best: Event | null = null;
  const offer = (e: Event) => { if (!best || e.t < best.t) best = e; };
  for (let k = 0; k < n; k++) {
    // edge event: lines[k] runs from corners[k] to corners[k + 1]
    const a = f.corners[k], b = f.corners[(k + 1) % n], l = f.lines[k];
    const dx = l.ny, dy = -l.nx; // along the edge
    const len = (b.x - a.x) * dx + (b.y - a.y) * dy;
    const rate = (b.vx - a.vx) * dx + (b.vy - a.vy) * dy;
    if (rate < -EPS) {
      const tau = Math.max(0, len / -rate);
      offer({ t: f.t + tau, kind: 'edge', k, j: -1, x: a.x + a.vx * tau, y: a.y + a.vy * tau });
    }
  }
  for (let k = 0; k < n; k++) {
    // split event: a reflex corner (the outline turns right there) meeting
    // an edge that is not one of its own
    const p = f.corners[k], lin = f.lines[(k - 1 + n) % n], lout = f.lines[k];
    if (lin.nx * lout.ny - lin.ny * lout.nx >= -EPS) continue; // convex
    for (let j = 0; j < n; j++) {
      if (j === k || j === (k - 1 + n) % n) continue;
      const l = f.lines[j];
      const gap = l.nx * p.x + l.ny * p.y - l.c - f.t;
      const closing = 1 - (l.nx * p.vx + l.ny * p.vy);
      if (gap < -1e-6 || closing <= EPS) continue;
      const tau = Math.max(0, gap / closing);
      const hx = p.x + p.vx * tau, hy = p.y + p.vy * tau;
      const a = f.corners[j], b = f.corners[(j + 1) % n];
      const ax = a.x + a.vx * tau, ay = a.y + a.vy * tau, bx = b.x + b.vx * tau, by = b.y + b.vy * tau;
      const dx = l.ny, dy = -l.nx;
      const s = (hx - ax) * dx + (hy - ay) * dy, len = (bx - ax) * dx + (by - ay) * dy;
      if (s < -1e-6 || s > len + 1e-6) continue;
      offer({ t: f.t + tau, kind: 'split', k, j, x: hx, y: hy });
    }
  }
  return best;
}

/**
 * The roof over `ring` (x, z in world metres), its eaves at y0: `slope` is
 * the rise per metre of run, and the roof goes flat `maxRun` metres in from
 * the eaves. Non-indexed, top faces up, closed by a flat underside so it
 * casts a shadow like any solid.
 */
export function hipRoof(ring: THREE.Vector2[], y0: number, slope: number, maxRun = Infinity): THREE.BufferGeometry {
  const pts = clean(ring);
  const out: number[] = [];
  const tri = (ax: number, ay: number, ah: number, bx: number, by: number, bh: number, cx: number, cy: number, ch: number, up: boolean) => {
    // (x, y) of the plan → world (x, z)
    const ny = (by - ay) * (cx - ax) - (bx - ax) * (cy - ay);
    if (Math.abs(ny) < 1e-10) return;
    const flip = ny > 0 !== up;
    const B = flip ? [cx, ch, cy] : [bx, bh, by], C = flip ? [bx, bh, by] : [cx, ch, cy];
    out.push(ax, ah, ay, B[0], B[1], B[2], C[0], C[1], C[2]);
  };
  const flat = (poly: { x: number; y: number }[], h: number, up: boolean) => {
    const v = poly.map((p) => new THREE.Vector2(p.x, p.y));
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(v, [])) tri(v[a].x, v[a].y, h, v[b].x, v[b].y, h, v[c].x, v[c].y, h, up);
  };
  if (pts.length < 3) return new THREE.BufferGeometry();
  flat(pts, y0, false); // the underside

  const lines: Line[] = pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const d = b.clone().sub(a).normalize();
    const nx = -d.y, ny = d.x;
    return { nx, ny, c: nx * a.x + ny * a.y };
  });
  const first: Corner[] = [];
  for (let i = 0; i < pts.length; i++) {
    const c = corner(pts[i].x, pts[i].y, lines[(i - 1 + pts.length) % pts.length], lines[i]);
    if (!c) { flat(pts, y0, true); return finish(out); }
    first.push(c);
  }

  const fronts: Front[] = [{ t: 0, lines, corners: first }];
  let guard = 8 * pts.length + 16;
  while (fronts.length && guard-- > 0) {
    const f = fronts.pop()!;
    const n = f.lines.length;
    if (n < 3) continue;
    const ev = nextEvent(f);
    const te = Math.min(ev ? ev.t : Infinity, maxRun);
    const capped = !ev || ev.t >= maxRun;
    if (!Number.isFinite(te)) { flat(f.corners, y0 + f.t * slope, true); continue; }
    // every edge sweeps a flat quad of its own plane up to the event
    const tau = te - f.t, h0 = y0 + f.t * slope, h1 = y0 + te * slope;
    for (let k = 0; k < n; k++) {
      const a = f.corners[k], b = f.corners[(k + 1) % n];
      const a1x = a.x + a.vx * tau, a1y = a.y + a.vy * tau, b1x = b.x + b.vx * tau, b1y = b.y + b.vy * tau;
      tri(a.x, a.y, h0, b.x, b.y, h0, b1x, b1y, h1, true);
      tri(a.x, a.y, h0, b1x, b1y, h1, a1x, a1y, h1, true);
    }
    for (const c of f.corners) { c.x += c.vx * tau; c.y += c.vy * tau; }
    f.t = te;
    if (capped) { flat(f.corners, h1, true); continue; }
    const e = ev!;
    if (e.kind === 'edge') {
      // lines[k] is gone, and with it its first corner; the corner starting
      // the next line is where the two met, between its neighbours' lines
      if (n <= 3) continue;
      const { k } = e, next = (k + 1) % n;
      const c = corner(f.corners[next].x, f.corners[next].y, f.lines[(k - 1 + n) % n], f.lines[next]);
      if (!c) { flat(f.corners, h1, true); continue; }
      const g: Front = { t: te, lines: [], corners: [] };
      for (let i = 0; i < n; i++) if (i !== k) { g.lines.push(f.lines[i]); g.corners.push(i === next ? c : f.corners[i]); }
      fronts.push(g);
    } else {
      // corner k cuts lines[j] in two: two outlines, one each side
      const { k, j } = e;
      const A: Front = { t: te, lines: [], corners: [] }, B: Front = { t: te, lines: [], corners: [] };
      for (let i = k; ; i = (i + 1) % n) { A.lines.push(f.lines[i]); if (i !== k) A.corners.push(f.corners[i]); if (i === j) break; }
      for (let i = j; ; i = (i + 1) % n) { B.lines.push(f.lines[i]); if (i !== j) B.corners.push(f.corners[i]); if (i === (k - 1 + n) % n) break; }
      const ca = corner(e.x, e.y, f.lines[j], f.lines[k]);
      const cb = corner(e.x, e.y, f.lines[(k - 1 + n) % n], f.lines[j]);
      if (!ca || !cb) { flat(f.corners, h1, true); continue; }
      A.corners.unshift(ca);
      B.corners.unshift(cb);
      fronts.push(A, B);
    }
  }
  for (const f of fronts) if (f.lines.length >= 3) flat(f.corners, y0 + f.t * slope, true); // (guard ran out)
  return finish(out);
}

function finish(out: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  g.computeVertexNormals();
  return g;
}
