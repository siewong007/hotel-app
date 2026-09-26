// Perimeter parking: 2.5 × 5 m bays in front of every Farley frontage, worn
// line paint, kerbs, and parked cars — seven procedural models at three levels
// of detail, drawn with two BatchedMeshes (body + trim) for the whole car park;
// each instance swaps its level of detail with camera distance. The bay
// centred on the Salim Inn lobby door is kept free ("park at the door"); the
// three guest cars sit beside it.
import * as THREE from 'three';
import { footprints, salimLocal, SALIM_WIDTH } from './layout';
import { facadeEdges, edgeMatrix, type FacadeEdge } from './FarleyBlocks';
import { DIM } from '../config/dimensions';
import { GROUND } from '../config/materials';
import { boxAt, mergeAll, ribbon, rng } from './geom';
import { insideAnyPolygon } from './spatial';
import { PLAN } from './SalimInnBuilding';
import { buildCarModels, CAR_LOD, CAR_PAINTS, MODEL_WEIGHTS, type CarModel } from './cars';
import { wornPaint } from './shaders';

const BAY_W = 2.5;
const BAY_D = 5.0;
const KERB = DIM.canopyProjection; // bays start at the canopy line

interface Placed { model: number; m: THREE.Matrix4; colour: THREE.Color }

/** Car body: per-instance paint, with glass and black trim picked per face (aKind). */
function bodyMaterial(): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.15 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aKind;\nvarying float vKind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKind = aKind;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vKind;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float kGlass = step(0.5, vKind) * step(vKind, 1.5);
        float kTrim = step(1.5, vKind);
        float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        float solid = smoothstep(0.62, 0.8, lum); // white cars: solid paint; the rest metallic
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012, 0.016, 0.02), kGlass);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.022, 0.023, 0.025), kTrim);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(mix(roughnessFactor, 0.2, solid), 0.04, kGlass);
        roughnessFactor = mix(roughnessFactor, 0.6, kTrim);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.02, max(solid, max(kGlass, kTrim)));`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        material.clearcoat *= 1.0 - kTrim;`);
  };
  mat.customProgramCacheKey = () => 'car-body';
  return mat;
}

export class Parking {
  readonly group = new THREE.Group();
  readonly paint: THREE.BatchedMesh;
  readonly trim: THREE.BatchedMesh;
  readonly models: CarModel[];
  readonly placed: Placed[] = [];
  private lodIds: number[][] = []; // [model][lod] → geometry id (same in both batches)
  private lod: Int8Array = new Int8Array(0);
  private centres: THREE.Vector3[] = [];
  private instP: number[] = [];
  private instT: number[] = [];
  private lastCam = new THREE.Vector3(1e9, 0, 0);
  /** World-space centres of the three guest bays in front of the lobby. */
  readonly guestBays: THREE.Vector3[] = [];

  constructor() {
    const lines: THREE.BufferGeometry[] = [];
    const kerbs: THREE.BufferGeometry[] = [];
    const rand = rng(99);
    this.models = buildCarModels();
    const pickModel = () => {
      let r = rand(), i = 0;
      while (i < MODEL_WEIGHTS.length - 1 && (r -= MODEL_WEIGHTS[i]) > 0) i++;
      return i;
    };

    const bayRow = (e: FacadeEdge, occupancy: number, opts: { start?: number; keepFree?: number[]; fill?: { i: number; model: number; colour: number }[] } = {}) => {
      const { m, flip } = edgeMatrix(e);
      const start = opts.start ?? (e.len - Math.floor((e.len - 1) / BAY_W) * BAY_W) / 2;
      const n = Math.floor((e.len - start - 0.4) / BAY_W);
      const probe = (u: number, w: number) => {
        const p = new THREE.Vector3(flip ? e.len - u : u, 0, w).applyMatrix4(m);
        return !insideAnyPolygon(p.x, p.z);
      };
      if (opts.start === undefined && (!probe(e.len / 2, KERB + BAY_D + 1) || !probe(start + 1, KERB + BAY_D) || !probe(e.len - start - 1, KERB + BAY_D))) return;
      const U = (u: number) => (flip ? e.len - u : u);
      kerbs.push(boxAt(0, 0, KERB - 0.15, e.len, 0.14, KERB).applyMatrix4(m));
      for (let i = 0; i <= n; i++) {
        const u = U(start + i * BAY_W);
        const g = ribbon([[u, KERB + 0.2], [u, KERB + BAY_D]], 0.1, 0.062);
        if (g) lines.push(g.applyMatrix4(m));
      }
      // bay end line
      const g2 = ribbon([[U(start), KERB + BAY_D], [U(start + n * BAY_W), KERB + BAY_D]], 0.1, 0.062);
      if (g2) lines.push(g2.applyMatrix4(m));
      for (let i = 0; i < n; i++) {
        if (opts.keepFree?.includes(i)) continue;
        const forced = opts.fill?.find((f) => f.i === i);
        if (!forced && rand() > occupancy) continue;
        const model = forced ? forced.model : pickModel();
        const md = this.models[model];
        const u = U(start + (i + 0.5) * BAY_W + (rand() - 0.5) * 0.18);
        const w = KERB + 0.35 + md.length / 2 + rand() * 0.25;
        const noseIn = forced ? true : rand() < 0.6;
        const yaw = (noseIn ? Math.PI : 0) + (rand() - 0.5) * 0.05;
        const mm = new THREE.Matrix4().makeTranslation(u, 0, w).multiply(new THREE.Matrix4().makeRotationY(yaw));
        this.placed.push({ model, m: mm.premultiply(m), colour: new THREE.Color(forced ? forced.colour : CAR_PAINTS[Math.floor(rand() * CAR_PAINTS.length)]) });
      }
    };

    for (const f of footprints) {
      if (f.kind === 'salim') continue;
      for (const e of facadeEdges(f, 8)) bayRow(e, 0.64);
    }

    const salimEdge: FacadeEdge = (() => {
      const a = salimLocal(0, 0, 0), b = salimLocal(SALIM_WIDTH, 0, 0);
      const out = salimLocal(0, 0, 1).sub(a);
      return { a: new THREE.Vector2(a.x, a.z), b: new THREE.Vector2(b.x, b.z), out: new THREE.Vector2(out.x, out.z).normalize(), len: SALIM_WIDTH };
    })();
    const lobbyU = (PLAN.door.x0 + PLAN.door.x1) / 2;
    bayRow(salimEdge, 0.55, { start: lobbyU - BAY_W / 2, keepFree: [0], fill: [{ i: 1, model: 3, colour: 0xf2f2ef }, { i: 2, model: 1, colour: 0x6b1419 }, { i: 3, model: 2, colour: 0x2b2d30 }] });
    for (const du of [0, BAY_W, 2 * BAY_W]) this.guestBays.push(salimLocal(lobbyU + du, 0, KERB + BAY_D / 2));

    const lineMat = wornPaint(new THREE.MeshStandardMaterial({ color: GROUND.lineWhite, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }), new THREE.Color(GROUND.asphalt));
    const lineMesh = new THREE.Mesh(mergeAll(lines, ['position', 'normal']), lineMat);
    lineMesh.name = 'bay-lines';
    lineMesh.receiveShadow = true;
    const kerbMesh = new THREE.Mesh(mergeAll(kerbs, ['position', 'normal']), new THREE.MeshStandardMaterial({ color: GROUND.kerb, roughness: 0.9 }));
    kerbMesh.name = 'kerbs';
    kerbMesh.receiveShadow = true;

    // cars: two batched meshes for the whole car park, three LODs per model
    const sum = (f: (m: CarModel) => THREE.BufferGeometry[]) => this.models.reduce((a, m) => a + f(m).reduce((b, g) => b + g.getAttribute('position').count, 0), 0);
    const n = Math.max(1, this.placed.length);
    this.paint = new THREE.BatchedMesh(n, sum((m) => m.paint), 0, bodyMaterial());
    this.trim = new THREE.BatchedMesh(n, sum((m) => m.trim), 0, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.25, envMapIntensity: 1.2 }));
    this.lodIds = this.models.map((m) => m.paint.map((g, i) => {
      const a = this.paint.addGeometry(g);
      const b = this.trim.addGeometry(m.trim[i]);
      if (a !== b) throw new Error('car LOD ids diverged');
      return a;
    }));
    this.lod = new Int8Array(this.placed.length).fill(2);
    for (const p of this.placed) {
      const a = this.paint.addInstance(this.lodIds[p.model][2]);
      this.paint.setMatrixAt(a, p.m);
      this.paint.setColorAt(a, p.colour);
      const b = this.trim.addInstance(this.lodIds[p.model][2]);
      this.trim.setMatrixAt(b, p.m);
      this.instP.push(a);
      this.instT.push(b);
      this.centres.push(new THREE.Vector3().setFromMatrixPosition(p.m));
    }
    for (const b of [this.paint, this.trim]) {
      b.castShadow = true;
      b.receiveShadow = true;
      b.frustumCulled = false; // one batch spans the whole ring
      b.perObjectFrustumCulled = true;
    }
    this.paint.name = 'cars';
    this.trim.name = 'car-trim';
    // proxies for the debug clip check (BatchedMesh geometry is packed)
    this.group.userData.clipProxies = this.placed.map((p) => ({ geometry: this.models[p.model].paint[0], matrix: p.m, name: `car-${this.models[p.model].name}` }));
    this.group.add(lineMesh, kerbMesh, this.paint, this.trim);
  }

  /** Swap each car's level of detail with its distance to the camera. */
  update(cam: THREE.Vector3): void {
    if (cam.distanceToSquared(this.lastCam) < 1) return;
    this.lastCam.copy(cam);
    const [d0, d1] = CAR_LOD;
    for (let i = 0; i < this.placed.length; i++) {
      const d = this.centres[i].distanceTo(cam);
      const l = d < d0 ? 0 : d < d1 ? 1 : 2;
      if (l === this.lod[i]) continue;
      this.lod[i] = l;
      const id = this.lodIds[this.placed[i].model][l];
      this.paint.setGeometryIdAt(this.instP[i], id);
      this.trim.setGeometryIdAt(this.instT[i], id);
    }
  }
}
