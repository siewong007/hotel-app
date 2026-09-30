// Sample reservation counter (brief §4.4). No reception photo exists, so it
// is designed from the entrance frames and flagged for the owner:
//   · 2.4 m long, 1.05 m high on the guest side, a 0.75 m staff work surface
//     behind; fluted walnut front with a thin brass inlay line, a marble
//     transaction ledge, and a soft LED glow under the recessed kick plate;
//   · on the ledge: a brass bell, three key cards in a sleeve (they fan out
//     in chapter 5), a pen, a small plant, and the registration card in an
//     acrylic stand — printed from the live site config;
//   · the back of the staff monitor just shows above the ledge.
// Local frame: x along the counter, guest side towards +z, y up from the
// lobby floor.
import * as THREE from 'three';
import { PLAN } from '../world/SalimInnBuilding';
import { FRONT_DESK_FACTS, SITE } from '../config/site';
import { BRAND } from '../config/materials';
import { boxAt, metricUV, rbox } from '../world/geom';
import { canvas, finish } from '../world/textures';
import { glowTexture, PublicMats, registrationCard } from './lobbyMaterials';

const LEDGE_Y = 1.05;

function mesh(g: THREE.BufferGeometry, m: THREE.Material, name = '', shadow = true): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.name = name;
  o.castShadow = shadow;
  o.receiveShadow = true;
  return o;
}

/** Key-card face: forest green, a gold chip and the hotel's name. */
function keyCardTexture(): THREE.Texture {
  const [c, g] = canvas(256, 160);
  g.fillStyle = `#${new THREE.Color(BRAND.forest).getHexString()}`;
  g.fillRect(0, 0, 256, 160);
  g.fillStyle = `#${new THREE.Color(BRAND.gold).getHexString()}`;
  g.font = '700 30px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
  g.textAlign = 'left';
  g.fillText(SITE.name.toUpperCase(), 22, 132);
  g.fillRect(22, 30, 44, 34);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(22, 46, 44, 2);
  g.fillRect(43, 30, 2, 34);
  return finish(c, true, false);
}

export class ReservationCounter {
  readonly group = new THREE.Group();
  private cards: THREE.Object3D[] = [];

  constructor() {
    const c = PLAN.counter;
    const L = c.length, D = c.depth, hz = D / 2;
    this.group.position.set(c.x, 0, c.z);
    this.group.name = 'reservation-counter';
    const walnut = PublicMats.walnut();
    const black = PublicMats.black();

    // ------------------------------------------------------------ body
    // recessed plinth, the LED strip under the front's lower edge, and its glow on the floor
    this.group.add(mesh(boxAt(-L / 2 + 0.03, 0, -hz + 0.05, L / 2 - 0.03, 0.1, hz - 0.07), black, 'plinth'));
    this.group.add(mesh(boxAt(-L / 2 + 0.04, 0.094, hz - 0.075, L / 2 - 0.04, 0.1, hz - 0.06), PublicMats.emissive(0xffc98a, 3.2, 'kick'), 'kick-led', false));
    const floorGlow = new THREE.Mesh(new THREE.PlaneGeometry(L + 0.5, 0.9).rotateX(-Math.PI / 2), PublicMats.glow(glowTexture(), 0xffb877, 0.55, 'kickFloor'));
    floorGlow.position.set(0, 0.004, hz + 0.08);
    floorGlow.renderOrder = 2;
    this.group.add(floorGlow);
    // fluted walnut front, plain walnut ends
    this.group.add(mesh(metricUV(boxAt(-L / 2, 0.1, hz - 0.05, L / 2, LEDGE_Y - 0.05, hz)), PublicMats.walnutFluted(), 'front'));
    for (const sx of [-1, 1]) {
      this.group.add(mesh(rbox(sx * L / 2 - (sx > 0 ? 0.045 : 0), 0.1, -hz, sx * L / 2 + (sx > 0 ? 0 : 0.045), LEDGE_Y - 0.05, hz, 0.008), walnut, 'end'));
    }
    // brass inlay line across the front, and a thin brass shadow gap under the ledge
    const brass = PublicMats.brass();
    this.group.add(mesh(boxAt(-L / 2 + 0.01, 0.855, hz, L / 2 - 0.01, 0.867, hz + 0.004), brass, 'inlay', false));
    this.group.add(mesh(boxAt(-L / 2 + 0.01, LEDGE_Y - 0.052, hz - 0.004, L / 2 - 0.01, LEDGE_Y - 0.046, hz + 0.002), brass, 'ledge-trim', false));
    // marble transaction ledge (overhangs the front by 4 cm), the staff work
    // surface below it, and the upstand between them
    this.group.add(mesh(metricUV(rbox(-L / 2 - 0.04, LEDGE_Y - 0.05, 0, L / 2 + 0.04, LEDGE_Y, hz + 0.04, 0.008)), PublicMats.marble(), 'ledge'));
    this.group.add(mesh(metricUV(rbox(-L / 2 + 0.045, 0.72, -hz, L / 2 - 0.045, 0.755, 0.02, 0.006)), PublicMats.marble(), 'work-surface'));
    this.group.add(mesh(boxAt(-L / 2 + 0.045, 0.755, -0.01, L / 2 - 0.045, LEDGE_Y - 0.05, 0.01), walnut, 'upstand'));
    // staff-side drawer pedestals, and the back of the staff monitor
    for (const x0 of [-L / 2 + 0.05, L / 2 - 0.5]) {
      this.group.add(mesh(boxAt(x0, 0.1, -hz + 0.02, x0 + 0.45, 0.72, -0.02), walnut, 'pedestal'));
      for (const y of [0.3, 0.52]) this.group.add(mesh(boxAt(x0 + 0.17, y, -hz + 0.005, x0 + 0.28, y + 0.012, -hz + 0.02), brass, 'pull', false));
    }
    const monitor = new THREE.Group();
    monitor.add(mesh(rbox(-0.27, 0.1, -0.012, 0.27, 0.42, 0.012, 0.006), black, 'screen'));
    monitor.add(mesh(boxAt(-0.03, 0, -0.04, 0.03, 0.12, -0.01), black, 'stand'));
    monitor.add(mesh(boxAt(-0.11, 0, -0.1, 0.11, 0.008, 0.03), black, 'foot'));
    monitor.position.set(-0.35, 0.755, -0.2);
    monitor.rotation.y = Math.PI + 0.12; // screen faces the staff
    this.group.add(monitor);

    // ------------------------------------------------------------ props on the ledge
    const top = LEDGE_Y;
    // registration card in a tilted acrylic stand, facing the guest
    const cardTex = registrationCard({
      title: SITE.name.toUpperCase(),
      rows: [...FRONT_DESK_FACTS],
      foot: `${SITE.address.line1}, ${SITE.address.city}`,
    });
    const stand = new THREE.Group();
    const cw = 0.34, ch = cw * (724 / 1024); // a tent-card size, so it reads from the guest side
    const card = new THREE.Mesh(new THREE.PlaneGeometry(cw, ch), new THREE.MeshStandardMaterial({ map: cardTex, roughness: 0.8 }));
    card.position.set(0, ch / 2 + 0.012, 0);
    card.name = 'registration-card';
    const acrylic = new THREE.Mesh(new THREE.BoxGeometry(cw + 0.02, ch + 0.02, 0.004).translate(0, ch / 2 + 0.012, -0.004),
      new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false, clearcoat: 1 }));
    const foot = mesh(boxAt(-cw / 2 - 0.01, 0, -0.06, cw / 2 + 0.01, 0.006, 0.01), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.3, depthWrite: false }), 'stand-foot', false);
    const tilt = new THREE.Group();
    tilt.rotation.x = -0.32; // leaning back
    tilt.add(card, acrylic);
    stand.add(tilt, foot);
    stand.position.set(-0.42, top, 0.24);
    stand.rotation.y = 0.18; // turned a little towards the arriving guest
    this.group.add(stand);

    // brass bell on a black base
    const bell = new THREE.Group();
    bell.add(mesh(new THREE.CylinderGeometry(0.048, 0.05, 0.014, 32).translate(0, 0.007, 0), black, 'bell-base'));
    const prof: THREE.Vector2[] = [];
    for (let i = 0; i <= 16; i++) { const a = (i / 16) * (Math.PI / 2); prof.push(new THREE.Vector2(0.044 * Math.cos(a) + 0.0005, 0.014 + 0.042 * Math.sin(a))); }
    bell.add(mesh(new THREE.LatheGeometry(prof, 40), brass, 'bell-dome'));
    bell.add(mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.022, 12).translate(0, 0.066, 0), brass, 'bell-plunger'), mesh(new THREE.SphereGeometry(0.009, 16, 10).translate(0, 0.079, 0), brass, 'bell-knob'));
    bell.position.set(0.52, top, 0.2);
    this.group.add(bell);

    // three key cards in a paper sleeve, lying flat; they fan out in chapter 5
    const cardMat = new THREE.MeshStandardMaterial({ map: keyCardTexture(), roughness: 0.35 });
    const edge = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.5 });
    const sleeve = mesh(boxAt(0, 0, 0, 0.1, 0.004, 0.066), new THREE.MeshStandardMaterial({ color: 0xf4efe4, roughness: 0.85 }), 'sleeve');
    const keys = new THREE.Group();
    keys.position.set(0.07, top, 0.16);
    keys.rotation.y = -0.25;
    keys.add(sleeve);
    for (let i = 0; i < 3; i++) {
      const pivot = new THREE.Group();
      pivot.position.set(0.004, 0.0045 + i * 0.0011, 0.062); // front-left corner of the stack
      const k = new THREE.Mesh(new THREE.BoxGeometry(0.0856, 0.0008, 0.054).translate(0.0428, 0, -0.027), [edge, edge, cardMat, edge, edge, edge]);
      k.castShadow = true;
      pivot.add(k);
      keys.add(pivot);
      this.cards.push(pivot);
    }
    this.group.add(keys);

    // pen, lying at an angle beside the card
    const pen = new THREE.Group();
    pen.add(mesh(new THREE.CylinderGeometry(0.005, 0.0045, 0.138, 12).rotateZ(Math.PI / 2), black, 'pen'));
    pen.add(mesh(new THREE.CylinderGeometry(0.0052, 0.0052, 0.02, 12).rotateZ(Math.PI / 2).translate(0.06, 0, 0), brass, 'pen-cap'));
    pen.add(mesh(boxAt(0.035, 0.004, -0.0015, 0.068, 0.0065, 0.0015), brass, 'pen-clip', false));
    pen.position.set(-0.13, top + 0.005, 0.2);
    pen.rotation.y = 0.5;
    this.group.add(pen);

    // small succulent in a white pot at the left end
    const plant = new THREE.Group();
    const potProf = [new THREE.Vector2(0, 0), new THREE.Vector2(0.046, 0), new THREE.Vector2(0.056, 0.085), new THREE.Vector2(0.05, 0.085), new THREE.Vector2(0.049, 0.078), new THREE.Vector2(0, 0.078)];
    plant.add(mesh(new THREE.LatheGeometry(potProf, 28), new THREE.MeshPhysicalMaterial({ color: 0xf4f2ee, roughness: 0.25, clearcoat: 0.6 }), 'pot'));
    const leafGeo = new THREE.SphereGeometry(1, 10, 6).scale(0.012, 0.006, 0.03).translate(0, 0, 0.026);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x7ea17a, roughness: 0.55 });
    for (let i = 0; i < 22; i++) {
      const ring = i / 22;
      const lf = new THREE.Mesh(leafGeo, leafMat);
      lf.rotation.order = 'YXZ';
      lf.rotation.y = i * 2.4;
      lf.rotation.x = -0.25 - (1 - ring) * 0.9;
      const s = 0.55 + ring * 0.55;
      lf.scale.setScalar(s);
      lf.position.y = 0.084 + (1 - ring) * 0.02;
      lf.castShadow = true;
      plant.add(lf);
    }
    plant.position.set(-L / 2 + 0.2, top, 0.2);
    this.group.add(plant);
  }

  /** Parts that move on their own (kept out of static merging). */
  get dynamic(): THREE.Object3D[] {
    return this.cards;
  }

  /** Chapter 5: the key cards fan out of their sleeve (0 → 1). */
  setFan(v: number): void {
    const e = THREE.MathUtils.smootherstep(v, 0, 1);
    this.cards.forEach((pivot, i) => {
      pivot.rotation.y = e * (0.28 - i * 0.26);
      pivot.position.x = 0.004 + e * i * 0.012;
    });
  }
}
