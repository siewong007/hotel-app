// The reservation counter (brief §4.4), from the owner's photos of the
// reception (2026-10-02):
//   · it spans the reception alcove, pillar to pillar: a white kick plinth, a
//     front of striated grey-brown laminate with three thin white grooves,
//     and a raised band of black granite topped by a granite transaction
//     ledge; the staff work surface sits lower behind it;
//   · on the ledge: the registration card in an acrylic stand — printed from
//     the live site config — three key cards in a sleeve (they fan out in
//     chapter 5), a pen, a chrome bell, and an acrylic stand at the left end
//     where the photos have the price list (shown blank here);
//   · the back of the staff monitor just shows above the ledge.
// Local frame: x along the counter, guest side towards +z, y up from the
// lobby floor; PLAN.counter turns it to face into the lobby.
import * as THREE from 'three';
import { PLAN } from '../world/SalimInnBuilding';
import { FRONT_DESK_FACTS, SITE } from '../config/site';
import { BRAND } from '../config/materials';
import { boxAt, metricUV, rbox } from '../world/geom';
import { canvas, finish } from '../world/textures';
import { PublicMats, registrationCard } from './lobbyMaterials';

const LEDGE_Y = 1.12; // the granite ledge's top, guest side
const BAND_Y = 0.74; // where the granite band starts above the laminate
const WORK_Y = 0.76; // staff work surface
const GROOVES = [0.24, 0.44, 0.62];

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

/** The price-list stand's card, left blank: room photos as soft blocks and
 *  empty price chips (no rates are stated in the scene). */
function standCardTexture(): THREE.Texture {
  const [c, g] = canvas(256, 352);
  g.fillStyle = '#f7f6f2';
  g.fillRect(0, 0, 256, 352);
  for (let i = 0; i < 5; i++) {
    const y = 46 + i * 58;
    g.fillStyle = ['#cfd6d2', '#d9cfc3', '#c8d3cf', '#d3d8dc', '#cfd2c8'][i];
    g.fillRect(22, y, 92, 44);
    g.fillStyle = '#3f8a7a';
    g.fillRect(170, y + 6, 62, 30);
  }
  g.fillStyle = 'rgba(40,40,40,0.5)';
  g.fillRect(70, 18, 116, 10);
  return finish(c, true, false);
}

export class ReservationCounter {
  readonly group = new THREE.Group();
  private cards: THREE.Object3D[] = [];

  constructor() {
    const c = PLAN.counter;
    const L = c.length, D = c.depth, hz = D / 2;
    this.group.position.set(c.x, 0, c.z);
    this.group.rotation.y = c.rotY;
    this.group.name = 'reservation-counter';
    const laminate = PublicMats.laminate();
    const white = PublicMats.laminateWhite();
    const granite = PublicMats.granite();
    const black = PublicMats.black();
    const steel = PublicMats.stainless();

    // ------------------------------------------------------------ body
    // the ledge's depth from the guest face; the work surface fills the rest
    const ledgeD = 0.34, zl = hz - ledgeD;
    // white kick plinth, the laminate front with its white grooves, and the
    // laminate ends
    this.group.add(mesh(boxAt(-L / 2, 0, hz - 0.03, L / 2, 0.06, hz), white, 'kick', false));
    this.group.add(mesh(metricUV(boxAt(-L / 2, 0.06, hz - 0.03, L / 2, BAND_Y, hz)), laminate, 'front'));
    for (const y of GROOVES) this.group.add(mesh(boxAt(-L / 2, y - 0.004, hz, L / 2, y + 0.004, hz + 0.004), white, 'groove', false));
    for (const sx of [-1, 1]) this.group.add(mesh(metricUV(boxAt(sx * L / 2 - (sx > 0 ? 0.03 : 0), 0, -hz, sx * L / 2 + (sx > 0 ? 0 : 0.03), BAND_Y, hz - 0.03)), laminate, 'end'));
    // the raised granite band and the ledge on it (overhanging the band by 3 cm)
    this.group.add(mesh(metricUV(boxAt(-L / 2, BAND_Y, zl, L / 2, LEDGE_Y - 0.04, hz)), granite, 'band'));
    this.group.add(mesh(metricUV(boxAt(-L / 2, LEDGE_Y - 0.04, zl - 0.02, L / 2, LEDGE_Y, hz + 0.03)), granite, 'ledge'));
    // staff side: the work surface behind the band, and its pedestals
    this.group.add(mesh(metricUV(boxAt(-L / 2 + 0.03, WORK_Y - 0.03, -hz, L / 2 - 0.03, WORK_Y, zl)), white, 'work-surface'));
    for (const x0 of [-L / 2 + 0.05, L / 2 - 0.5]) {
      this.group.add(mesh(boxAt(x0, 0, -hz + 0.02, x0 + 0.45, WORK_Y - 0.03, zl - 0.02), white, 'pedestal'));
      for (const y of [0.3, 0.52]) this.group.add(mesh(boxAt(x0 + 0.17, y, -hz + 0.005, x0 + 0.28, y + 0.012, -hz + 0.02), steel, 'pull', false));
    }
    const monitor = new THREE.Group();
    monitor.add(mesh(rbox(-0.27, 0.1, -0.012, 0.27, 0.42, 0.012, 0.006), black, 'screen'));
    monitor.add(mesh(boxAt(-0.03, 0, -0.04, 0.03, 0.12, -0.01), black, 'stand'));
    monitor.add(mesh(boxAt(-0.11, 0, -0.1, 0.11, 0.008, 0.03), black, 'foot'));
    monitor.position.set(-0.35, WORK_Y, -0.12);
    monitor.rotation.y = Math.PI + 0.12; // screen faces the staff
    this.group.add(monitor);

    // ------------------------------------------------------------ props on the ledge
    const top = LEDGE_Y;
    const zp = hz - ledgeD / 2; // the ledge's middle
    const acrylic = PublicMats.acrylic();
    // registration card in a tilted acrylic stand, facing the guest
    const cardTex = registrationCard({
      title: SITE.name.toUpperCase(),
      rows: [...FRONT_DESK_FACTS],
      foot: `${SITE.address.line1}, ${SITE.address.city}`,
    });
    const stand = new THREE.Group();
    const cw = 0.3, ch = cw * (724 / 1024); // a tent-card size, so it reads from the guest side
    const card = new THREE.Mesh(new THREE.PlaneGeometry(cw, ch), new THREE.MeshStandardMaterial({ map: cardTex, roughness: 0.8 }));
    card.position.set(0, ch / 2 + 0.012, 0);
    card.name = 'registration-card';
    const sheet = new THREE.Mesh(new THREE.BoxGeometry(cw + 0.02, ch + 0.02, 0.004).translate(0, ch / 2 + 0.012, -0.004), acrylic);
    const foot = mesh(boxAt(-cw / 2 - 0.01, 0, -0.06, cw / 2 + 0.01, 0.006, 0.01), acrylic, 'stand-foot', false);
    const tilt = new THREE.Group();
    tilt.rotation.x = -0.32; // leaning back
    tilt.add(card, sheet);
    stand.add(tilt, foot);
    stand.position.set(-0.1, top, zp + 0.05);
    stand.rotation.y = 0.12; // turned a little towards the arriving guest
    this.group.add(stand);

    // the price-list stand at the left end (as the guest sees it)
    const price = new THREE.Group();
    const pw = 0.22, ph = pw * 1.375;
    const pc = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshStandardMaterial({ map: standCardTexture(), roughness: 0.7 }));
    pc.position.set(0, ph / 2 + 0.03, 0);
    price.add(pc, new THREE.Mesh(new THREE.BoxGeometry(pw + 0.03, ph + 0.03, 0.006).translate(0, ph / 2 + 0.03, -0.005), acrylic));
    price.add(mesh(boxAt(-pw / 2 - 0.02, 0, -0.05, pw / 2 + 0.02, 0.03, 0.02), acrylic, 'price-foot', false));
    price.position.set(-L / 2 + 0.24, top, zp);
    this.group.add(price);

    // chrome bell on a black base, at the right end
    const bell = new THREE.Group();
    bell.add(mesh(new THREE.CylinderGeometry(0.048, 0.05, 0.014, 32).translate(0, 0.007, 0), black, 'bell-base'));
    const prof: THREE.Vector2[] = [];
    for (let i = 0; i <= 16; i++) { const a = (i / 16) * (Math.PI / 2); prof.push(new THREE.Vector2(0.044 * Math.cos(a) + 0.0005, 0.014 + 0.042 * Math.sin(a))); }
    bell.add(mesh(new THREE.LatheGeometry(prof, 40), steel, 'bell-dome'));
    bell.add(mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.022, 12).translate(0, 0.066, 0), steel, 'bell-plunger'), mesh(new THREE.SphereGeometry(0.009, 16, 10).translate(0, 0.079, 0), steel, 'bell-knob'));
    bell.position.set(L / 2 - 0.42, top, zp);
    this.group.add(bell);

    // three key cards in a paper sleeve, lying flat; they fan out in chapter 5
    const cardMat = new THREE.MeshStandardMaterial({ map: keyCardTexture(), roughness: 0.35 });
    const edge = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.5 });
    const sleeve = mesh(boxAt(0, 0, 0, 0.1, 0.004, 0.066), new THREE.MeshStandardMaterial({ color: 0xf4efe4, roughness: 0.85 }), 'sleeve');
    const keys = new THREE.Group();
    keys.position.set(0.2, top, zp - 0.02);
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
    pen.add(mesh(new THREE.CylinderGeometry(0.0052, 0.0052, 0.02, 12).rotateZ(Math.PI / 2).translate(0.06, 0, 0), steel, 'pen-cap'));
    pen.add(mesh(boxAt(0.035, 0.004, -0.0015, 0.068, 0.0065, 0.0015), steel, 'pen-clip', false));
    pen.position.set(0.42, top + 0.005, zp + 0.06);
    pen.rotation.y = 0.5;
    this.group.add(pen);
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
