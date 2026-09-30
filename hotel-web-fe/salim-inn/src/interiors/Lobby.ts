// Lobby (the entrance lot, ground floor; brief §4.4). No reception photo
// exists, so the room is designed from the entrance frames and flagged:
//   · polished 800 mm porcelain floor, warm plaster walls, walnut skirting;
//   · a tray ceiling: a drop band round the edge with downlights that throw
//     scallops down the side walls, and a warm LED cove in the recess;
//   · the wall behind the counter in the facade's stacked stone, with backlit
//     3D SALIM INN letters (red on warm stone), a clock on Sibu time and a
//     small key-card rack;
//   · a pendant pair over the counter (2,800 K), a seating corner with a
//     practical table lamp, and two plants.
// Lighting is two real lights (a spot on the counter, a soft fill); the cove,
// scallops, halo and lamp are emissive surfaces and additive washes.
import * as THREE from 'three';
import { PLAN } from '../world/SalimInnBuilding';
import { batchPlain, boxAt, mergeStatic, metricUV, rbox } from '../world/geom';
import { buildText } from '../world/letters';
import { ReservationCounter } from './ReservationCounter';
import { clockFace, glowTexture, haloTexture, PublicMats, scallopWash, stripWash } from './lobbyMaterials';
import { RoomMats } from './roomMaterials';

const WARM = 0xffc58a; // ≈ 2,800 K
const BAND = 0.55; // ceiling drop band width
const BAND_Y = 3.12; // its underside

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
  private letters: THREE.Mesh;
  private lit: THREE.Material[] = []; // emissive / additive materials that follow the lights
  private litBase = new Map<THREE.Material, THREE.Color>();
  private clock: { hour: THREE.Object3D; minute: THREE.Object3D; second: THREE.Object3D };

  /** `counter` may be built first (World builds the interior in slices). */
  constructor(counter: ReservationCounter = new ReservationCounter(), merge = true) {
    this.counter = counter;
    const L = PLAN.lobby;
    const c = PLAN.counter;
    const H = PLAN.lobbyCeiling;
    const zBack = L.z0; // face of the back wall
    const xBackR = PLAN.stair.x0 - 0.2; // the back wall ends at the stair core's side wall

    // ------------------------------------------------------------ floor, walls, skirting
    // the finish sits 12 mm proud of the slab (coplanar faces z-fight)
    this.group.add(mesh(metricUV(boxAt(L.x0, -0.02, L.z0, L.x1, 0.012, L.z1)), PublicMats.porcelain(), 'lobby-floor', false));
    // and under the stair core behind it
    this.group.add(mesh(metricUV(boxAt(PLAN.stair.x0, -0.02, PLAN.stair.z0, PLAN.stair.x1, 0.012, PLAN.stair.z1)), PublicMats.porcelain(), 'stair-floor', false));
    const plaster = PublicMats.plaster();
    this.group.add(
      mesh(boxAt(L.x0, 0, L.z0, L.x0 + 0.01, BAND_Y, L.z1 - 0.2), plaster, 'lobby-wall-left'),
      mesh(boxAt(L.x1 - 0.01, 0, PLAN.stair.z1, L.x1, BAND_Y, L.z1 - 0.2), plaster, 'lobby-wall-right'),
    );
    const skirt = PublicMats.walnut();
    this.group.add(
      mesh(boxAt(L.x0 + 0.01, 0.012, L.z0, L.x0 + 0.025, 0.1, L.z1 - 0.2), skirt, 'skirt-left', false),
      mesh(boxAt(L.x1 - 0.025, 0.012, PLAN.stair.z1, L.x1 - 0.01, 0.1, L.z1 - 0.2), skirt, 'skirt-right', false),
    );

    // ------------------------------------------------------------ feature wall: stone, letters, clock, rack
    this.group.add(mesh(metricUV(boxAt(L.x0 + 0.01, 0, zBack, xBackR, BAND_Y, zBack + 0.06)), PublicMats.stone(), 'feature-stone'));
    this.group.add(mesh(boxAt(L.x0 + 0.01, 0.012, zBack + 0.06, xBackR, 0.1, zBack + 0.075), skirt, 'skirt-back', false));
    const wallZ = zBack + 0.06;
    const CAP = 0.26;
    const text = buildText('SALIM INN', { size: CAP, weight: 0.21, depth: 0.045, case: 'upper', tracking: 0.07 });
    const letterBase = 2.1;
    text.geo.translate(c.x - text.width / 2, letterBase, wallZ + 0.04);
    this.letters = mesh(text.geo, PublicMats.signRed(), 'lobby-letters');
    this.group.add(this.letters);
    const haloMat = PublicMats.glow(haloTexture('SALIM INN'), 0xffc4a0, 3.2, 'halo');
    const halo = wash(text.width * 1.22, CAP * 2.6, haloMat, 'letters-halo');
    halo.position.set(c.x, letterBase + CAP / 2, wallZ + 0.004);
    this.group.add(halo);
    this.lit.push(haloMat);

    // clock (Sibu keeps UTC+8 all year), left of the letters
    const clock = new THREE.Group();
    clock.add(new THREE.Mesh(new THREE.CircleGeometry(0.17, 48), new THREE.MeshStandardMaterial({ map: clockFace(), roughness: 0.5 })));
    clock.add(mesh(new THREE.TorusGeometry(0.176, 0.012, 10, 64), PublicMats.brass(), 'clock-rim', false));
    const hand = (len: number, w: number, m: THREE.Material, z: number) => {
      const pivot = new THREE.Group();
      pivot.add(new THREE.Mesh(boxAt(-w / 2, -len * 0.18, z, w / 2, len, z + 0.003), m));
      clock.add(pivot);
      return pivot;
    };
    const ink = PublicMats.black();
    this.clock = { hour: hand(0.095, 0.014, ink, 0.004), minute: hand(0.14, 0.009, ink, 0.008), second: hand(0.15, 0.003, new THREE.MeshStandardMaterial({ color: 0xb0282c, roughness: 0.4 }), 0.012) };
    clock.position.set(L.x0 + 0.4, letterBase + CAP / 2, wallZ + 0.015);
    this.group.add(clock);

    // key-card rack: a walnut pigeonhole box, some slots holding cards
    const rack = new THREE.Group();
    const rw = 0.34, rh = 0.42, rd = 0.07;
    rack.add(mesh(boxAt(-rw / 2, 0, 0, rw / 2, rh, 0.01), PublicMats.walnut(), 'rack-back'));
    const dividers: THREE.BufferGeometry[] = [];
    for (let i = 0; i <= 3; i++) dividers.push(boxAt(-rw / 2 + (i * rw) / 3 - 0.006, 0, 0, -rw / 2 + (i * rw) / 3 + 0.006, rh, rd));
    for (let j = 0; j <= 4; j++) dividers.push(boxAt(-rw / 2, (j * rh) / 4 - 0.006, 0, rw / 2, (j * rh) / 4 + 0.006, rd));
    for (const d of dividers) rack.add(mesh(d, PublicMats.walnut(), 'rack-divider'));
    const keyMat = new THREE.MeshStandardMaterial({ color: 0x1f4436, roughness: 0.35 });
    for (const [i, j] of [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2], [1, 3], [2, 3]]) {
      const x = -rw / 2 + ((i + 0.5) * rw) / 3, y = (j * rh) / 4 + 0.012;
      rack.add(mesh(boxAt(x - 0.043, y, 0.02, x + 0.043, y + 0.07, 0.022), keyMat, 'rack-card', false));
    }
    rack.position.set(xBackR - 0.35, 1.18, wallZ);
    this.group.add(rack);

    // ------------------------------------------------------------ tray ceiling, cove, downlights, scallops
    const ceil = PublicMats.ceiling();
    const bx0 = L.x0, bx1 = L.x1, bz0 = zBack + 0.06, bz1 = L.z1 - 0.2;
    // the band stops 10 cm short of the recess ceiling: the cove slot
    const top = H - 0.1;
    const ix0 = bx0 + BAND, ix1 = bx1 - BAND, iz0 = bz0 + BAND, iz1 = bz1 - BAND;
    for (const g of [
      boxAt(bx0, BAND_Y, bz0, bx1, top, iz0), boxAt(bx0, BAND_Y, iz1, bx1, top, bz1),
      boxAt(bx0, BAND_Y, iz0, ix0, top, iz1), boxAt(ix1, BAND_Y, iz0, bx1, top, iz1),
      // lips hiding the LED strips
      boxAt(ix0 - 0.015, top, iz0 - 0.015, ix1 + 0.015, top + 0.045, iz0), boxAt(ix0 - 0.015, top, iz1, ix1 + 0.015, top + 0.045, iz1 + 0.015),
      boxAt(ix0 - 0.015, top, iz0, ix0, top + 0.045, iz1), boxAt(ix1, top, iz0, ix1 + 0.015, top + 0.045, iz1),
      // the band's outer edge meets the walls up to the slab
      boxAt(bx0, top, bz0, bx1, H, bz0 + 0.02), boxAt(bx0, top, bz1 - 0.02, bx1, H, bz1),
      boxAt(bx0, top, bz0, bx0 + 0.02, H, bz1), boxAt(bx1 - 0.02, top, bz0, bx1, H, bz1),
    ]) this.group.add(mesh(g, ceil, 'ceiling-band', false));
    // LED strip along the inner top edge of the band, and its wash on the recess
    const cove = PublicMats.emissive(0xffd3a0, 2.6, 'cove');
    this.lit.push(cove);
    const coveWash = PublicMats.glow(stripWash(), 0xffe2c2, 0.55, 'coveWash');
    this.lit.push(coveWash);
    // [strip centre x, z, length, along x?, wash rotation]: the wash lies on
    // the recess ceiling, brightest at the strip and fading inwards
    const xc = (ix0 + ix1) / 2, zc = (iz0 + iz1) / 2;
    const strips: [number, number, number, boolean, number, number, number][] = [
      [xc, iz0 + 0.03, ix1 - ix0, true, Math.PI, xc, iz0 + 0.45],
      [xc, iz1 - 0.03, ix1 - ix0, true, 0, xc, iz1 - 0.45],
      [ix0 + 0.03, zc, iz1 - iz0, false, Math.PI / 2, ix0 + 0.45, zc],
      [ix1 - 0.03, zc, iz1 - iz0, false, -Math.PI / 2, ix1 - 0.45, zc],
    ];
    for (const [x, z, len, alongX, rot, wx, wz] of strips) {
      const led = mesh(alongX ? boxAt(-len / 2, 0, -0.01, len / 2, 0.02, 0.01) : boxAt(-0.01, 0, -len / 2, 0.01, 0.02, len / 2), cove, 'cove-led', false);
      led.position.set(x, top + 0.005, z);
      const w = wash(len, 0.9, coveWash, 'cove-wash');
      w.rotation.set(Math.PI / 2, 0, rot);
      w.position.set(wx, H - 0.006, wz);
      this.group.add(led, w);
    }
    // downlights in the band, each throwing a scallop down its wall
    const disc = new THREE.CircleGeometry(0.06, 24).rotateX(Math.PI / 2);
    const discMat = PublicMats.emissive(WARM, 3.2, 'downlight');
    this.lit.push(discMat);
    const scallop = PublicMats.glow(scallopWash(), 0xffd2a0, 0.5, 'scallop');
    this.lit.push(scallop);
    const downlight = (x: number, z: number, wx: number, wz: number, rotY: number) => {
      const d = new THREE.Mesh(disc, discMat);
      d.position.set(x, BAND_Y - 0.002, z);
      const sc = wash(1.1, 2.3, scallop, 'scallop');
      sc.rotation.y = rotY;
      sc.position.set(wx, BAND_Y - 1.15, wz);
      this.group.add(d, sc);
    };
    for (const z of [-3.6, -5.2, -6.8, -8.4, -10.0]) {
      downlight(bx0 + 0.3, z, bx0 + 0.012, z, Math.PI / 2);
      downlight(bx1 - 0.3, z, bx1 - 0.012, z, -Math.PI / 2);
    }
    // two grazing the stone behind the counter, over the clock and the rack
    downlight(L.x0 + 0.4, bz0 + 0.28, L.x0 + 0.4, wallZ + 0.006, 0);
    downlight(xBackR - 0.35, bz0 + 0.28, xBackR - 0.35, wallZ + 0.006, 0);

    // ------------------------------------------------------------ pendant pair over the counter
    const outer = PublicMats.darkMetal();
    const inner = new THREE.MeshStandardMaterial({ color: 0xd9b572, roughness: 0.3, metalness: 1, side: THREE.BackSide });
    const bulbMat = PublicMats.emissive(0xffd6a4, 5, 'bulb');
    this.lit.push(bulbMat);
    const glowMat = PublicMats.glow(glowTexture(), 0xffc890, 1.1, 'pendantGlow');
    this.lit.push(glowMat);
    const domeProfile: THREE.Vector2[] = [];
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * (Math.PI / 2);
      domeProfile.push(new THREE.Vector2(0.03 + 0.19 * Math.sin(a), 0.17 * Math.cos(a)));
    }
    const pendantY = 2.28;
    for (const dx of [-0.62, 0.62]) {
      const p = new THREE.Group();
      p.add(mesh(new THREE.LatheGeometry(domeProfile.slice().reverse(), 40), outer, 'pendant-shade'));
      p.add(new THREE.Mesh(new THREE.LatheGeometry(domeProfile.slice().reverse().map((v) => new THREE.Vector2(v.x - 0.004, v.y)), 40), inner));
      p.add(new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 10).translate(0, 0.05, 0), bulbMat));
      const g = wash(0.5, 0.5, glowMat, 'pendant-glow');
      g.rotation.x = Math.PI / 2; // facing down
      g.position.y = 0.012;
      p.add(g);
      p.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, H - pendantY - 0.17, 6).translate(0, 0.17 + (H - pendantY - 0.17) / 2, 0), outer, 'pendant-cord', false));
      p.position.set(c.x + dx, pendantY, c.z + 0.2);
      this.group.add(p);
    }

    // ------------------------------------------------------------ seating corner, lamp, plants, art
    const velvet = new THREE.MeshPhysicalMaterial({ color: 0x1f4a3b, roughness: 0.85, sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(0x5f8f7a) });
    const sofa = new THREE.Group();
    const sw = 1.6, sd = 0.82;
    sofa.add(mesh(rbox(0, 0.12, -sw / 2, sd, 0.42, sw / 2, 0.06), velvet, 'sofa-base'));
    sofa.add(mesh(rbox(0, 0.42, -sw / 2 + 0.16, 0.2, 0.86, sw / 2 - 0.16, 0.07), velvet, 'sofa-back'));
    for (const s of [-1, 1]) sofa.add(mesh(rbox(0, 0.12, s * (sw / 2) - (s > 0 ? 0.16 : 0), sd, 0.64, s * (sw / 2) + (s > 0 ? 0 : 0.16), 0.06), velvet, 'sofa-arm'));
    for (const s of [-1, 1]) sofa.add(mesh(rbox(0.2, 0.42, s > 0 ? 0.01 : -sw / 2 + 0.16, sd - 0.03, 0.54, s > 0 ? sw / 2 - 0.16 : -0.01, 0.05), velvet, 'sofa-cushion'));
    for (const [x, z] of [[0.06, -sw / 2 + 0.06], [0.06, sw / 2 - 0.06], [sd - 0.06, -sw / 2 + 0.06], [sd - 0.06, sw / 2 - 0.06]]) {
      sofa.add(mesh(new THREE.CylinderGeometry(0.018, 0.012, 0.12, 10).translate(x, 0.06, z), PublicMats.brass(), 'sofa-leg'));
    }
    sofa.position.set(L.x0 + 0.06, 0, -6.0);
    this.group.add(sofa);
    // side table + practical lamp beside it
    const table = new THREE.Group();
    table.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.025, 36).translate(0, 0.56, 0), PublicMats.marble(), 'table-top'));
    table.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.55, 12).translate(0, 0.275, 0), PublicMats.brass(), 'table-stem'));
    table.add(mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.012, 32).translate(0, 0.006, 0), PublicMats.brass(), 'table-foot'));
    table.add(mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.24, 24).translate(0, 0.69, 0), new THREE.MeshPhysicalMaterial({ color: 0xe9e2d4, roughness: 0.2, clearcoat: 0.8 }), 'lamp-base'));
    const shadeMat = new THREE.MeshStandardMaterial({ color: 0xf2e6d0, emissive: new THREE.Color(0xffc98e), emissiveIntensity: 0, roughness: 0.9, side: THREE.DoubleSide });
    this.lit.push(shadeMat);
    table.add(mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.2, 32, 1, true).translate(0, 0.92, 0), shadeMat, 'lamp-shade', false));
    const lampGlow = PublicMats.glow(glowTexture(), 0xffc790, 0.6, 'lampGlow');
    this.lit.push(lampGlow);
    const lg = wash(1.3, 1.3, lampGlow, 'lamp-wall-glow');
    lg.rotation.y = Math.PI / 2;
    lg.position.set(-0.32, 0.95, 0); // on the wall behind the lamp
    table.add(lg);
    table.position.set(L.x0 + 0.34, 0, -7.1);
    this.group.add(table);
    // plants: a tall one by the counter, one at the stair approach
    const plantAt = (x: number, z: number, h: number, seed: number) => this.group.add(tallPlant(h, seed).translateX(x).translateZ(z));
    plantAt(L.x0 + 0.42, zBack + 0.55, 1.7, 1);
    plantAt(L.x1 - 0.42, -8.7, 1.5, 2);
    // gold-leaf art on the right wall (the rooms' motif, larger)
    const art = new THREE.Group();
    art.add(mesh(boxAt(-0.012, -0.55, -0.42, 0, 0.55, 0.42), PublicMats.brass(), 'art-frame', false));
    art.add(mesh(boxAt(-0.016, -0.53, -0.4, -0.012, 0.53, 0.4), new THREE.MeshStandardMaterial({ color: 0xf1ebe0, roughness: 0.9 }), 'art-mount', false));
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.93), RoomMats.goldLeaf('banana'));
    leaf.rotation.y = -Math.PI / 2;
    leaf.position.x = -0.02;
    art.add(leaf);
    art.position.set(L.x1 - 0.012, 1.65, -5.6);
    this.group.add(art);

    // ------------------------------------------------------------ lights
    // an accent downlight in the recess in front of the counter: it lights the
    // ledge and props and rakes the fluted front (straight overhead it only
    // grazed the front, which fell to a murky purple under the grade)
    this.spot = new THREE.SpotLight(WARM, 0, 8, 0.62, 0.75, 1.4);
    this.spot.position.set(c.x, H - 0.06, c.z + 1.55);
    this.spot.target.position.set(c.x, 0.55, c.z + 0.25);
    const accent = new THREE.Mesh(disc, discMat);
    accent.position.set(c.x, H - 0.004, c.z + 1.55);
    this.group.add(accent);
    // soft fill at head height: far enough below the ceiling not to hot-spot it
    // (a spot's cone edge drew a hard ellipse on the side walls)
    this.fill = new THREE.PointLight(0xffd7ae, 0, 12, 1.6);
    this.fill.position.set((L.x0 + L.x1) / 2, 2.0, -6.2);
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
    const moving = [...this.counter.dynamic, this.clock.hour, this.clock.minute, this.clock.second];
    batchPlain(this.group, moving);
    mergeStatic(this.group, moving);
  }

  setLights(v: number): void {
    this.spot.intensity = 26 * v;
    this.fill.intensity = 4.5 * v;
    for (const m of this.lit) {
      if ((m as THREE.MeshStandardMaterial).emissiveIntensity !== undefined && !(m as THREE.MeshBasicMaterial).isMeshBasicMaterial) {
        (m as THREE.MeshStandardMaterial).emissiveIntensity = 1.4 * v;
        continue;
      }
      const base = this.litBase.get(m);
      if (base) (m as THREE.MeshBasicMaterial).color.copy(base).multiplyScalar(v);
    }
    const letters = this.letters.material as THREE.MeshStandardMaterial;
    letters.emissiveIntensity = 0.35 * v;
  }

  /** Clock hands on Sibu time (UTC+8, no daylight saving). */
  update(): void {
    const t = (Date.now() / 1000 + 8 * 3600) % 86400;
    this.clock.second.rotation.z = -((t % 60) / 60) * Math.PI * 2;
    this.clock.minute.rotation.z = -((t % 3600) / 3600) * Math.PI * 2;
    this.clock.hour.rotation.z = -((t % 43200) / 43200) * Math.PI * 2;
  }
}

/** A tall potted plant: a ceramic planter and broad leaves on thin stems. */
function tallPlant(h: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  const pot = [new THREE.Vector2(0, 0), new THREE.Vector2(0.2, 0), new THREE.Vector2(0.25, 0.45), new THREE.Vector2(0.235, 0.45), new THREE.Vector2(0.23, 0.42), new THREE.Vector2(0, 0.42)];
  g.add(mesh(new THREE.LatheGeometry(pot, 40), new THREE.MeshPhysicalMaterial({ color: 0x2c2f2d, roughness: 0.35, clearcoat: 0.5 }), 'planter'));
  const leafGeo = new THREE.SphereGeometry(1, 12, 6).scale(0.09, 0.012, 0.16).translate(0, 0, 0.15);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3c6b35, roughness: 0.55, side: THREE.DoubleSide });
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x5a4a32, roughness: 0.8 });
  let s = seed * 9301 + 49297;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 26; i++) {
    const y = 0.5 + (h - 0.5) * Math.pow(i / 26, 0.8);
    const lf = new THREE.Mesh(leafGeo, leafMat);
    lf.rotation.order = 'YXZ';
    lf.rotation.y = r() * Math.PI * 2;
    lf.rotation.x = -0.2 - r() * 0.7;
    lf.scale.setScalar(0.75 + r() * 0.5);
    lf.position.set((r() - 0.5) * 0.18, y, (r() - 0.5) * 0.18);
    lf.castShadow = true;
    g.add(lf);
  }
  g.add(mesh(new THREE.CylinderGeometry(0.012, 0.018, h - 0.4, 6).translate(0, 0.42 + (h - 0.4) / 2, 0), stemMat, 'trunk'));
  return g;
}
