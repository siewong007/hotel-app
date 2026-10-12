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
//   · three-seat stainless benches along the right-hand wall and the back,
//     a wire magazine rack, artificial cherry blossom by the entrance glass,
//     plain notices on the pillars (the photos' third-party badges and
//     stickers are not reproduced);
//   · from the owner's walk-through video (2026-10-12): the back wall's cream
//     right half with the stair door opposite the counter — a dark brown
//     leaf standing open, a red WELCOME mat before it — the white glass
//     cabinet beside it under a lavender canvas, and the no-smoking notice.
// Lighting is two real lights (a spot on the counter, a soft fill); the
// downlights and their wall scallops are emissive surfaces and additive washes.
import * as THREE from 'three';
import { PLAN } from '../world/SalimInnBuilding';
import { batchPlain, boxAt, mergeAll, mergeStatic, metricUV, paint, tube } from '../world/geom';
import { ReservationCounter } from './ReservationCounter';
import { lavenderTexture, noSmokingTexture, noticeTexture, PublicMats, scallopWash, welcomeMatTexture } from './lobbyMaterials';

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
    // Built on the lobby floor: World stands the group at PLAN.floor.
    const L = PLAN.lobby;
    const R = PLAN.reception;
    const sd = PLAN.stair.door;
    const H = PLAN.lobbyCeiling;
    const doorH = PLAN.door.h - PLAN.floor; // the entrance's head
    const zBack = L.z0; // face of the back wall
    const laminate = PublicMats.laminate();
    const white = PublicMats.laminateWhite();

    // ------------------------------------------------------------ floors
    // the finish sits 12 mm proud of the slab (coplanar faces z-fight)
    this.group.add(mesh(metricUV(boxAt(L.x0, -0.02, L.z0, L.x1, 0.012, L.z1)), PublicMats.porcelain(), 'lobby-floor', false));

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
    wallX(zBack, 1, L.x0, sd.x0 - 0.25, H); // back, up to the cream around the stair door
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
      boxAt(L.x0, 0, L.z1 - 0.012, PLAN.door.x0, H, L.z1),
      boxAt(PLAN.door.x0, doorH + 0.05, L.z1 - 0.012, R.x0 - 0.34, H, L.z1),
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

    // ------------------------------------------------------------ the stair door
    // The back wall's right half is painted cream round the door (the stair's
    // own walls continue it), over a white kick; the door stands open, its
    // dark brown leaf swung out into the lobby on the left-hand jamb.
    const cream = PublicMats.corridorWall();
    const cx0 = sd.x0 - 0.25, fw = 0.06; // where the laminate stops; the casing's width
    this.group.add(mesh(merged([
      boxAt(cx0, 0, zBack, sd.x0 - fw, H, zBack + 0.012),
      boxAt(sd.x1 + fw, 0, zBack, L.x1, H, zBack + 0.012),
      boxAt(sd.x0 - fw, sd.h + fw, zBack, sd.x1 + fw, H, zBack + 0.012),
    ]), cream, 'lobby-back-cream', false));
    strips.push(boxAt(cx0, 0, zBack + 0.012, sd.x0 - fw, 0.08, zBack + 0.022), boxAt(sd.x1 + fw, 0, zBack + 0.012, L.x1, 0.08, zBack + 0.022));
    const casing: THREE.BufferGeometry[] = [
      boxAt(sd.x0 - fw, 0, zBack, sd.x0, sd.h + fw, zBack + 0.025),
      boxAt(sd.x1, 0, zBack, sd.x1 + fw, sd.h + fw, zBack + 0.025),
      boxAt(sd.x0, sd.h, zBack, sd.x1, sd.h + fw, zBack + 0.025),
      // the jamb linings through the wall
      boxAt(sd.x0, 0, zBack - 0.2, sd.x0 + 0.02, sd.h, zBack),
      boxAt(sd.x1 - 0.02, 0, zBack - 0.2, sd.x1, sd.h, zBack),
      boxAt(sd.x0, sd.h - 0.02, zBack - 0.2, sd.x1, sd.h, zBack),
    ];
    this.group.add(mesh(merged(casing), PublicMats.frame(), 'stair-door-casing'));
    const leafW = sd.x1 - sd.x0 - 0.04;
    const leaf = new THREE.Group();
    leaf.add(mesh(boxAt(0, 0.025, -0.04, leafW, sd.h - 0.01, 0), PublicMats.door(), 'stair-door-leaf'));
    // a lever handle on each face, near the free edge
    leaf.add(mesh(merged([
      boxAt(leafW - 0.09, 0.98, -0.1, leafW - 0.07, 1.0, 0.06),
      boxAt(leafW - 0.2, 0.975, 0.04, leafW - 0.07, 0.995, 0.06),
      boxAt(leafW - 0.2, 0.975, -0.1, leafW - 0.07, 0.995, -0.08),
    ]), PublicMats.stainless(), 'stair-door-lever', false));
    leaf.position.set(sd.x0 + 0.02, 0, zBack + 0.025);
    leaf.rotation.y = -0.58 * Math.PI; // open, past square to the wall
    leaf.name = 'stair-door';
    this.group.add(leaf);
    // the red WELCOME mat before it
    const mx = (sd.x0 + sd.x1) / 2;
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6).rotateX(-Math.PI / 2), PublicMats.print(welcomeMatTexture(), 'welcome-mat'));
    mat.position.set(mx, 0.02, zBack + 0.42);
    mat.name = 'welcome-mat';
    this.group.add(mat, mesh(boxAt(mx - 0.45, 0.012, zBack + 0.12, mx + 0.45, 0.019, zBack + 0.72), PublicMats.black(), 'welcome-mat-edge', false));
    // the no-smoking notice over the door's right-hand half
    const ns = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.25), PublicMats.print(noSmokingTexture(), 'no-smoking'));
    ns.position.set(sd.x1 - 0.2, sd.h + 0.32, zBack + 0.014);
    ns.name = 'sign-no-smoking';
    this.group.add(ns);

    // ------------------------------------------------------------ cabinet and canvas
    // the white display cabinet in the back corner, its two glass doors
    // closed on four shelves; the lavender canvas over it
    const kx0 = sd.x1 + 0.2, kx1 = L.x1 - 0.1, kz0 = zBack + 0.012, kz1 = zBack + 0.4, kh = 1.85;
    const body: THREE.BufferGeometry[] = [
      boxAt(kx0, 0, kz0, kx0 + 0.03, kh, kz1), boxAt(kx1 - 0.03, 0, kz0, kx1, kh, kz1),
      boxAt(kx0, kh - 0.04, kz0, kx1, kh, kz1), boxAt(kx0, 0, kz0, kx1, 0.1, kz1),
      boxAt(kx0, 0, kz0, kx1, kh, kz0 + 0.01),
      // the doors' frames and their meeting stiles
      boxAt(kx0, 0.1, kz1 - 0.02, kx1, 0.15, kz1), boxAt(kx0, kh - 0.09, kz1 - 0.02, kx1, kh - 0.04, kz1),
      boxAt((kx0 + kx1) / 2 - 0.03, 0.1, kz1 - 0.02, (kx0 + kx1) / 2 + 0.03, kh - 0.04, kz1),
    ];
    for (let k = 1; k <= 4; k++) body.push(boxAt(kx0 + 0.03, 0.1 + k * 0.33, kz0 + 0.01, kx1 - 0.03, 0.12 + k * 0.33, kz1 - 0.03));
    this.group.add(mesh(merged(body), PublicMats.white(), 'cabinet'));
    this.group.add(mesh(boxAt(kx0 + 0.03, 0.15, kz1 - 0.012, kx1 - 0.03, kh - 0.09, kz1 - 0.008), PublicMats.acrylic(), 'cabinet-glass', false));
    const canvasW = kx1 - kx0 + 0.05;
    const art = new THREE.Group();
    art.add(mesh(boxAt(-canvasW / 2, -0.24, -0.025, canvasW / 2, 0.24, 0), PublicMats.white(), 'canvas-edge', false));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(canvasW, 0.48), PublicMats.print(lavenderTexture(), 'lavender'));
    face.position.z = 0.001;
    art.add(face);
    art.position.set((kx0 + kx1) / 2, kh + 0.52, zBack + 0.037);
    art.name = 'art-lavender';
    this.group.add(art);

    // ------------------------------------------------------------ benches, rack, blossom
    // along the right-hand wall, a magazine rack between them; one more on
    // the back wall left of the stair door
    this.group.add(steelBench().translateX(L.x1 - 0.06).translateZ(-6.2));
    this.group.add(steelBench().translateX(L.x1 - 0.06).translateZ(-9.1));
    const backBench = steelBench();
    backBench.rotation.y = Math.PI / 2;
    backBench.position.set(sd.x0 - 1.25, 0, zBack + 0.06);
    this.group.add(backBench);
    this.group.add(magazineRack().translateX(L.x1 - 0.03).translateZ(-7.65));
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
    this.fill.position.set((L.x0 + L.x1) / 2, 1.6, -7.0); // 1.35 m under the ceiling: nearer, it hot-spots it
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

/** A floor-standing wire magazine rack against the wall (the wall at x = 0,
 *  the rack facing −x like the benches): four tiers, narrowing upwards, of
 *  magazines leaning back. */
function magazineRack(): THREE.Group {
  const g = new THREE.Group();
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const w = 0.22; // half its width along the wall
  const wire: THREE.BufferGeometry[] = [];
  const mags: THREE.BufferGeometry[] = [];
  for (const z of [-w, w]) wire.push(tube(v(-0.02, 0, z), v(-0.02, 1.3, z), 0.01), tube(v(-0.36, 0, z), v(-0.12, 1.3, z), 0.01));
  const covers = [0xf3f1ea, 0xd23b2f, 0x2f6fb5, 0xf2c230, 0x3c8f5a, 0xe9e4da, 0x8c2f5f];
  for (let k = 0, ci = 0; k < 4; k++) {
    const y = 0.16 + k * 0.3, xf = -0.33 + k * 0.055;
    wire.push(tube(v(xf, y, -w), v(xf, y, w), 0.006), tube(v(xf, y + 0.07, -w), v(xf, y + 0.07, w), 0.006));
    for (const z of [-w, w]) wire.push(tube(v(xf, y, z), v(-0.02, y + 0.05, z), 0.006));
    for (let j = 0; j < 3; j++) {
      const m = boxAt(-0.005, 0, -0.07, 0.005, 0.27, 0.07).rotateZ(-0.27);
      m.translate(xf + 0.03, y + 0.005, -0.145 + j * 0.145);
      mags.push(paint(m, covers[ci++ % covers.length]));
    }
  }
  g.add(mesh(merged(wire), PublicMats.stainless(), 'rack', false));
  g.add(mesh(mergeAll(mags, ['position', 'normal', 'color']), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 }), 'magazines', false));
  g.name = 'magazine-rack';
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
