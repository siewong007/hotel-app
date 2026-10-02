// Lobby (the entrance lot, ground floor; brief §4.4), from the owner's photos
// of the reception (2026-10-02):
//   · light cream 600 mm polished porcelain, a flat white ceiling with
//     recessed downlights and a CCTV camera;
//   · walls of striated grey-brown laminate in tall panels between thin white
//     strips, with a laminate door in the right-hand wall;
//   · the reception: an alcove against the inside of the tiled frontage beside
//     the entrance — white laminate pillars, a laminate bulkhead between white
//     bands, the painted mural of Malaysia on its back wall and the black
//     granite-topped counter across its mouth (ReservationCounter);
//   · a three-seat stainless bench along the right-hand wall, artificial
//     cherry blossom by the entrance glass, plain notices on the pillars
//     (the photos' third-party badges and stickers are not reproduced);
//   · the stair core at the back, opposite the counter, under a KELUAR sign.
// Lighting is two real lights (a spot on the counter, a soft fill); the
// downlights and their wall scallops are emissive surfaces and additive washes.
import * as THREE from 'three';
import { PLAN } from '../world/SalimInnBuilding';
import { batchPlain, boxAt, mergeAll, mergeStatic, metricUV } from '../world/geom';
import { ReservationCounter } from './ReservationCounter';
import { exitTexture, noticeTexture, PublicMats, scallopWash } from './lobbyMaterials';

const LIGHT = 0xffe2bd; // ≈ 3,500 K: the photos' neutral-warm downlights
const PANEL = 1.2; // laminate panel width between the white strips
const LINES = [1.15, 2.35]; // the white grooves across the panels

function mesh(g: THREE.BufferGeometry, m: THREE.Material, name = '', shadow = true): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.name = name;
  o.castShadow = shadow;
  o.receiveShadow = true;
  return o;
}

/** Additive wash quad (washes never cast or receive shadows). */
function wash(w: number, h: number, mat: THREE.Material, name: string): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.name = name;
  m.renderOrder = 2;
  return m;
}

export class Lobby {
  readonly group = new THREE.Group();
  readonly lights: THREE.Light[] = [];
  readonly counter: ReservationCounter;
  private spot: THREE.SpotLight;
  private fill: THREE.PointLight;
  private lit: THREE.Material[] = []; // emissive / additive materials that follow the lights
  private litBase = new Map<THREE.Material, THREE.Color>();

  /** `counter` may be built first (World builds the interior in slices). */
  constructor(counter: ReservationCounter = new ReservationCounter(), merge = true) {
    this.counter = counter;
    const L = PLAN.lobby;
    const R = PLAN.reception;
    const s = PLAN.stair;
    const H = PLAN.lobbyCeiling;
    const zBack = L.z0; // face of the back wall
    const laminate = PublicMats.laminate();
    const white = PublicMats.laminateWhite();

    // ------------------------------------------------------------ floors
    // the finish sits 12 mm proud of the slab (coplanar faces z-fight)
    this.group.add(mesh(metricUV(boxAt(L.x0, -0.02, L.z0, L.x1, 0.012, L.z1)), PublicMats.porcelain(), 'lobby-floor', false));
    // the stair core's ground floor: the corridors' carpet starts at the stair
    this.group.add(mesh(metricUV(boxAt(s.x0, -0.02, s.z0, s.x1, 0.014, s.z1)), PublicMats.carpet(), 'stair-floor', false));

    // ------------------------------------------------------------ panelled walls
    const lam: THREE.BufferGeometry[] = [], strips: THREE.BufferGeometry[] = [];
    /** Laminate panels on a wall running along z (x fixed, facing ±x). */
    const wallZ = (x: number, face: 1 | -1, z0: number, z1: number, y1: number) => {
      const xa = face > 0 ? x : x - 0.012, xb = face > 0 ? x + 0.012 : x;
      lam.push(boxAt(xa, 0, z0, xb, y1, z1));
      const sa = face > 0 ? x + 0.012 : x - 0.022, sb = face > 0 ? x + 0.022 : x - 0.012;
      for (let z = z1 - PANEL; z > z0 + 0.3; z -= PANEL) strips.push(boxAt(sa, 0, z - 0.05, sb, y1, z + 0.05));
      for (const y of LINES) strips.push(boxAt(sa, y - 0.006, z0, sb, y + 0.006, z1));
      strips.push(boxAt(sa, 0, z0, sb, 0.08, z1)); // white kick
    };
    /** …and on a wall running along x (z fixed, facing ±z). */
    const wallX = (z: number, face: 1 | -1, x0: number, x1: number, y1: number) => {
      const za = face > 0 ? z : z - 0.012, zb = face > 0 ? z + 0.012 : z;
      lam.push(boxAt(x0, 0, za, x1, y1, zb));
      const sa = face > 0 ? z + 0.012 : z - 0.022, sb = face > 0 ? z + 0.022 : z - 0.012;
      for (let x = x0 + PANEL; x < x1 - 0.3; x += PANEL) strips.push(boxAt(x - 0.05, 0, sa, x + 0.05, y1, sb));
      for (const y of LINES) strips.push(boxAt(x0, y - 0.006, sa, x1, y + 0.006, sb));
      strips.push(boxAt(x0, 0, sa, x1, 0.08, sb));
    };
    wallZ(L.x0, 1, zBack, L.z1 - 0.02, H); // left (stair-core side of the entrance)
    wallZ(L.x1, -1, zBack, R.z1, H); // right, behind the reception pillar
    wallX(zBack, 1, L.x0, s.x0 - 0.2, H); // back, beside the stair core
    // the right-hand wall's door (back office): a laminate leaf with a narrow
    // frosted strip and a steel pull, in a white frame
    const dz0 = R.z1 - 0.25, dz1 = dz0 - 0.92;
    const frame: THREE.BufferGeometry[] = [
      boxAt(L.x1 - 0.05, 0, dz1 - 0.06, L.x1 - 0.012, 2.16, dz1),
      boxAt(L.x1 - 0.05, 0, dz0, L.x1 - 0.012, 2.16, dz0 + 0.06),
      boxAt(L.x1 - 0.05, 2.1, dz1 - 0.06, L.x1 - 0.012, 2.16, dz0 + 0.06),
    ];
    lam.push(boxAt(L.x1 - 0.045, 0.01, dz1, L.x1 - 0.022, 2.1, dz0));
    const frosted = new THREE.MeshPhysicalMaterial({ color: 0xcfe0d8, roughness: 0.35, transmission: 0, transparent: true, opacity: 0.85 });
    this.group.add(mesh(boxAt(L.x1 - 0.047, 0.35, dz0 - 0.24, L.x1 - 0.043, 1.95, dz0 - 0.14), frosted, 'office-door-glass', false));
    this.group.add(mesh(boxAt(L.x1 - 0.08, 0.95, dz1 + 0.08, L.x1 - 0.045, 1.25, dz1 + 0.11), PublicMats.stainless(), 'office-door-pull', false));
    this.group.add(mesh(merged(frame), white, 'office-door-frame'));

    // the frontage's inner face left of and above the entrance door
    this.group.add(mesh(merged([
      boxAt(L.x0, 0, L.z1 - 0.012, PLAN.door.x0 - 0.06, H, L.z1),
      boxAt(PLAN.door.x0 - 0.06, PLAN.door.h + 0.06, L.z1 - 0.012, R.x0 - 0.34, H, L.z1),
    ]), PublicMats.plaster(), 'lobby-front-inner', false));

    // ------------------------------------------------------------ reception alcove
    const wx0 = R.x0 - 0.34, wx1 = L.x1; // outer faces of the two pillars
    // pillars, floor to ceiling
    const pillars = [boxAt(wx0, 0, R.z1, R.x0, H, R.z0), boxAt(R.x1, 0, R.z1, wx1, H, R.z0)];
    // the volume above the alcove: soffit, and the bulkhead's face in bands —
    // white, striated laminate, white again up to the ceiling
    const soffit = boxAt(R.x0, R.soffit, R.z1, R.x1, R.soffit + 0.05, R.z0);
    const bandZ0 = R.z1 - 0.02, bandZ1 = R.z1;
    const bands = [
      boxAt(wx0, R.soffit, bandZ0, wx1, R.soffit + 0.09, bandZ1),
      boxAt(wx0, R.soffit + 0.6, bandZ0, wx1, H, bandZ1),
    ];
    lam.push(boxAt(wx0, R.soffit + 0.09, bandZ0 + 0.004, wx1, R.soffit + 0.6, bandZ1));
    this.group.add(mesh(merged([...pillars, ...bands]), white, 'reception-pillars'));
    this.group.add(mesh(soffit, PublicMats.ceiling(), 'reception-soffit', false));
    // the mural on the frontage's inner face, from just behind the counter up
    // to the soffit; its texture runs 0.23 m further down (behind the counter)
    const muralH = R.soffit - 0.67;
    const mural = new THREE.Mesh(new THREE.PlaneGeometry(R.x1 - R.x0, muralH), PublicMats.mural());
    const uv = mural.geometry.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 0.05 + uv.getX(i) * 0.9); // 5 % trimmed each side
    mural.rotation.y = Math.PI; // facing into the lobby (−z)
    mural.position.set((R.x0 + R.x1) / 2, 0.67 + muralH / 2, R.z0 - 0.004);
    mural.name = 'reception-mural';
    mural.receiveShadow = true;
    this.group.add(mural);
    // the wall under the mural, behind the counter
    this.group.add(mesh(boxAt(R.x0, 0, R.z0 - 0.012, R.x1, 0.67, R.z0), PublicMats.plaster(), 'reception-wall', false));
    // soffit fittings: a downlight, the CCTV dome and the air-conditioning slot
    const downDisc = new THREE.CircleGeometry(0.065, 24).rotateX(Math.PI / 2);
    const discMat = PublicMats.emissive(LIGHT, 3.0, 'downlight');
    this.lit.push(discMat);
    const alcoveLight = new THREE.Mesh(downDisc, discMat);
    alcoveLight.position.set(R.x0 + 0.8, R.soffit - 0.002, (R.z0 + R.z1) / 2);
    this.group.add(alcoveLight);
    this.group.add(cctvDome().translateX(R.x1 - 0.6).translateY(R.soffit).translateZ(R.z1 + 0.35));
    const ac = new THREE.Group();
    ac.add(mesh(boxAt(-0.42, -0.012, -0.1, 0.42, 0, 0.1), PublicMats.white(), 'ac-face', false));
    ac.add(mesh(boxAt(-0.38, -0.014, -0.03, 0.38, -0.011, 0.03), PublicMats.black(), 'ac-slot', false));
    ac.position.set(R.x0 + 1.5, R.soffit, R.z1 + 0.42);
    this.group.add(ac);
    // plain notices taped to the pillars' faces (the photos' rating badges
    // and payment stickers are third-party marks, not reproduced)
    const notice = (x: number, y: number, w: number, seed: number) => {
      const n = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 1.375), PublicMats.print(noticeTexture(seed), `notice-${seed}`));
      n.rotation.y = Math.PI;
      n.position.set(x, y, R.z1 - 0.003);
      n.name = 'notice';
      this.group.add(n);
    };
    notice(R.x1 + 0.15, 1.75, 0.2, 11);
    notice(R.x1 + 0.15, 1.38, 0.2, 12);
    notice(wx0 + 0.17, 1.82, 0.24, 13);

    // ------------------------------------------------------------ ceiling lights, CCTV
    const scallop = PublicMats.glow(scallopWash(), 0xffe0bc, 0.42, 'scallop');
    this.lit.push(scallop);
    for (const z of [-4.9, -7.1, -9.3, -11.0]) {
      for (const x of [L.x0 + 1.0, L.x1 - 1.0]) {
        const d = new THREE.Mesh(downDisc, discMat);
        d.position.set(x, H - 0.002, z);
        this.group.add(d);
      }
      // each side wall takes a soft scallop from its nearer light
      for (const [x, rot] of [[L.x0 + 0.025, Math.PI / 2], [L.x1 - 0.025, -Math.PI / 2]] as const) {
        if (x > L.x1 - 0.1 && z > dz1 - 0.6) continue; // not over the office door
        const sc = wash(1.3, 2.6, scallop, 'scallop');
        sc.rotation.y = rot;
        sc.position.set(x, H - 1.3, z);
        this.group.add(sc);
      }
    }
    this.group.add(cctvBullet().translateX(L.x1 - 0.12).translateY(H - 0.02).translateZ(R.z1 - 0.35));

    // ------------------------------------------------------------ the stair core opening, KELUAR
    lam.push(boxAt(s.x0, 2.35, zBack - 0.01, s.x1, H, zBack + 0.012)); // lintel over the opening
    const arch: THREE.BufferGeometry[] = [
      boxAt(s.x0 - 0.06, 0, zBack, s.x0, 2.35, zBack + 0.03),
      boxAt(s.x0 - 0.06, 2.35, zBack, s.x1, 2.41, zBack + 0.03),
    ];
    this.group.add(mesh(merged(arch), white, 'stair-architrave'));
    const exitMat = new THREE.MeshBasicMaterial({ map: exitTexture(), color: new THREE.Color(1.5, 1.5, 1.5), toneMapped: false });
    const exit = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.113, 0.03), [PublicMats.white(), PublicMats.white(), PublicMats.white(), PublicMats.white(), exitMat, PublicMats.white()]);
    exit.position.set((s.x0 + s.x1) / 2, 2.62, zBack + 0.03);
    exit.name = 'keluar';
    this.group.add(exit);

    // ------------------------------------------------------------ bench, blossom
    this.group.add(steelBench().translateX(L.x1 - 0.06).translateZ(-7.4));
    this.group.add(blossom().translateX(R.x0 - 0.62).translateZ(R.z0 - 0.45));

    this.group.add(mesh(merged(lam), laminate, 'lobby-laminate'));
    this.group.add(mesh(merged(strips), white, 'lobby-strips', false));

    // ------------------------------------------------------------ lights
    // an accent downlight in front of the alcove, raking the counter and the
    // mural; a soft fill at head height in the middle of the room
    this.spot = new THREE.SpotLight(LIGHT, 0, 9, 0.7, 0.75, 1.4);
    this.spot.position.set((R.x0 + R.x1) / 2, H - 0.06, R.z1 - 1.1);
    this.spot.target.position.set((R.x0 + R.x1) / 2, 0.9, R.z0 - 0.2);
    const accent = new THREE.Mesh(downDisc, discMat);
    accent.position.set((R.x0 + R.x1) / 2, H - 0.004, R.z1 - 1.1);
    this.group.add(accent);
    this.fill = new THREE.PointLight(0xffe6c8, 0, 13, 1.6);
    this.fill.position.set((L.x0 + L.x1) / 2, 2.0, -7.0);
    this.lights.push(this.spot, this.fill);
    this.group.add(this.spot, this.spot.target, this.fill, this.counter.group);
    this.group.name = 'lobby';
    for (const m of this.lit) {
      const col = (m as THREE.MeshBasicMaterial).color;
      if (col) this.litBase.set(m, col.clone());
    }
    if (merge) this.merge();
  }

  /** One draw per material for everything that never moves on its own (a
   *  step of its own when the interior is built in slices). */
  merge(): void {
    const moving = [...this.counter.dynamic];
    batchPlain(this.group, moving);
    mergeStatic(this.group, moving);
  }

  setLights(v: number): void {
    this.spot.intensity = 26 * v;
    this.fill.intensity = 9 * v;
    for (const m of this.lit) {
      if ((m as THREE.MeshStandardMaterial).emissiveIntensity !== undefined && !(m as THREE.MeshBasicMaterial).isMeshBasicMaterial) {
        (m as THREE.MeshStandardMaterial).emissiveIntensity = 1.4 * v;
        continue;
      }
      const base = this.litBase.get(m);
      if (base) (m as THREE.MeshBasicMaterial).color.copy(base).multiplyScalar(v);
    }
  }

  /** Nothing in the lobby animates on its own now (World still calls it). */
  update(): void {}
}

/** One geometry from plain parts, with metric UVs for the textured finishes. */
const merged = (parts: THREE.BufferGeometry[]) => metricUV(mergeAll(parts, ['position', 'normal']));

/** The ceiling's dome camera: a white base and a smoked dome. */
function cctvDome(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 24).translate(0, -0.01, 0), PublicMats.white(), 'cctv-base', false));
  g.add(mesh(new THREE.SphereGeometry(0.055, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(0, -0.02, 0), new THREE.MeshPhysicalMaterial({ color: 0x1a1c1f, roughness: 0.08, clearcoat: 1 }), 'cctv-dome', false));
  g.name = 'cctv';
  return g;
}

/** A bullet camera on a short arm, at the room's front corner. */
function cctvBullet(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 8).translate(0, -0.06, 0), PublicMats.white(), 'cctv-arm', false));
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 16).rotateZ(Math.PI / 2).translate(-0.06, -0.13, 0), PublicMats.white());
  body.rotation.y = -0.6;
  g.add(body);
  g.name = 'cctv';
  return g;
}

/** The three-seat stainless bench along the right-hand wall, seats facing −x:
 *  slatted seats and backs on a steel beam, armrests at the ends. */
function steelBench(): THREE.Group {
  const g = new THREE.Group();
  const steel = PublicMats.stainless();
  const parts: THREE.BufferGeometry[] = [];
  const seatW = 0.56, n = 3, len = n * seatW + 0.1;
  const z0 = -len / 2;
  for (let i = 0; i < n; i++) {
    const a = z0 + 0.05 + i * seatW;
    // seat: five slats, front to back (x towards the wall)
    for (let k = 0; k < 5; k++) parts.push(boxAt(-0.52 + k * 0.09, 0.43, a + 0.02, -0.52 + k * 0.09 + 0.07, 0.45, a + seatW - 0.02));
    // back: four slats, leaning slightly towards the wall
    for (let k = 0; k < 4; k++) {
      const y = 0.52 + k * 0.1;
      parts.push(boxAt(-0.1 + k * 0.012, y, a + 0.02, -0.08 + k * 0.012, y + 0.07, a + seatW - 0.02));
    }
  }
  // beam, legs and armrests
  parts.push(boxAt(-0.35, 0.36, z0, -0.29, 0.42, -z0));
  for (const z of [z0 + 0.12, -z0 - 0.12]) {
    parts.push(boxAt(-0.36, 0, z - 0.025, -0.3, 0.36, z + 0.025), boxAt(-0.5, 0, z - 0.025, -0.14, 0.03, z + 0.025));
    parts.push(boxAt(-0.5, 0.6, z - 0.02, -0.08, 0.63, z + 0.02), boxAt(-0.48, 0.45, z - 0.015, -0.45, 0.6, z + 0.015));
  }
  g.add(mesh(merged(parts), steel, 'bench'));
  g.name = 'bench';
  return g;
}

/** Artificial cherry blossom in a tall clear vase. */
function blossom(): THREE.Group {
  const g = new THREE.Group();
  const vase = [new THREE.Vector2(0, 0), new THREE.Vector2(0.09, 0), new THREE.Vector2(0.1, 0.06), new THREE.Vector2(0.08, 0.5), new THREE.Vector2(0.072, 0.5), new THREE.Vector2(0.09, 0.06), new THREE.Vector2(0, 0.012)];
  g.add(mesh(new THREE.LatheGeometry(vase, 24), new THREE.MeshPhysicalMaterial({ color: 0xe8f0f0, roughness: 0.06, transparent: true, opacity: 0.45, depthWrite: false }), 'vase', false));
  const stem = PublicMats.frame();
  const flower = new THREE.MeshStandardMaterial({ color: 0xf2a6c3, roughness: 0.7 });
  const flowerDeep = new THREE.MeshStandardMaterial({ color: 0xd9577f, roughness: 0.7 });
  let seed = 41;
  const r = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const blossoms: THREE.BufferGeometry[] = [], deep: THREE.BufferGeometry[] = [], stems: THREE.BufferGeometry[] = [];
  for (let b = 0; b < 7; b++) {
    const a = r() * Math.PI * 2, tilt = 0.12 + r() * 0.3, h = 0.8 + r() * 0.5;
    const dir = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
    const st = new THREE.CylinderGeometry(0.006, 0.009, h, 6).translate(0, h / 2, 0);
    st.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    st.translate(0, 0.35, 0);
    stems.push(st);
    for (let k = 0; k < 46; k++) {
      const t = 0.3 + r() * 0.7;
      const p = dir.clone().multiplyScalar(h * t).add(new THREE.Vector3((r() - 0.5) * 0.1, 0.35 + (r() - 0.5) * 0.06, (r() - 0.5) * 0.1));
      (k % 4 === 0 ? deep : blossoms).push(new THREE.IcosahedronGeometry(0.009 + r() * 0.008, 1).translate(p.x, p.y, p.z));
    }
  }
  g.add(mesh(merged(stems), stem, 'blossom-stems', false));
  g.add(mesh(merged(blossoms), flower, 'blossom', false));
  g.add(mesh(merged(deep), flowerDeep, 'blossom-deep', false));
  g.name = 'blossom';
  return g;
}
