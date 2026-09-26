// Farley Sibu supermarket — the anchor landmark (medium detail, brief §4.3;
// rec2_t040s, t070s–t090s, rec1_03/16): a tall single volume whose car-park
// frontages carry a screen of vertical fins in four greens with grey panels
// ("barcode" rhythm) above a white band; white wing-shaped membrane canopies
// over a ribbed, green-tinted storefront; white peaked marquees, topiary and
// red-and-white bollards in front. No signage or brand artwork is reproduced.
import * as THREE from 'three';
import { footprints } from './layout';
import { FACADE } from '../config/materials';
import { DIM } from '../config/dimensions';
import { facadeEdges, edgeBox, edgeMatrix, type FacadeEdge } from './FarleyBlocks';
import { mergeAll, paint, prism, rng } from './geom';
import { interiorWindows } from './shaders';
import { shutter } from './textures';

const H = DIM.supermarket.height;
const FIN0 = 5.7; // fins start above the white band

/** Bearing (deg) of an edge's outward normal. */
const bearingOf = (e: FacadeEdge) => ((Math.atan2(e.out.x, -e.out.y) * 180) / Math.PI + 360) % 360;
const isFrontage = (e: FacadeEdge) => { const b = bearingOf(e); return b > 150 && b < 335; };

export class FarleySupermarket {
  readonly group = new THREE.Group();
  readonly meshes: THREE.Mesh[] = [];
  readonly wings: THREE.Mesh;

  constructor() {
    const mart = footprints.filter((f) => f.kind === 'mart');
    const rand = rng(7);
    const solid: THREE.BufferGeometry[] = [];
    const glass: THREE.BufferGeometry[] = [];
    const ribs: THREE.BufferGeometry[] = [];
    const wingGeos: THREE.BufferGeometry[] = [];
    const fins: { m: THREE.Matrix4; c: THREE.Color }[] = [];
    const tents: THREE.Vector2[] = [];
    const shrubs: THREE.Vector3[] = [];
    const bollards: THREE.Vector2[] = [];
    const greens = [0x1c6b36, 0x2f8f45, 0x55b04e, 0x8fcf63, 0x9aa3a0];

    for (const f of mart) {
      solid.push(paint(prism(f.outer, 0, H - 0.5, f.holes), FACADE.martGrey));
      solid.push(paint(prism(f.outer, H - 0.5, H - 0.45, f.holes), 0xb9bdbf));
      for (const e of facadeEdges(f, 6)) {
        solid.push(paint(edgeBox(e, 0, e.len, H - 0.5, H, -0.25, 0.04), 0xf0f1ee)); // parapet
        if (!isFrontage(e)) {
          // service sides: plain panels with a few fins
          for (let u = 2; u < e.len - 2; u += 7) solid.push(paint(edgeBox(e, u, u + 0.25, FIN0, H - 0.6, 0, 0.35), greens[1]));
          continue;
        }
        // white band at the base of the fin screen
        solid.push(paint(edgeBox(e, 0, e.len, FIN0 - 0.7, FIN0, -0.05, 0.55), 0xf4f5f2));
        // storefront: ribbed green-grey panels with glazed entrances
        ribs.push(edgeBox(e, 0.3, e.len - 0.3, 0, FIN0 - 0.72, -0.2, 0.02));
        for (let u = 6; u < e.len - 6; u += 18) glass.push(...entrance(e, u, 4.2, 3.6));
        // barcode fin screen
        const { m, flip } = edgeMatrix(e);
        let u = 0.5, run = 0, col = greens[0];
        while (u < e.len - 0.4) {
          if (run <= 0) { run = 1 + Math.floor(rand() * 6); col = rand() < 0.14 ? greens[4] : greens[Math.floor(rand() * 4)]; }
          const h = H - 0.6 - FIN0 - rand() * 0.6;
          const lu = flip ? e.len - u : u;
          const mm = new THREE.Matrix4().makeTranslation(lu, FIN0 + h / 2, 0.36).premultiply(m).multiply(new THREE.Matrix4().makeScale(0.22, h, 0.42));
          fins.push({ m: mm, c: new THREE.Color(col) });
          u += 0.56;
          run--;
        }
        // white wing canopies along the frontage
        for (let s = 3; s < e.len - 8; s += 13) wingGeos.push(wing(e, s, Math.min(11, e.len - s - 2), 4.9, 4.6));
        // marquees, topiary and bollards on the forecourt
        if (e.len > 20) {
          const dir = e.b.clone().sub(e.a).normalize();
          for (let s = 8; s < e.len - 6; s += 11) tents.push(e.a.clone().addScaledVector(dir, s).addScaledVector(e.out, 13.5));
          for (let s = 4; s < e.len - 3; s += 5.5) {
            const p = e.a.clone().addScaledVector(dir, s).addScaledVector(e.out, 6.2);
            shrubs.push(new THREE.Vector3(p.x, 0.62 + rand() * 0.2, p.y));
            bollards.push(e.a.clone().addScaledVector(dir, s + 2.7).addScaledVector(e.out, 7.8));
          }
        }
      }
    }

    const add = (geos: THREE.BufferGeometry[], mat: THREE.Material, name: string, keep: string[], cast = true) => {
      const mesh = new THREE.Mesh(mergeAll(geos, keep), mat);
      mesh.name = name;
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.meshes.push(mesh);
      return mesh;
    };
    add(solid, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 }), 'mart-body', ['position', 'normal', 'color']);
    const rib = shutter().clone();
    rib.repeat.set(1, 6);
    rib.rotation = Math.PI / 2;
    rib.needsUpdate = true;
    add(ribs, new THREE.MeshStandardMaterial({ map: rib, color: 0x9fb3a8, roughness: 0.4, metalness: 0.4 }), 'mart-storefront', ['position', 'normal', 'uv']);
    add(glass, interiorWindows(new THREE.MeshPhysicalMaterial({ color: 0x2b3a33, roughness: 0.05, envMapIntensity: 1.2 }), { depth: 12, size: [4.2, 3.6], litShare: 1, warm: 0xf4fff0 }), 'mart-entrances', ['position', 'normal', 'aWin', 'aSeed', 'aTan'], false);
    this.wings = add(wingGeos, new THREE.MeshStandardMaterial({ color: 0xf6f6f2, roughness: 0.62, side: THREE.DoubleSide, emissive: 0xfff3dd, emissiveIntensity: 0 }), 'mart-wings', ['position', 'normal']);

    const finMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.15 }), fins.length);
    fins.forEach((f, i) => { finMesh.setMatrixAt(i, f.m); finMesh.setColorAt(i, f.c); });
    finMesh.castShadow = true;
    finMesh.receiveShadow = true;
    finMesh.name = 'mart-fins';

    // marquees: peaked pyramid roof + valance on four poles
    const tentGeo = mergeAll([new THREE.ConeGeometry(4.3, 2.3, 4, 1, true).rotateY(Math.PI / 4).translate(0, 3.6 + 1.15, 0), new THREE.CylinderGeometry(4.3 * Math.SQRT1_2 * 1.02, 4.3 * Math.SQRT1_2 * 1.02, 0.35, 4, 1, true).rotateY(Math.PI / 4).translate(0, 3.45, 0)], ['position', 'normal']);
    const tentMesh = new THREE.InstancedMesh(tentGeo, new THREE.MeshStandardMaterial({ color: FACADE.tentWhite, roughness: 0.7, side: THREE.DoubleSide, emissive: 0xfff4e0, emissiveIntensity: 0.04 }), Math.max(1, tents.length));
    const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 3.6, 6).translate(0, 1.8, 0);
    const poleMesh = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0xd9d9d4, roughness: 0.4, metalness: 0.6 }), Math.max(1, tents.length * 4));
    tents.forEach((p, i) => {
      tentMesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, 0, p.y));
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + (k * Math.PI) / 2;
        poleMesh.setMatrixAt(i * 4 + k, new THREE.Matrix4().makeTranslation(p.x + Math.cos(a) * 2.95, 0, p.y + Math.sin(a) * 2.95));
      }
    });
    tentMesh.count = tents.length;
    poleMesh.count = tents.length * 4;
    tentMesh.castShadow = true;
    tentMesh.name = 'mart-tents';
    poleMesh.name = 'mart-poles';

    const shrubMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.75, 2), new THREE.MeshStandardMaterial({ color: 0x3f6b2e, roughness: 0.85 }), Math.max(1, shrubs.length));
    shrubs.forEach((p, i) => shrubMesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
    shrubMesh.count = shrubs.length;
    shrubMesh.castShadow = true;
    shrubMesh.name = 'mart-topiary';
    const bol = new THREE.CylinderGeometry(0.07, 0.07, 1.0, 10).translate(0, 0.5, 0);
    const bolMesh = new THREE.InstancedMesh(bol, new THREE.MeshStandardMaterial({ color: 0xd8312a, roughness: 0.5 }), Math.max(1, bollards.length));
    bollards.forEach((p, i) => bolMesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, 0, p.y)));
    bolMesh.count = bollards.length;
    bolMesh.name = 'mart-bollards';

    this.group.add(finMesh, tentMesh, poleMesh, shrubMesh, bolMesh);
  }

  setDusk(lights: number): void {
    (this.wings.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.35 * lights;
  }
}

/** Glazed entrance panes (interior-mapped) in an edge frame. */
function entrance(e: FacadeEdge, u: number, w: number, h: number): THREE.BufferGeometry[] {
  const { m, flip } = edgeMatrix(e);
  const a = flip ? e.len - u - w : u;
  const g = new THREE.PlaneGeometry(w, h).toNonIndexed();
  g.translate(a + w / 2, h / 2, 0.05);
  const pos = g.getAttribute('position');
  const aWin = new Float32Array(pos.count * 2), aSeed = new Float32Array(pos.count), aTan = new Float32Array(pos.count * 3);
  const tan = new THREE.Vector3(1, 0, 0).transformDirection(m);
  for (let i = 0; i < pos.count; i++) {
    aWin[i * 2] = (pos.getX(i) - a) / w;
    aWin[i * 2 + 1] = pos.getY(i) / h;
    aSeed[i] = 0.5;
    aTan.set([tan.x, tan.y, tan.z], i * 3);
  }
  g.setAttribute('aWin', new THREE.BufferAttribute(aWin, 2));
  g.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
  g.setAttribute('aTan', new THREE.BufferAttribute(aTan, 3));
  g.applyMatrix4(m);
  return [g];
}

/** A white membrane wing: curved sheet projecting from the facade. */
function wing(e: FacadeEdge, u: number, len: number, reach: number, y: number): THREE.BufferGeometry {
  const { m, flip } = edgeMatrix(e);
  const g = new THREE.PlaneGeometry(len, reach, 16, 6);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const s = p.getX(i) / len + 0.5; // 0..1 along
    const t = p.getY(i) / reach + 0.5; // 0 at the wall … 1 at the tip
    const sag = Math.sin(s * Math.PI) * 0.35;
    const lift = 0.9 * t * t - 0.45 * t;
    const uu = u + s * len;
    p.setXYZ(i, flip ? e.len - uu : uu, y + lift - sag * (1 - t), 0.3 + t * reach);
  }
  g.computeVertexNormals();
  g.applyMatrix4(m);
  return g;
}
