// Vegetation (brief §4.3 "instanced rain trees and palms"):
//  · rain trees (Samanea saman) — wide umbrella crowns built from clustered
//    lumps over a forked trunk; three variants, drawn as one BatchedMesh near
//    the ring, single-lump instanced crowns further out;
//  · palms — slim trunks with arching fronds, around the supermarket and the
//    ring's landscaping, and along the boulevard;
//  · all kept off roads, buildings and water, and out of the sunset corridor
//    in front of the Salim Inn facade (art direction: the hero frontage keeps
//    its warm raking light).
import * as THREE from 'three';
import { site, pts } from '../data/site';
import { roadClearance, insideAnyPolygon } from './spatial';
import { POINTS, footprints } from './layout';
import { mergeGeometries, mergeVertices, pointInPolygon, rng } from './geom';
import { foliage } from './shaders';

interface Tree { x: number; z: number; s: number; kind: 'rain' | 'palm' | 'small' }

const NEAR_R = 520;
const FAR_R = 2400;

function vcol(g: THREE.BufferGeometry, top: THREE.Color, bottom: THREE.Color, y0: number, y1: number): THREE.BufferGeometry {
  const p = g.getAttribute('position');
  const a = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const t = THREE.MathUtils.clamp((p.getY(i) - y0) / (y1 - y0), 0, 1);
    c.copy(bottom).lerp(top, t);
    a.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

function onlyPNC(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'color'].includes(k)) n.deleteAttribute(k);
  return n;
}

/**
 * Rain tree (Samanea saman): short forked trunk under a broad umbrella crown
 * of many small clumps laid out on a golden-angle spiral over a flattened
 * dome. Each clump's normals are blended with the crown's dome normal, so the
 * crown shades as one soft volume (not a bunch of separate balls), and the
 * vertex colours carry height, per-clump variation and cavity darkening.
 * lod 0: 30 clumps × 80 faces · lod 1: the same clumps × 20 faces · lod 2: 10 clumps.
 */
function rainTree(seed: number, lod: 0 | 1 | 2): THREE.BufferGeometry {
  const r = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const bark = new THREE.Color(0x3f3326), barkTop = new THREE.Color(0x5a4a3a);
  const seg = lod === 2 ? 5 : 8;
  const trunkH = 2.6 + r() * 0.8;
  parts.push(vcol(new THREE.CylinderGeometry(0.3, 0.46, trunkH, seg).translate(0, trunkH / 2, 0), barkTop, bark, 0, trunkH));
  const nBr = lod === 2 ? 3 : 5;
  for (let k = 0; k < nBr; k++) {
    const a = (k / nBr) * Math.PI * 2 + r() * 0.8;
    const len = 3.6 + r() * 1.6;
    const br = new THREE.CylinderGeometry(0.1, 0.24, len, seg - 2).translate(0, len / 2, 0);
    br.rotateZ(0.8 + r() * 0.35).rotateY(a).translate(0, trunkH - 0.3, 0);
    parts.push(vcol(br, barkTop, bark, trunkH, trunkH + 3));
  }
  // crown
  const Rc = 5.2 + r() * 0.9; // rim radius
  const yRim = 5.4 + r() * 0.5; // crown underside at the rim
  const H = 2.2 + r() * 0.7; // dome rise above the rim
  const domeC = new THREE.Vector3(0, yRim - 1.3, 0);
  const domeR = new THREE.Vector3(Rc + 1.6, H + 2.6, Rc + 1.6);
  const top = new THREE.Color(0x86a14f), mid = new THREE.Color(0x4f7133), low = new THREE.Color(0x213219);
  const N = lod === 2 ? 10 : 30;
  const detail = lod === 0 ? 1 : 0;
  const nd = new THREE.Vector3(), nl = new THREE.Vector3(), pv = new THREE.Vector3();
  const c = new THREE.Color();
  for (let k = 0; k < N; k++) {
    const t = (k + 0.5) / N;
    const rr = Rc * Math.sqrt(t) * (0.92 + r() * 0.16);
    const a = k * 2.39996 + r() * 0.4;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const edge = rr / Rc;
    const y = yRim + H * Math.pow(Math.max(0, 1 - edge * edge), 0.75) + (r() - 0.5) * 0.45;
    const sBase = lod === 2 ? 2.5 : 1.45;
    const sc = (sBase + r() * 0.75) * (1.12 - 0.34 * edge);
    const lump = mergeVertices(new THREE.IcosahedronGeometry(1, detail));
    // irregular clumps: jitter each vertex along its radius
    const lp = lump.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < lp.count; i++) {
      pv.fromBufferAttribute(lp, i);
      const j = 1 + (Math.sin(pv.x * 12.9 + seed + k * 7.3) * Math.cos(pv.z * 9.7 - k) * 0.5) * 0.28;
      lp.setXYZ(i, pv.x * j, pv.y * j, pv.z * j);
    }
    lump.computeVertexNormals();
    lump.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28), new THREE.Vector3(sc * 1.15, sc * 0.7, sc * 1.15)));
    const pos = lump.getAttribute('position') as THREE.BufferAttribute;
    const nor = lump.getAttribute('normal') as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const hue = (r() - 0.5) * 0.05, lit = 0.86 + r() * 0.26;
    for (let i = 0; i < pos.count; i++) {
      pv.fromBufferAttribute(pos, i);
      nl.fromBufferAttribute(nor, i);
      nd.set((pv.x - domeC.x) / (domeR.x * domeR.x), (pv.y - domeC.y) / (domeR.y * domeR.y), (pv.z - domeC.z) / (domeR.z * domeR.z)).normalize();
      const cav = THREE.MathUtils.smoothstep(nl.dot(nd), -0.35, 0.85);
      nl.multiplyScalar(0.42).addScaledVector(nd, 0.58).normalize();
      nor.setXYZ(i, nl.x, nl.y, nl.z);
      const h = THREE.MathUtils.clamp((pv.y - (yRim - 1.6)) / (H + 3.2), 0, 1);
      c.copy(low).lerp(mid, THREE.MathUtils.smoothstep(h, 0.05, 0.55)).lerp(top, THREE.MathUtils.smoothstep(h, 0.5, 1.0) * 0.85);
      c.offsetHSL(hue, 0, 0).multiplyScalar(lit * (0.5 + 0.5 * cav));
      col.set([c.r, c.g, c.b], i * 3);
    }
    lump.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(lump);
  }
  return mergeGeometries(parts.map(onlyPNC), false)!;
}

/** Palm: slightly curved trunk, 11 arching fronds with a V section. */
function palm(seed: number, height: number): THREE.BufferGeometry {
  const r = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const bend = new THREE.Vector3((r() - 0.5) * 0.6, 0, (r() - 0.5) * 0.6);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(bend.x * 0.3, height * 0.5, bend.z * 0.3), new THREE.Vector3(bend.x, height, bend.z)]);
  parts.push(vcol(new THREE.TubeGeometry(curve, 6, 0.16, 6, false), new THREE.Color(0x8a7b66), new THREE.Color(0x6b5e4d), 0, height));
  const top = curve.getPoint(1);
  const green = new THREE.Color(0x4f7a34), dark = new THREE.Color(0x2e4a22);
  for (let k = 0; k < 11; k++) {
    const a = (k / 11) * Math.PI * 2 + r() * 0.3;
    const len = 2.6 + r() * 0.8;
    const pos: number[] = [];
    const seg = 6;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const x = t * len, y = Math.sin(t * Math.PI * 0.8) * 0.9 - t * t * 1.4;
      const w = Math.sin(t * Math.PI) * 0.42;
      pos.push(x, y, -w, x, y + 0.12, 0, x, y, w);
    }
    const idx: number[] = [];
    for (let i = 0; i < seg; i++) {
      const b = i * 3;
      idx.push(b, b + 3, b + 1, b + 1, b + 3, b + 4, b + 1, b + 4, b + 2, b + 2, b + 4, b + 5);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.rotateY(-a).translate(top.x, top.y, top.z);
    parts.push(vcol(g, green, dark, top.y - 1.5, top.y + 0.6));
  }
  return mergeGeometries(parts.map(onlyPNC), false)!;
}

export class Vegetation {
  readonly group = new THREE.Group();
  readonly near: THREE.BatchedMesh;
  readonly farCanopy: THREE.InstancedMesh;
  count = 0;
  private ids: number[][] = [];
  private inst: { id: number; variant: number; pos: THREE.Vector3; size: number; lod: number }[] = [];
  private lastCam = new THREE.Vector3(1e9, 0, 0);

  constructor(density = 1, sunDir = new THREE.Vector3(-0.99, 0.2, 0.14)) {
    const rand = rng(4242);
    const trees: Tree[] = [];
    const ok = (x: number, z: number, pad: number) => roadClearance(x, z) > pad && !insideAnyPolygon(x, z);
    const hotel = POINTS.hotelCentre;
    // sunset corridor in front of the hero facade (towards the sun azimuth)
    const sun2 = new THREE.Vector2(sunDir.x, sunDir.z).normalize();
    const inCorridor = (x: number, z: number) => {
      const v = new THREE.Vector2(x - hotel.x, z - hotel.z);
      const along = v.dot(sun2);
      const lat = Math.abs(v.x * sun2.y - v.y * sun2.x);
      return along > -8 && along < 170 && lat < 24;
    };

    for (const r of site.roads) {
      const main = r.c === 'primary' || r.c === 'secondary' || r.c === 'tertiary' || r.c === 'primary_link';
      const street = r.c === 'residential' || r.c === 'unclassified';
      if (!main && !street) continue;
      const line = pts(r.p);
      const spacing = main ? 16 : 32;
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, az] = line[i], [bx, bz] = line[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        const dx = (bx - ax) / L, dz = (bz - az) / L;
        for (let s = rand() * spacing; s < L; s += spacing * (0.8 + rand() * 0.5)) {
          for (const side of [-1, 1]) {
            if (rand() > (main ? 0.8 : 0.3) * density) continue;
            const off = r.w / 2 + (main ? 3.4 + rand() * 3 : 2.3 + rand() * 2);
            const x = ax + dx * s - dz * off * side;
            const z = az + dz * s + dx * off * side;
            if (Math.hypot(x - hotel.x, z - hotel.z) > FAR_R) continue;
            if (!ok(x, z, main ? 2.4 : 1.6) || inCorridor(x, z)) continue;
            const kind: Tree['kind'] = main && r.c === 'tertiary' && rand() < 0.35 ? 'palm' : main ? 'rain' : 'small';
            trees.push({ x, z, s: main ? 0.85 + rand() * 0.55 : 0.55 + rand() * 0.4, kind });
          }
        }
      }
    }
    for (const l of site.land) {
      if (!(l.k.includes('park') || l.k.includes('grass') || l.k.includes('wood') || l.k.includes('cemetery') || l.k.includes('recreation'))) continue;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < l.p.length; i += 2) { x0 = Math.min(x0, l.p[i]); x1 = Math.max(x1, l.p[i]); z0 = Math.min(z0, l.p[i + 1]); z1 = Math.max(z1, l.p[i + 1]); }
      const nTrees = Math.min(260, Math.floor((((x1 - x0) * (z1 - z0)) / 420) * density));
      for (let k = 0; k < nTrees; k++) {
        const x = x0 + rand() * (x1 - x0), z = z0 + rand() * (z1 - z0);
        if (Math.hypot(x - hotel.x, z - hotel.z) > FAR_R || !pointInPolygon(x, z, l.p) || !ok(x, z, 2)) continue;
        trees.push({ x, z, s: 0.7 + rand() * 0.6, kind: 'rain' });
      }
    }
    // the verge between the ring and Jalan Tun Ahmad Zaidi Adruce: big rain trees
    for (let k = 0; k < 150; k++) {
      const x = -150 + rand() * 280, z = -240 + rand() * 160;
      if (!ok(x, z, 4) || inCorridor(x, z) || Math.hypot(x - hotel.x, z - hotel.z) < 40) continue;
      trees.push({ x, z, s: 1.0 + rand() * 0.5, kind: 'rain' });
    }
    // palms in the ring's landscaping, around the supermarket frontage
    const mart = footprints.find((f) => f.kind === 'mart');
    if (mart) {
      for (let k = 0; k < 40; k++) {
        const p = mart.outer[Math.floor(rand() * mart.outer.length)];
        const x = p.x + (rand() - 0.5) * 40, z = p.y + (rand() - 0.5) * 40;
        if (!ok(x, z, 1.5) || inCorridor(x, z)) continue;
        trees.push({ x, z, s: 0.8 + rand() * 0.4, kind: 'palm' });
      }
    }

    const near = trees.filter((t) => Math.hypot(t.x - hotel.x, t.z - hotel.z) < NEAR_R);
    const far = trees.filter((t) => Math.hypot(t.x - hotel.x, t.z - hotel.z) >= NEAR_R && t.kind !== 'palm');
    this.count = trees.length;

    // geometry table: [variant][lod] (palms share one detail level)
    const small = (g: THREE.BufferGeometry) => g.scale(0.62, 0.62, 0.62);
    const table: THREE.BufferGeometry[][] = [
      [rainTree(11, 0), rainTree(11, 1), rainTree(11, 2)],
      [rainTree(29, 0), rainTree(29, 1), rainTree(29, 2)],
      [rainTree(47, 0), rainTree(47, 1), rainTree(47, 2)],
      [small(rainTree(83, 0)), small(rainTree(83, 1)), small(rainTree(83, 2))],
    ];
    const palms = [palm(5, 7.5), palm(9, 9.5)];
    for (const pg of palms) table.push([pg, pg, pg]);
    const vCount = table.flat().filter((g, i, a) => a.indexOf(g) === i).reduce((s2, g) => s2 + g.getAttribute('position').count, 0);
    const leafMat = foliage(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 }), sunDir);
    this.near = new THREE.BatchedMesh(Math.max(1, near.length), vCount, 0, leafMat);
    const idOf = new Map<THREE.BufferGeometry, number>();
    this.ids = table.map((row) => row.map((g) => {
      if (!idOf.has(g)) idOf.set(g, this.near.addGeometry(g));
      return idOf.get(g)!;
    }));
    const q = new THREE.Quaternion();
    const m = new THREE.Matrix4();
    const tint = new THREE.Color();
    const proxies: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; name: string }[] = [];
    for (const t of near) {
      const variant = t.kind === 'palm' ? 4 + Math.floor(rand() * 2) : t.kind === 'small' ? 3 : Math.floor(rand() * 3);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rand() * Math.PI * 2);
      m.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(t.s, t.s * (0.9 + rand() * 0.2), t.s));
      const id = this.near.addInstance(this.ids[variant][2]);
      this.near.setMatrixAt(id, m);
      this.near.setColorAt(id, tint.setHSL(0.2 + rand() * 0.05, 0.1 + rand() * 0.2, 0.84 + rand() * 0.24));
      this.inst.push({ id, variant, pos: new THREE.Vector3(t.x, 5, t.z), size: t.s, lod: 2 });
      proxies.push({ geometry: table[variant][0], matrix: m.clone(), name: t.kind });
    }
    this.near.castShadow = true;
    this.near.receiveShadow = true;
    this.near.perObjectFrustumCulled = true;
    this.near.name = 'trees-near';
    this.group.userData.clipProxies = proxies;

    const farGeo = mergeVertices(new THREE.IcosahedronGeometry(1, 0));
    farGeo.scale(4.6, 2.0, 4.6).translate(0, 6.2, 0);
    farGeo.computeVertexNormals();
    this.farCanopy = new THREE.InstancedMesh(farGeo, foliage(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 }), sunDir), Math.max(1, far.length));
    const leafCols = [0x3f5a2a, 0x4b6a2f, 0x56733a, 0x3a5227, 0x61803f];
    far.forEach((t, i) => {
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rand() * Math.PI * 2);
      m.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(t.s * (0.9 + rand() * 0.2), t.s, t.s * (0.9 + rand() * 0.2)));
      this.farCanopy.setMatrixAt(i, m);
      this.farCanopy.setColorAt(i, tint.setHex(leafCols[Math.floor(rand() * leafCols.length)]));
    });
    this.farCanopy.count = far.length;
    this.farCanopy.receiveShadow = true;
    this.farCanopy.computeBoundingSphere();
    this.farCanopy.name = 'trees-far';
    this.group.add(this.near, this.farCanopy);
  }

  setFarVisible(v: boolean): void {
    this.farCanopy.visible = v;
  }

  /** Per-tree level of detail from its distance to the camera (scaled by tree size). */
  update(cam: THREE.Vector3): void {
    if (cam.distanceToSquared(this.lastCam) < 1) return;
    this.lastCam.copy(cam);
    for (const t of this.inst) {
      const d = t.pos.distanceTo(cam) / t.size;
      const lod = d < 62 ? 0 : d < 210 ? 1 : 2;
      if (lod === t.lod) continue;
      t.lod = lod;
      this.near.setGeometryIdAt(t.id, this.ids[t.variant][lod]);
    }
  }
}
