// Lobby (the entrance lot, ground floor; brief §4.4), from the owner's photos
// of the reception (2026-10-02) and walk-through video (2026-10-12), laid out
// as the owner placed it (2026-10-13): the reception on the right as you come
// in, the stair door on the left, the benches along the back:
//   · light cream 600 mm polished porcelain, a flat white ceiling with
//     recessed downlights and a CCTV camera;
//   · walls of striated grey-brown laminate in tall panels between thin white
//     strips, with a laminate door in the right-hand wall behind the reception;
//   · the reception: an alcove in the right-hand wall beside the entrance —
//     white laminate pillars, a laminate bulkhead between white bands, the
//     painted mural of Malaysia on its back wall (the party wall) and the
//     black granite-topped counter across its mouth (ReservationCounter);
//   · three-seat stainless benches along the back wall either side of a wire
//     magazine rack; artificial cherry blossom by the reception's front
//     pillar; plain notices on the pillars (the photos' third-party badges
//     and stickers are not reproduced);
//   · the left-hand wall's cream back half: the stair door at the top of
//     four steps (Corridor.ts), a red WELCOME mat at their foot, the
//     no-smoking notice beside its head, and the white glass cabinet beside
//     the steps under a lavender canvas.
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
const PILLAR = 0.34; // the reception's pillars, front to back
const BENCH = 3 * 0.56 + 0.1; // a three-seat bench's length (steelBench)

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
    const pz1 = R.z1 - PILLAR; // the reception's rear pillar, its back face
    const creamZ = -6.6; // the left-hand wall: laminate in front of this, cream behind
    const creamX = L.x0 + 1.0; // … and the cream turns the corner onto the back wall this far
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
    wallZ(L.x0, 1, creamZ, L.z1 - 0.02, H); // left, from the entrance to the cream round the stair door
    wallZ(L.x1, -1, zBack, pz1, H); // right, from the back to the reception's rear pillar
    wallX(zBack, 1, creamX, L.x1, H); // back, behind the benches
    // the right-hand wall's door (back office), just behind the reception: a
    // laminate leaf with a narrow frosted strip and a steel pull, in a white frame
    const dz0 = pz1 - 0.22, dz1 = dz0 - 0.92;
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

    // the frontage's inner face: left of, above and right of the entrance door
    this.group.add(mesh(merged([
      boxAt(L.x0, 0, L.z1 - 0.012, PLAN.door.x0, H, L.z1),
      boxAt(PLAN.door.x0, doorH + 0.05, L.z1 - 0.012, PLAN.door.x1, H, L.z1),
      boxAt(PLAN.door.x1, 0, L.z1 - 0.012, R.x0, H, L.z1),
    ]), PublicMats.plaster(), 'lobby-front-inner', false));

    // ------------------------------------------------------------ reception alcove
    // pillars, floor to ceiling: the front one against the frontage, the rear
    // one between the alcove and the office door
    const pillars = [boxAt(R.x0, 0, R.z0, R.x1, H, L.z1), boxAt(R.x0, 0, pz1, R.x1, H, R.z1)];
    // the volume above the alcove: soffit, and the bulkhead's face in bands —
    // white, striated laminate, white again up to the ceiling
    const soffit = boxAt(R.x0, R.soffit, R.z1, R.x1, R.soffit + 0.05, R.z0);
    const bandX0 = R.x0 - 0.02, bandX1 = R.x0;
    const bands = [
      boxAt(bandX0, R.soffit, pz1, bandX1, R.soffit + 0.09, L.z1),
      boxAt(bandX0, R.soffit + 0.6, pz1, bandX1, H, L.z1),
    ];
    lam.push(boxAt(bandX0 + 0.004, R.soffit + 0.09, pz1, bandX1, R.soffit + 0.6, L.z1));
    this.group.add(mesh(merged([...pillars, ...bands]), white, 'reception-pillars'));
    this.group.add(mesh(soffit, PublicMats.ceiling(), 'reception-soffit', false));
    // the mural on the party wall, from just behind the counter up to the
    // soffit; its texture runs 0.23 m further down (behind the counter)
    const muralH = R.soffit - 0.67;
    const mural = new THREE.Mesh(new THREE.PlaneGeometry(R.z0 - R.z1, muralH), PublicMats.mural());
    const uv = mural.geometry.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 0.05 + uv.getX(i) * 0.9); // 5 % trimmed each side
    mural.rotation.y = -Math.PI / 2; // facing across the lobby (−x)
    mural.position.set(R.x1 - 0.004, 0.67 + muralH / 2, (R.z0 + R.z1) / 2);
    mural.name = 'reception-mural';
    mural.receiveShadow = true;
    this.group.add(mural);
    // the wall under the mural, behind the counter
    this.group.add(mesh(boxAt(R.x1 - 0.012, 0, R.z1, R.x1, 0.67, R.z0), PublicMats.plaster(), 'reception-wall', false));
    // soffit fittings: a downlight, the CCTV dome and the air-conditioning slot
    const downDisc = new THREE.CircleGeometry(0.065, 24).rotateX(Math.PI / 2);
    const discMat = PublicMats.emissive(LIGHT, 3.0, 'downlight');
    this.lit.push(discMat);
    const alcoveLight = new THREE.Mesh(downDisc, discMat);
    alcoveLight.position.set((R.x0 + R.x1) / 2, R.soffit - 0.002, R.z0 - 0.6);
    this.group.add(alcoveLight);
    this.group.add(cctvDome().translateX(R.x0 + 0.35).translateY(R.soffit).translateZ(R.z1 + 0.35));
    const ac = new THREE.Group();
    ac.add(mesh(boxAt(-0.42, -0.012, -0.1, 0.42, 0, 0.1), PublicMats.white(), 'ac-face', false));
    ac.add(mesh(boxAt(-0.38, -0.014, -0.03, 0.38, -0.011, 0.03), PublicMats.black(), 'ac-slot', false));
    ac.rotation.y = Math.PI / 2; // its slot along the alcove
    ac.position.set(R.x0 + 0.42, R.soffit, R.z0 - 1.25);
    this.group.add(ac);
    // plain notices taped to the pillars' faces (the photos' rating badges
    // and payment stickers are third-party marks, not reproduced)
    const notice = (z: number, y: number, w: number, seed: number) => {
      const n = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 1.375), PublicMats.print(noticeTexture(seed), `notice-${seed}`));
      n.rotation.y = -Math.PI / 2;
      n.position.set(R.x0 - 0.003, y, z);
      n.name = 'notice';
      this.group.add(n);
    };
    notice(R.z1 - PILLAR / 2, 1.75, 0.2, 11);
    notice(R.z1 - PILLAR / 2, 1.38, 0.2, 12);
    notice(R.z0 + PILLAR / 2, 1.82, 0.24, 13);

    // ------------------------------------------------------------ ceiling lights, CCTV
    const scallop = PublicMats.glow(scallopWash(), 0xffe0bc, 0.42, 'scallop');
    this.lit.push(scallop);
    const doorZ = (sd.z0 + sd.z1) / 2;
    for (const z of [-4.3, -6.5, -8.7, -10.9]) {
      for (const x of [L.x0 + 1.0, L.x1 - 1.0]) {
        if (x > R.x0 - 0.2 && z > pz1 - 0.3) continue; // over the reception's soffit
        const d = new THREE.Mesh(downDisc, discMat);
        d.position.set(x, H - 0.002, z);
        this.group.add(d);
      }
      // each side wall takes a soft scallop from its nearer light
      for (const [x, rot] of [[L.x0 + 0.025, Math.PI / 2], [L.x1 - 0.025, -Math.PI / 2]] as const) {
        if (x < L.x0 + 0.1 && Math.abs(z - doorZ) < 1.2) continue; // not over the stair door
        if (x > L.x1 - 0.1 && z > dz1 - 0.6) continue; // nor the office door and the reception
        const sc = wash(1.3, 2.6, scallop, 'scallop');
        sc.rotation.y = rot;
        sc.position.set(x, H - 1.3, z);
        this.group.add(sc);
      }
    }
    this.group.add(cctvBullet().translateX(L.x1 - 0.12).translateY(H - 0.02).translateZ(pz1 - 0.12));

    // ------------------------------------------------------------ the stair door
    // The left-hand wall's back half is painted cream round the door, and
    // the cream turns the corner onto the back wall, over a white kick. The
    // four steps up to the door, its casing and its leaf (open into the
    // landing) are the stair's (Corridor.ts); the lobby keeps the WELCOME
    // mat at their foot and the no-smoking notice beside the door's head.
    const cream = PublicMats.corridorWall();
    const fw = 0.06; // the stair door's casing width
    const sill = PLAN.stair.entry.risers * PLAN.stair.rise, headY = sill + sd.h + fw;
    this.group.add(mesh(merged([
      boxAt(L.x0, 0, sd.z0 + fw, L.x0 + 0.012, H, creamZ),
      boxAt(L.x0, 0, zBack, L.x0 + 0.012, H, sd.z1 - fw),
      boxAt(L.x0, headY, sd.z1 - fw, L.x0 + 0.012, H, sd.z0 + fw),
      boxAt(L.x0 + 0.012, 0, zBack, creamX, H, zBack + 0.012),
    ]), cream, 'lobby-cream', false));
    strips.push(
      boxAt(L.x0 + 0.012, 0, sd.z0 + fw, L.x0 + 0.022, 0.08, creamZ),
      boxAt(L.x0 + 0.012, 0, zBack + 0.012, L.x0 + 0.022, 0.08, sd.z1 - fw),
      boxAt(L.x0 + 0.022, 0, zBack + 0.012, creamX, 0.08, zBack + 0.022),
    );
    // the red WELCOME mat at the foot of the steps, reading from the lobby
    const ez = (PLAN.stair.entry.z0 + PLAN.stair.entry.z1) / 2, mx = L.x0 + PLAN.stair.entry.risers * PLAN.stair.entry.run + 0.35;
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6).rotateX(-Math.PI / 2).rotateY(Math.PI / 2), PublicMats.print(welcomeMatTexture(), 'welcome-mat'));
    mat.position.set(mx, 0.02, ez);
    mat.name = 'welcome-mat';
    this.group.add(mat, mesh(boxAt(mx - 0.3, 0.012, ez - 0.45, mx + 0.3, 0.019, ez + 0.45), PublicMats.black(), 'welcome-mat-edge', false));
    // the no-smoking notice beside the door's head, between it and the canvas
    const ns = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.25), PublicMats.print(noSmokingTexture(), 'no-smoking'));
    ns.rotation.y = Math.PI / 2;
    ns.position.set(L.x0 + 0.014, headY - 0.26, sd.z1 - fw - 0.16);
    ns.name = 'sign-no-smoking';
    this.group.add(ns);

    // ------------------------------------------------------------ cabinet and canvas
    // the white display cabinet beside the steps, behind the stair door, its
    // two glass doors closed on four shelves; the lavender canvas over it.
    // Built facing +z with the wall at z = 0, then turned onto the left-hand wall.
    const kw = 0.7, kx0 = -kw / 2, kx1 = kw / 2, kz0 = 0.012, kz1 = 0.4, kh = 1.85;
    const body: THREE.BufferGeometry[] = [
      boxAt(kx0, 0, kz0, kx0 + 0.03, kh, kz1), boxAt(kx1 - 0.03, 0, kz0, kx1, kh, kz1),
      boxAt(kx0, kh - 0.04, kz0, kx1, kh, kz1), boxAt(kx0, 0, kz0, kx1, 0.1, kz1),
      boxAt(kx0, 0, kz0, kx1, kh, kz0 + 0.01),
      // the doors' frames and their meeting stiles
      boxAt(kx0, 0.1, kz1 - 0.02, kx1, 0.15, kz1), boxAt(kx0, kh - 0.09, kz1 - 0.02, kx1, kh - 0.04, kz1),
      boxAt(-0.03, 0.1, kz1 - 0.02, 0.03, kh - 0.04, kz1),
    ];
    for (let k = 1; k <= 4; k++) body.push(boxAt(kx0 + 0.03, 0.1 + k * 0.33, kz0 + 0.01, kx1 - 0.03, 0.12 + k * 0.33, kz1 - 0.03));
    const cabinet = new THREE.Group();
    cabinet.add(mesh(merged(body), PublicMats.white(), 'cabinet'));
    cabinet.add(mesh(boxAt(kx0 + 0.03, 0.15, kz1 - 0.012, kx1 - 0.03, kh - 0.09, kz1 - 0.008), PublicMats.acrylic(), 'cabinet-glass', false));
    const canvasW = kw + 0.05;
    const art = new THREE.Group();
    art.add(mesh(boxAt(-canvasW / 2, -0.24, -0.025, canvasW / 2, 0.24, 0), PublicMats.white(), 'canvas-edge', false));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(canvasW, 0.48), PublicMats.print(lavenderTexture(), 'lavender'));
    face.position.z = 0.001;
    art.add(face);
    art.position.set(0, kh + 0.52, 0.037);
    art.name = 'art-lavender';
    cabinet.add(art);
    cabinet.rotation.y = Math.PI / 2; // facing +x; its local x runs towards −z
    cabinet.position.set(L.x0, 0, PLAN.stair.entry.z1 - 0.25 - kw / 2);
    cabinet.name = 'cabinet';
    this.group.add(cabinet);

    // ------------------------------------------------------------ benches, rack, blossom
    // along the back wall, a magazine rack between them; the blossom by the
    // reception
    const bx1 = L.x1 - 0.36 - BENCH / 2, rackX = bx1 - BENCH / 2 - 0.35, bx0 = rackX - 0.35 - BENCH / 2;
    const onBack = (o: THREE.Object3D, x: number, off: number) => {
      o.rotation.y = Math.PI / 2; // facing +z, into the lobby
      o.position.set(x, 0, zBack + off);
      this.group.add(o);
    };
    onBack(steelBench(), bx0, 0.06);
    onBack(magazineRack(), rackX, 0.03);
    onBack(steelBench(), bx1, 0.06);
    this.group.add(blossom().translateX(R.x0 - 0.3).translateZ(L.z1 - 0.32));

    this.group.add(mesh(merged(lam), laminate, 'lobby-laminate'));
    this.group.add(mesh(merged(strips), white, 'lobby-strips', false));

    // ------------------------------------------------------------ lights
    // an accent downlight in front of the alcove, raking the counter and the
    // mural; a soft fill at head height in the middle of the room
    const rz = (R.z0 + R.z1) / 2;
    this.spot = new THREE.SpotLight(LIGHT, 0, 9, 0.7, 0.75, 1.4);
    this.spot.position.set(R.x0 - 1.1, H - 0.06, rz);
    this.spot.target.position.set(R.x1 - 0.2, 0.9, rz);
    const accent = new THREE.Mesh(downDisc, discMat);
    accent.position.set(R.x0 - 1.1, H - 0.004, rz);
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

/** A three-seat stainless bench against a wall at x = 0, seats facing −x
 *  (BENCH long): slatted seats and backs on a steel beam, armrests at the ends. */
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
