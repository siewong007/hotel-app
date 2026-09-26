// Farley ring shophouse rows — mid fidelity (brief §4.3): OSM footprints at
// the shared 3-storey datum; on every street-facing edge, repeated 6.1 m bay
// modules with a recessed five-foot way and square columns, lit shopfronts or
// roller shutters, metal awnings in varied colours, blank signboards that glow
// at dusk (no third-party names or logos), colour-blocked upper floors with
// framed windows (interior-mapped) and split AC units; pitched corrugated
// roofs behind the parapets for the aerial shots (rec2_t110s…t320s, the
// satellite roof pattern). Back edges facing the courtyards get plain walls.
import * as THREE from 'three';
import { footprints, type Footprint } from './layout';
import { DIM, FLOOR_Y } from '../config/dimensions';
import { FACADE } from '../config/materials';
import { boxAt, convexHull, mergeAll, paint, pointInPolygon, prism, rng } from './geom';
import { corrugated, interiorWindows, plaster, signBoards } from './shaders';
import { shutter } from './textures';

export interface FacadeEdge {
  a: THREE.Vector2;
  b: THREE.Vector2;
  out: THREE.Vector2; // outward normal
  len: number;
}

export function facadeEdges(f: Footprint, minLen = 4): FacadeEdge[] {
  const flat: number[] = [];
  for (const p of f.outer) flat.push(p.x, p.y);
  const edges: FacadeEdge[] = [];
  for (let i = 0; i < f.outer.length; i++) {
    const a = f.outer[i], b = f.outer[(i + 1) % f.outer.length];
    const d = b.clone().sub(a);
    const len = d.length();
    if (len < minLen) continue;
    d.divideScalar(len);
    const out = new THREE.Vector2(d.y, -d.x);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    if (pointInPolygon(mid.x + out.x * 0.6, mid.y + out.y * 0.6, flat)) out.negate();
    edges.push({ a, b, out, len });
  }
  return edges;
}

/** Every edge of the outer ring, in order (indices match the ring). */
function ringEdges(f: Footprint): FacadeEdge[] {
  const flat: number[] = f.outer.flatMap((p) => [p.x, p.y]);
  return f.outer.map((a, i) => {
    const b = f.outer[(i + 1) % f.outer.length];
    const d = b.clone().sub(a);
    const len = Math.max(1e-6, d.length());
    d.divideScalar(len);
    const out = new THREE.Vector2(d.y, -d.x);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    if (pointInPolygon(mid.x + out.x * 0.6, mid.y + out.y * 0.6, flat)) out.negate();
    return { a, b, out, len };
  });
}

/** Build geometry in an edge's local frame (u along, v up, w out). */
function inEdge(e: FacadeEdge, g: THREE.BufferGeometry): THREE.BufferGeometry {
  const { m, flip } = edgeMatrix(e);
  if (flip) g.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1).setPosition(e.len, 0, 0)).applyMatrix4(new THREE.Matrix4()); // mirror u
  if (flip) flipWinding(g);
  return g.applyMatrix4(m);
}

function flipWinding(g: THREE.BufferGeometry): void {
  const idx = g.getIndex();
  if (idx) {
    const a = idx.array as Uint16Array | Uint32Array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
    idx.needsUpdate = true;
  } else {
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i += 3) {
      const x = pos.getX(i + 1), y = pos.getY(i + 1), z = pos.getZ(i + 1);
      pos.setXYZ(i + 1, pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
      pos.setXYZ(i + 2, x, y, z);
    }
  }
  g.computeVertexNormals();
}

export function edgeMatrix(e: FacadeEdge): { m: THREE.Matrix4; flip: boolean } {
  const dir = e.b.clone().sub(e.a).normalize();
  // keep the basis right-handed (Z = X × Y) so triangle winding survives
  const flip = -dir.y * e.out.x + dir.x * e.out.y < 0;
  const X = flip ? dir.clone().negate() : dir;
  const origin = flip ? e.b : e.a;
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(X.x, 0, X.y), new THREE.Vector3(0, 1, 0), new THREE.Vector3(e.out.x, 0, e.out.y));
  m.setPosition(origin.x, 0, origin.y);
  return { m, flip };
}

export function edgeBox(e: FacadeEdge, u0: number, u1: number, v0: number, v1: number, w0: number, w1: number): THREE.BufferGeometry {
  const { m, flip } = edgeMatrix(e);
  const g = flip ? boxAt(e.len - u1, v0, w0, e.len - u0, v1, w1) : boxAt(u0, v0, w0, u1, v1, w1);
  g.applyMatrix4(m);
  return g;
}

/** Edge-frame quad (faces +w) with interior-mapping attributes. */
function edgePane(e: FacadeEdge, u0: number, u1: number, v0: number, v1: number, w: number, seed: number): THREE.BufferGeometry {
  const { m, flip } = edgeMatrix(e);
  const a = flip ? e.len - u1 : u0, b = flip ? e.len - u0 : u1;
  const g = new THREE.PlaneGeometry(b - a, v1 - v0).toNonIndexed();
  g.translate((a + b) / 2, (v0 + v1) / 2, w);
  const pos = g.getAttribute('position');
  const aWin = new Float32Array(pos.count * 2), aSeed = new Float32Array(pos.count), aTan = new Float32Array(pos.count * 3);
  const tan = new THREE.Vector3(1, 0, 0).transformDirection(m);
  for (let i = 0; i < pos.count; i++) {
    aWin[i * 2] = (pos.getX(i) - a) / (b - a);
    aWin[i * 2 + 1] = (pos.getY(i) - v0) / (v1 - v0);
    aSeed[i] = seed;
    aTan.set([tan.x, tan.y, tan.z], i * 3);
  }
  g.setAttribute('aWin', new THREE.BufferAttribute(aWin, 2));
  g.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
  g.setAttribute('aTan', new THREE.BufferAttribute(aTan, 3));
  g.applyMatrix4(m);
  return g;
}

/** Inset a polygon: each edge moves inward by d[i] (miter joins). */
function insetPolygon(ring: THREE.Vector2[], d: number[]): THREE.Vector2[] | null {
  const n = ring.length;
  const flat: number[] = ring.flatMap((p) => [p.x, p.y]);
  const lines = ring.map((a, i) => {
    const b = ring[(i + 1) % n];
    const dir = b.clone().sub(a).normalize();
    let inn = new THREE.Vector2(-dir.y, dir.x);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    if (!pointInPolygon(mid.x + inn.x * 0.5, mid.y + inn.y * 0.5, flat)) inn = inn.negate();
    return { p: a.clone().addScaledVector(inn, d[i]), dir };
  });
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const L0 = lines[(i - 1 + n) % n], L1 = lines[i];
    const cross = L0.dir.x * L1.dir.y - L0.dir.y * L1.dir.x;
    if (Math.abs(cross) < 1e-3) { out.push(L1.p.clone()); continue; }
    const t = ((L1.p.x - L0.p.x) * L1.dir.y - (L1.p.y - L0.p.y) * L1.dir.x) / cross;
    const q = L0.p.clone().addScaledVector(L0.dir, t);
    if (q.distanceTo(ring[i]) > 8) return null; // degenerate spike
    out.push(q);
  }
  return out;
}

/** Depth of the row behind an edge: march inward until leaving the polygon. */
function rowDepth(f: Footprint, e: FacadeEdge): number {
  const flat = f.outer.flatMap((p) => [p.x, p.y]);
  const mid = e.a.clone().add(e.b).multiplyScalar(0.5);
  let d = 1;
  while (d < 40 && pointInPolygon(mid.x - e.out.x * d, mid.y - e.out.y * d, flat)) d += 0.5;
  return d;
}

const G = 0.15; // five-foot way floor
const FFW = DIM.fiveFootWay;
const Y1 = FLOOR_Y.level1, Y2 = FLOOR_Y.level2, YR = FLOOR_Y.roof, YP = FLOOR_Y.parapetTop;
const AWNINGS = [0x2f5f8e, 0x8b9196, 0xb23a2e, 0x3f6d4f, 0xe9e7e0, 0x2a4f73, 0x6b6f72, 0xc9a24a];
const SIGNS = [0xd23b2f, 0x1f6fb2, 0xf2c230, 0x2f8f58, 0xf4f1ea, 0x173a6e, 0xe06a1f, 0x6a2c8f, 0x16a3a0];

export class FarleyBlocks {
  readonly group = new THREE.Group();
  readonly meshes: THREE.Mesh[] = [];
  readonly signs: THREE.Mesh;
  readonly acUnits: THREE.InstancedMesh;

  constructor(acGeometry?: THREE.BufferGeometry) {
    const rand = rng(20260926);
    const body: THREE.BufferGeometry[] = [];
    const trim: THREE.BufferGeometry[] = [];
    const windows: THREE.BufferGeometry[] = [];
    const shops: THREE.BufferGeometry[] = [];
    const shutters: THREE.BufferGeometry[] = [];
    const awnings: THREE.BufferGeometry[] = [];
    const signs: THREE.BufferGeometry[] = [];
    const roofs: THREE.BufferGeometry[] = [];
    const floors: THREE.BufferGeometry[] = [];
    const acM: THREE.Matrix4[] = [];
    let seed = 0.11;
    const nextSeed = () => (seed = (seed * 9.73 + 0.317) % 1);

    for (const f of footprints.filter((x) => x.kind === 'row' || x.kind === 'bar')) {
      const hull = convexHull(f.outer).flatMap((p) => [p.x, p.y]);
      const edges = ringEdges(f);
      // front = faces away from the block (outside its convex hull)
      const isFront = edges.map((e) => {
        if (e.len < 5) return false;
        const mid = e.a.clone().add(e.b).multiplyScalar(0.5);
        return f.kind === 'bar' || !pointInPolygon(mid.x + e.out.x * 8, mid.y + e.out.y * 8, hull);
      });
      // edges list may skip none (minLen 0.01) so indices match the ring
      const inset = insetPolygon(f.outer, isFront.map((fr) => (fr ? FFW : 0)));
      const ground = inset ?? f.outer;
      body.push(paint(prism(ground, 0, Y1, f.holes), 0xe9e4d8));
      body.push(paint(prism(f.outer, Y1, YR, f.holes), 0xece6da));
      roofs.push(paint(prism(f.outer, YR - 0.05, YR + 0.02, f.holes), [FACADE.roofMetalLight, 0x9aa3a8, FACADE.roofRust][Math.floor(rand() * 3)]));

      edges.forEach((e, i) => {
        const front = isFront[i] && !!inset;
        const depth = rowDepth(f, e);
        // parapet on every edge
        body.push(paint(edgeBox(e, 0, e.len, YR, YP - 0.25, -0.22, 0.0), 0xe3ddd0));
        trim.push(edgeBox(e, -0.05, e.len + 0.05, YP - 0.25, YP, -0.28, 0.06));
        if (e.len < 5) return;
        const bays = Math.max(1, Math.round(e.len / DIM.bayWidth));
        const bw = e.len / bays;
        // pitched corrugated roof (ridge along the row): rows per front edge,
        // bars once over their longest edge
        const longest = edges.reduce((m, x) => (x.len > m.len ? x : m), edges[0]);
        if ((front && f.kind === 'row') || (f.kind === 'bar' && e === longest)) {
          const rd = Math.min(depth, 22);
          const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(rd, 0), new THREE.Vector2(rd / 2, 1.9)]);
          const rg = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.5, e.len - 0.6), bevelEnabled: false });
          // shape x → inward (−w), y up, extrusion → along u
          rg.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)));
          rg.translate(0.3, YR - 0.02, -0.25);
          const rc = [FACADE.roofMetalLight, 0xb3b9bb, FACADE.roofMetalBlue, FACADE.roofRust, 0xc4c6c2][Math.floor(rand() * 5)];
          roofs.push(paint(inEdge(e, rg), rc));
        }
        const tone = FACADE.rowPalette[Math.floor(rand() * FACADE.rowPalette.length)];
        for (let k = 0; k < bays; k++) {
          const u0 = k * bw, u1 = u0 + bw;
          const colour = rand() < 0.45 ? tone : FACADE.rowPalette[Math.floor(rand() * FACADE.rowPalette.length)];
          // colour-blocked upper facade
          body.push(paint(edgeBox(e, u0 + 0.18, u1 - 0.18, Y1 + 0.02, YR, 0.0, 0.03), colour));
          trim.push(edgeBox(e, u0 - 0.18, u0 + 0.18, Y1, YP - 0.25, -0.02, 0.1)); // pilaster
          for (const yf of [Y1, Y2]) {
            const s0 = yf + 0.95, s1 = yf + 2.3;
            const nw = bw > 5 ? 2 : 1;
            const ww = (bw - 0.9 - (nw - 1) * 0.5) / nw;
            for (let j = 0; j < nw; j++) {
              const a = u0 + 0.45 + j * (ww + 0.5), b = a + ww;
              windows.push(edgePane(e, a, b, s0, s1, 0.02, nextSeed()));
              trim.push(edgeBox(e, a - 0.06, b + 0.06, s0 - 0.08, s0, 0.02, 0.1), edgeBox(e, a - 0.06, b + 0.06, s1, s1 + 0.06, 0.02, 0.08));
              trim.push(edgeBox(e, a - 0.05, a, s0, s1, 0.02, 0.07), edgeBox(e, b, b + 0.05, s0, s1, 0.02, 0.07), edgeBox(e, (a + b) / 2 - 0.025, (a + b) / 2 + 0.025, s0, s1, 0.02, 0.06));
            }
            if (front && rand() < 0.8) {
              const { m, flip } = edgeMatrix(e);
              const u = u0 + bw * (0.3 + rand() * 0.4);
              const lu = flip ? e.len - u : u;
              acM.push(new THREE.Matrix4().makeTranslation(lu, yf + (rand() < 0.5 ? 0.4 : 1.3), 0.22).premultiply(m));
            }
          }
          if (!front) {
            // back of house: plain ground-floor wall with a service door
            if (rand() < 0.5) trim.push(edgeBox(e, u0 + 1, u0 + 2, 0, 2.2, 0.0, 0.05));
            continue;
          }
          // five-foot way: floor, column at the bay line, shopfront or shutter
          floors.push(edgeBox(e, u0, u1, 0, G, -FFW, 0.25));
          trim.push(edgeBox(e, u0 - 0.2, u0 + 0.2, G, Y1 - 0.25, -0.5, -0.1));
          const closed = rand() < 0.22;
          if (closed) shutters.push(edgeBox(e, u0 + 0.35, u1 - 0.2, G, 3.2, -FFW - 0.02, -FFW + 0.02));
          else shops.push(edgePane(e, u0 + 0.35, u1 - 0.2, G + 0.05, 3.15, -FFW + 0.03, nextSeed()));
          // awning + signboard over the five-foot way edge
          const aw = AWNINGS[Math.floor(rand() * AWNINGS.length)];
          const sloped = rand() < 0.55;
          if (sloped) {
            const g = boxAt(u0, -0.04, 0, u1, 0.04, 1.8).rotateX(0.2).translate(0, 3.62, 0);
            awnings.push(paint(inEdge(e, g), aw));
          } else awnings.push(paint(edgeBox(e, u0, u1, 3.45, 3.6, 0, 1.4), aw));
          if (rand() < 0.82) signs.push(paint(edgeBox(e, u0 + 0.15, u1 - 0.15, 3.65, 4.55, 0.0, 0.12), SIGNS[Math.floor(rand() * SIGNS.length)]));
        }
      });
    }

    const add = (geos: THREE.BufferGeometry[], mat: THREE.Material, name: string, keep: string[], cast = true) => {
      if (!geos.length) return new THREE.Mesh();
      const m = new THREE.Mesh(mergeAll(geos, keep), mat);
      m.name = name;
      m.castShadow = cast;
      m.receiveShadow = true;
      this.group.add(m);
      this.meshes.push(m);
      return m;
    };
    add(body, plaster(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 }), 1.4), 'rows-body', ['position', 'normal', 'color']);
    add(trim, new THREE.MeshStandardMaterial({ color: 0xeeece6, roughness: 0.55 }), 'rows-trim', ['position', 'normal']);
    add(floors, new THREE.MeshStandardMaterial({ color: 0x7a746c, roughness: 0.75 }), 'rows-walkway', ['position', 'normal'], false);
    add(windows, interiorWindows(new THREE.MeshPhysicalMaterial({ color: 0x25333a, roughness: 0.07, reflectivity: 0.5, envMapIntensity: 1.3 }), { depth: 3.2, size: [2.4, 1.35], litShare: 0.5 }), 'rows-windows', ['position', 'normal', 'aWin', 'aSeed', 'aTan'], false);
    add(shops, interiorWindows(new THREE.MeshPhysicalMaterial({ color: 0x2c3431, roughness: 0.06, reflectivity: 0.45, envMapIntensity: 1.2 }), { depth: 9, size: [5.6, 3.0], litShare: 0.9, warm: 0xfff0d8 }), 'rows-shopfronts', ['position', 'normal', 'aWin', 'aSeed', 'aTan'], false);
    const sh = shutter().clone();
    sh.repeat.set(1, 3);
    sh.needsUpdate = true;
    add(shutters, new THREE.MeshStandardMaterial({ map: sh, roughness: 0.5, metalness: 0.5 }), 'rows-shutters', ['position', 'normal', 'uv'], false);
    add(awnings, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.3 }), 'rows-awnings', ['position', 'normal', 'color']);
    this.signs = add(signs, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0 }), 'rows-signs', ['position', 'normal', 'color'], false);
    // Generic lightbox signboards: an off-white face with a band of blocky,
    // unreadable "lettering" in the board's colour (no real names or logos —
    // brief §4.3), backlit at dusk so the face glows warm white.
    signBoards(this.signs.material as THREE.MeshStandardMaterial);
    add(roofs, corrugated(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.38 })), 'rows-roofs', ['position', 'normal', 'color']);

    const acGeo = acGeometry ?? new THREE.BoxGeometry(0.8, 0.56, 0.28);
    this.acUnits = new THREE.InstancedMesh(acGeo, new THREE.MeshStandardMaterial({ vertexColors: !!acGeometry, color: 0xffffff, roughness: 0.55 }), Math.max(1, acM.length));
    acM.forEach((m, i) => this.acUnits.setMatrixAt(i, m));
    this.acUnits.count = acM.length;
    this.acUnits.castShadow = true;
    this.acUnits.name = 'rows-ac';
    this.group.add(this.acUnits);
  }

  setDusk(lights: number): void {
    (this.signs.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.3 * lights;
  }
}
