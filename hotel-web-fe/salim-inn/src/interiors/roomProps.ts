// Guest-room furniture and props, modelled on the owner's photos (brief §4.5):
// beds at Malaysian sizes with the four headboard styles and the two base
// types, bedside table with telephone, open hanging wardrobe, writing desk
// with mirror and kettle tray, the green perforated chair, wall TV, split AC,
// pleated curtains on a rail, gold leaf art, luggage rack, and the ensuite
// fittings. Each builder returns a Group in a small local frame:
//   · wall-mounted / wall-backed pieces: back against x = 0, facing +x
//   · beds: headboard at x = 0, the bed running along +x, centred on z = 0
import * as THREE from 'three';
import { RoomMats, type HeadStyle } from './roomMaterials';
import { boxAt, mergeAll, metricUV, rbox, roundedBox } from '../world/geom';
import { canvas, finish } from '../world/textures';

export const BED_SIZE = { single: [0.91, 1.9], queen: [1.52, 1.9], king: [1.83, 1.9] } as const;
export type BedSize = keyof typeof BED_SIZE;
export interface BedStyle { head: HeadStyle; base: 'skirt' | 'divan' }

function mesh(g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], name = ''): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.castShadow = false; // the sun is the only shadow light and indoors it is a sliver (world/World.ts)
  o.receiveShadow = true;
  o.name = name;
  return o;
}

/** Soft cushion: a subdivided box whose thickness falls off toward the edges. */
export function cushion(w: number, h: number, d: number, puff = 0.55): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d, 10, 2, 8);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const a = (2 * p.getX(i)) / w, b = (2 * p.getZ(i)) / d;
    const k = Math.sqrt(Math.max(0, (1 - Math.pow(Math.abs(a), 3.5)) * (1 - Math.pow(Math.abs(b), 3.5))));
    const y = p.getY(i) * (1 - puff + puff * k);
    // round the plan corners in a little
    p.setXYZ(i, p.getX(i) * (1 - 0.04 * b * b), y, p.getZ(i) * (1 - 0.04 * a * a));
  }
  g.computeVertexNormals();
  return g;
}

/** Bedside table widths: the standard one, and the narrow one between the
 *  Superior Twin's singles (its sheets hang to within a few cm of it). */
export const NIGHTSTAND_WIDTH = { standard: 0.45, narrow: 0.29 } as const;

/** Plan footprint of a floor-standing piece in its own frame — depth out from
 *  the wall (+x) × width along it (z) — or null for wall-mounted pieces. Beds
 *  count the headboard and the sheet's hang; chairs are centred on their
 *  position. Mirrors the builders below (a test keeps layouts clear of each
 *  other with it). */
export function floorFootprint(kind: string, variant: string, size?: BedSize): { depth: number; width: number; centred?: boolean } | null {
  switch (kind) {
    case 'bed': {
      const [W, L] = BED_SIZE[size ?? 'queen'];
      return { depth: 0.06 + L + 0.05, width: W + (size === 'single' ? 0.1 : 0.2) };
    }
    case 'nightstand': return { depth: 0.4, width: variant === 'nightstand-narrow' ? NIGHTSTAND_WIDTH.narrow : NIGHTSTAND_WIDTH.standard };
    case 'wardrobe': return { depth: 0.55, width: 0.6 };
    case 'desk': return { depth: 0.5, width: 0.9 };
    case 'luggage': return { depth: 0.45, width: 0.64 };
    case 'chair': return { depth: 0.42, width: 0.42, centred: true };
    default: return null; // tv, ac, mirror, art hang on the walls
  }
}

// ---------------------------------------------------------------- bed
interface DrapeOpts {
  W: number; L: number; x0: number; topY: number;
  r: number; // edge roll radius
  drop: number; // how far the sides hang below the top
  a0: number; a1: number; // cloth coordinates across (0 = the bed's centre line)…
  b0: number; b1: number; // …and along, from the head
  lift?: number; // stand-off above the sheet (a runner)
  seed?: number;
}

/** A cloth laid over a W × L mattress whose head is at x0: flat on top,
 *  rolled over the side and foot edges and hanging below. It is mapped from
 *  the cloth's own flat coordinates, so a runner is just a narrower band of
 *  the same mapping lifted a few millimetres. Past the foot corners the cloth
 *  falls radially and hangs lower, as a real sheet does. UVs in 28 cm units
 *  (one repeat of the damask stripe, which runs along the bed). */
function drapeSurface(o: DrapeOpts): THREE.BufferGeometry {
  const { W, L, x0, topY, r, drop, a0, a1, b0, b1 } = o;
  const lift = o.lift ?? 0, seed = o.seed ?? 0;
  const R = r + lift, arc = (Math.PI / 2) * R;
  const step = 0.025;
  const nu = Math.max(2, Math.ceil((a1 - a0) / step)), nv = Math.max(2, Math.ceil((b1 - b0) / step));
  const pos = new Float32Array((nu + 1) * (nv + 1) * 3);
  const uv = new Float32Array((nu + 1) * (nv + 1) * 2);
  let k = 0;
  for (let j = 0; j <= nv; j++) {
    const b = b0 + ((b1 - b0) * j) / nv;
    for (let i = 0; i <= nu; i++) {
      const a = a0 + ((a1 - a0) * i) / nu;
      const dz = Math.max(0, Math.abs(a) - W / 2), dx = Math.max(0, b - L);
      const d = Math.hypot(dz, dx);
      const ox = d > 0 ? dx / d : 0, oz = d > 0 ? (Math.sign(a) * dz) / d : 0;
      let h: number, y: number;
      if (d <= arc) {
        const t = d / R;
        h = R * Math.sin(t);
        y = topY + lift - R * (1 - Math.cos(t));
      } else {
        const below = d - arc;
        h = R + 0.015 * Math.min(1, below / 0.25); // the hang stands off a little
        y = topY + lift - R - below;
        // soft vertical folds, stronger towards the hem
        const along = dx > 0 && dz > 0 ? a + b : dx > 0 ? a : b;
        const kf = Math.min(1, below / 0.12);
        h += kf * (0.007 * Math.sin(along * 19 + seed) + 0.004 * Math.sin(along * 43 + 1.3 + seed));
      }
      y = Math.max(y, topY - drop - 0.09); // the corners fall at most 9 cm further
      if (d === 0) y += 0.0022 * Math.sin(a * 17 + b * 5 + seed) * Math.sin(b * 11 - a * 3);
      pos[k * 3] = x0 + Math.min(b, L) + ox * h;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = THREE.MathUtils.clamp(a, -W / 2, W / 2) + oz * h;
      uv[k * 2] = b / 0.28;
      uv[k * 2 + 1] = a / 0.28;
      k++;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const p = j * (nu + 1) + i, q = p + 1, s = p + nu + 1, t = s + 1;
    idx.push(p, q, s, q, t, s);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Box-pleated valance round the two sides and the foot of a bed (the head
 *  is against the headboard): real pleats in the silhouette, ~18 cm apart. */
function pleatedSkirt(W: number, L: number, x0: number, y0: number, y1: number): THREE.BufferGeometry {
  const P = 2 * L + W, pitch = 0.18;
  const n = Math.ceil(P / (pitch / 8));
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const at = (s: number): [number, number, number, number] => {
    // point and outward normal (x, z, nx, nz) along +z side → foot → −z side
    if (s <= L) return [x0 + s, W / 2, 0, 1];
    if (s <= L + W) return [x0 + L, W / 2 - (s - L), 1, 0];
    return [x0 + L - (s - L - W), -W / 2, 0, -1];
  };
  for (let i = 0; i <= n; i++) {
    const s = (P * i) / n;
    let [x, z, nx, nz] = at(s);
    // round the two foot corners over 3 cm
    for (const c of [L, L + W]) if (Math.abs(s - c) < 0.03) { const [, , ax, az] = at(c - 0.031), [, , bx, bz] = at(c + 0.031); const f = (s - c + 0.03) / 0.06; nx = ax + (bx - ax) * f; nz = az + (bz - az) * f; const l = Math.hypot(nx, nz); nx /= l; nz /= l; }
    const pleat = 0.011 * Math.sin((2 * Math.PI * s) / pitch) + 0.004 * Math.sin((4 * Math.PI * s) / pitch + 0.6);
    for (const [y, flare] of [[y0, 0.012], [y1, 0]] as const) {
      pos.push(x + nx * (pleat + flare), y, z + nz * (pleat + flare));
      uv.push(s, (y - y0) / (y1 - y0));
    }
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function makeBed(size: BedSize, style: BedStyle, runner = true): THREE.Group {
  const [W, L] = BED_SIZE[size];
  const g = new THREE.Group();
  g.name = `bed-${size}-${style.head}`;
  const x0 = 0.06; // clear of the headboard
  const topY = 0.58;
  if (style.base === 'skirt') {
    // valance: pleated fabric round the three open sides, to the floor
    g.add(mesh(pleatedSkirt(W + 0.03, L + 0.015, x0, 0.015, 0.34), RoomMats.skirt(), 'skirt'));
    // the platform inside it (only its top edge could ever show)
    g.add(mesh(boxAt(x0 + 0.02, 0.1, -W / 2 + 0.01, x0 + L - 0.01, 0.34, W / 2 - 0.01), RoomMats.blackMatte(), 'platform'));
  } else {
    const divan = mesh(metricUV(rbox(x0, 0.07, -W / 2, x0 + L, 0.34, W / 2, 0.03)), RoomMats.divan(), 'divan');
    g.add(divan);
    for (const [lx, lz] of [[x0 + 0.08, -W / 2 + 0.08], [x0 + 0.08, W / 2 - 0.08], [x0 + L - 0.08, -W / 2 + 0.08], [x0 + L - 0.08, W / 2 - 0.08]]) {
      const leg = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.07, 8).translate(lx, 0.035, lz), RoomMats.blackMatte());
      g.add(leg);
    }
  }
  // mattress, and the flat sheet laid over it: rolled over the side and foot
  // edges and hanging ~29 cm, the foot corners falling a little lower
  const mattress = mesh(roundedBox(L - 0.02, 0.24, W - 0.02, 0.1, 4).translate(x0 + L / 2, 0.46, 0), RoomMats.sheet(), 'mattress');
  // divans show below a shorter hang (superior-twin.jpg, family-suite.jpg)
  const R = 0.035, drop = style.base === 'divan' ? 0.23 : 0.29;
  const reach = (d: number, lift = 0) => W / 2 + (Math.PI / 2) * (R + lift) + (d + lift - R - lift);
  const seed = W * 7.1;
  const sheet = mesh(drapeSurface({ W, L, x0, topY: topY + 0.004, r: R, a0: -reach(drop), a1: reach(drop), b0: 0, b1: L + reach(drop) - W / 2, drop, seed }), RoomMats.sheet(), 'sheet');
  // the turned-down fold line below the pillows
  const fold = mesh(roundedBox(0.34, 0.035, W + 0.01, 0.015, 2).translate(x0 + 0.72, topY + 0.001, 0), RoomMats.sheet(), 'sheet-fold');
  g.add(mattress, sheet, fold);
  // pillows: 50 × 75 cm, one per single, two otherwise, leaning on the headboard
  const n = size === 'single' ? 1 : 2;
  for (let i = 0; i < n; i++) {
    const pw = n === 1 ? Math.min(0.74, W - 0.12) : Math.min(0.75, W / 2 - 0.04);
    const pz = n === 1 ? 0 : (i === 0 ? -1 : 1) * (W / 4 + 0.01);
    // leaning well up against the headboard, as the photos show
    const pillow = mesh(cushion(0.5, 0.24, pw, 0.85), RoomMats.pillow(), 'pillow');
    pillow.position.set(x0 + 0.2, topY + 0.2, pz);
    pillow.rotation.z = -0.62;
    g.add(pillow);
  }
  if (runner) {
    const lift = 0.009, rd = 0.16;
    const ra = W / 2 + (Math.PI / 2) * (R + lift) + (rd - R);
    g.add(mesh(drapeSurface({ W, L, x0, topY, r: R, lift, a0: -ra, a1: ra, b0: L - 0.44, b1: L - 0.2, drop: rd, seed: W * 7.1 }), RoomMats.runner(), 'runner'));
  }
  // headboard: panel against the wall, the styled face towards the bed
  const hw = W + (size === 'single' ? 0.1 : 0.2);
  const hbGeo = new THREE.BoxGeometry(0.07, 0.72, hw);
  const side = RoomMats.headboardSide(style.head);
  const face = RoomMats.headboard(style.head);
  // BoxGeometry groups: +x, −x, +y, −y, +z, −z
  const hb = mesh(hbGeo, [face, side, side, side, side, side], 'headboard');
  hb.position.set(0.035, 1.25 - 0.36, 0);
  g.add(hb);
  return g;
}

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeAll(parts, ['position', 'normal', 'uv']);
}

// ---------------------------------------------------------------- casegoods
/** Bedside table (0.45 wide × 0.4 deep × 0.5 high): drawer over an open shelf. */
export function makeNightstand(phone = true, width: number = NIGHTSTAND_WIDTH.standard): THREE.Group {
  const g = new THREE.Group();
  g.name = 'nightstand';
  const lam = RoomMats.laminate();
  const h = width / 2;
  g.add(mesh(mergeParts([
    rbox(0, 0.0, -h, 0.4, 0.03, h, 0.006), // plinth
    rbox(0, 0.03, -h, 0.4, 0.5, -h + 0.02, 0.006), // sides
    rbox(0, 0.03, h - 0.02, 0.4, 0.5, h, 0.006),
    rbox(0, 0.48, -h, 0.4, 0.5, h, 0.006), // top
    rbox(0, 0.28, -h + 0.02, 0.39, 0.3, h - 0.02, 0.004), // shelf
    rbox(0.01, 0.03, -h + 0.02, 0.03, 0.48, h - 0.02, 0.004), // back
    rbox(0.37, 0.31, -h + 0.025, 0.395, 0.475, h - 0.025, 0.006), // drawer front
  ]), lam, 'nightstand-body'));
  g.add(mesh(boxAt(0.395, 0.385, -0.06, 0.41, 0.395, 0.06), RoomMats.chrome(), 'nightstand-pull'));
  if (phone) {
    const p = makePhone();
    p.position.set(0.2, 0.5, 0.05);
    p.rotation.y = -0.3;
    g.add(p);
  }
  return g;
}

export function makePhone(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'phone';
  const base = mesh(rbox(-0.09, 0, -0.1, 0.09, 0.05, 0.1, 0.02), RoomMats.phone());
  const handset = mesh(roundedBox(0.05, 0.03, 0.2, 0.012, 2).translate(-0.04, 0.065, 0), RoomMats.phone());
  const keys = mesh(boxAt(0.0, 0.051, -0.06, 0.07, 0.054, 0.06), RoomMats.white());
  g.add(base, handset, keys);
  return g;
}

/** Open hanging unit (DLX, SUP photos): 0.6 wide × 0.55 deep × 2.4 high,
 *  a closed cabinet on top, a chrome rail with hangers, a shelf below. */
export function makeWardrobe(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'wardrobe';
  const lam = RoomMats.laminate();
  const W = 0.6, D = 0.55, H = 2.6;
  g.add(mesh(mergeParts([
    rbox(0, 0, -W / 2, D, H, -W / 2 + 0.02, 0.004),
    rbox(0, 0, W / 2 - 0.02, D, H, W / 2, 0.004),
    rbox(0, H - 0.02, -W / 2, D, H, W / 2, 0.004),
    rbox(0, 2.02, -W / 2, D, 2.04, W / 2, 0.004), // cabinet floor
    rbox(D - 0.02, 2.04, -W / 2 + 0.01, D, H - 0.02, W / 2 - 0.01, 0.004), // cabinet door
    rbox(0, 0.28, -W / 2, D, 0.3, W / 2, 0.004), // bottom shelf
    rbox(0, 0, -W / 2, D, 0.08, W / 2, 0.004), // plinth
    rbox(0, 0, -W / 2, 0.015, H, W / 2, 0.004), // back
  ]), lam, 'wardrobe-body'));
  g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, W - 0.04, 10).rotateX(Math.PI / 2).translate(D / 2, 1.92, 0), RoomMats.chrome(), 'rail'));
  // hangers: a hook and a shoulder bar each
  const hangers: THREE.BufferGeometry[] = [];
  for (const z of [-0.12, 0.02, 0.14]) {
    hangers.push(new THREE.TorusGeometry(0.025, 0.004, 5, 10, Math.PI).rotateY(Math.PI / 2).translate(D / 2, 1.925, z));
    hangers.push(new THREE.CylinderGeometry(0.005, 0.005, 0.38, 5).rotateZ(Math.PI / 2).translate(D / 2, 1.82, z));
    hangers.push(new THREE.CylinderGeometry(0.004, 0.004, 0.1, 5).translate(D / 2, 1.87, z));
  }
  g.add(mesh(mergeParts(hangers), RoomMats.blackMatte(), 'hangers'));
  // door seam and a small pull
  g.add(mesh(boxAt(D, 2.07, -0.1, D + 0.012, 2.11, 0.1), RoomMats.chrome(), 'pull'));
  return g;
}

/** Writing desk (0.9 × 0.5 × 0.75) with a drawer; `tray` adds kettle,
 *  two bottles of water and the tray (FS photo, guest-room photo). */
export function makeDesk(tray = true): THREE.Group {
  const g = new THREE.Group();
  g.name = 'desk';
  const lam = RoomMats.laminate();
  const W = 0.9, D = 0.5, H = 0.75;
  g.add(mesh(mergeParts([
    rbox(0, H - 0.03, -W / 2, D, H, W / 2, 0.006),
    rbox(0, 0, -W / 2, D, H - 0.03, -W / 2 + 0.025, 0.004),
    rbox(0, 0, W / 2 - 0.025, D, H - 0.03, W / 2, 0.004),
    rbox(0, H - 0.18, W / 2 - 0.42, D - 0.01, H - 0.03, W / 2 - 0.025, 0.004), // drawer box
    rbox(0, 0, -W / 2, 0.02, H - 0.03, W / 2, 0.004), // modesty panel
  ]), lam, 'desk-body'));
  g.add(mesh(boxAt(D - 0.005, H - 0.11, W / 2 - 0.28, D + 0.008, H - 0.1, W / 2 - 0.16), RoomMats.chrome(), 'desk-pull'));
  if (tray) {
    const t = new THREE.Group();
    t.add(mesh(rbox(0.12, H, -0.28, 0.4, H + 0.015, 0.1, 0.006), RoomMats.blackMatte(), 'tray'));
    // kettle
    const kettle = mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.2, 18).translate(0.26, H + 0.115, 0.03), RoomMats.blackGloss(), 'kettle');
    const handle = mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI).rotateZ(-Math.PI / 2).translate(0.26, H + 0.13, 0.11), RoomMats.blackGloss());
    // bottled water ×2
    const bottles = mesh(mergeParts([
      new THREE.CylinderGeometry(0.03, 0.03, 0.2, 10).translate(0.22, H + 0.115, -0.13),
      new THREE.CylinderGeometry(0.03, 0.03, 0.2, 10).translate(0.3, H + 0.115, -0.2),
    ]), RoomMats.bottle(), 'bottles');
    const caps = mesh(mergeParts([
      new THREE.CylinderGeometry(0.014, 0.014, 0.025, 8).translate(0.22, H + 0.228, -0.13),
      new THREE.CylinderGeometry(0.014, 0.014, 0.025, 8).translate(0.3, H + 0.228, -0.2),
    ]), new THREE.MeshStandardMaterial({ color: 0x2f6fd0, roughness: 0.4 }), 'caps');
    t.add(kettle, handle, bottles, caps);
    g.add(t);
  }
  return g;
}

/** Framed mirror (pale laminate frame) hung on a wall, facing +x. */
export function makeMirror(w = 0.5, h = 0.72): THREE.Group {
  const g = new THREE.Group();
  g.name = 'mirror';
  const f = 0.045;
  g.add(mesh(mergeParts([
    rbox(0, -h / 2, -w / 2, 0.03, h / 2, -w / 2 + f, 0.004),
    rbox(0, -h / 2, w / 2 - f, 0.03, h / 2, w / 2, 0.004),
    rbox(0, h / 2 - f, -w / 2, 0.03, h / 2, w / 2, 0.004),
    rbox(0, -h / 2, -w / 2, 0.03, -h / 2 + f, w / 2, 0.004),
  ]), RoomMats.laminate(), 'mirror-frame'));
  g.add(mesh(boxAt(0.005, -h / 2 + f, -w / 2 + f, 0.018, h / 2 - f, w / 2 - f), RoomMats.mirror(), 'mirror-glass'));
  return g;
}

/** Perforated back pattern for the green plastic chair (alpha). */
function perforation(): THREE.Texture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#000';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 6; x++) {
    g.beginPath();
    g.ellipse(22 + x * 42 + (y % 2) * 21, 18 + y * 31, 14, 9, 0.6, 0, 6.3);
    g.fill();
  }
  const t = finish(c, false, false);
  return t;
}
let perfTex: THREE.Texture | null = null;

/** The bright green stacking chair (FS photo, guest-room photo). Faces +x. */
export function makeChair(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'chair';
  const green = RoomMats.plasticGreen();
  perfTex ??= perforation();
  const backMat = new THREE.MeshStandardMaterial({ color: green.color, roughness: 0.45, alphaMap: perfTex, alphaTest: 0.5, side: THREE.DoubleSide });
  g.add(mesh(rbox(-0.21, 0.43, -0.21, 0.21, 0.46, 0.21, 0.02), green, 'seat'));
  const back = new THREE.PlaneGeometry(0.4, 0.42, 1, 1).rotateY(-Math.PI / 2);
  const bm = mesh(back, backMat, 'backrest');
  bm.position.set(-0.2, 0.7, 0);
  bm.rotation.z = -0.12;
  g.add(bm);
  const legs: THREE.BufferGeometry[] = [];
  for (const [x, z] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) {
    legs.push(new THREE.CylinderGeometry(0.018, 0.022, 0.44, 8).translate(x, 0.22, z));
  }
  legs.push(boxAt(-0.2, 0.46, -0.2, -0.18, 0.92, -0.18), boxAt(-0.2, 0.46, 0.18, -0.18, 0.92, 0.2));
  g.add(mesh(mergeParts(legs), green, 'chair-legs'));
  return g;
}

/** Wall-mounted 32" LCD TV, facing +x. */
export function makeTV(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'tv';
  g.add(mesh(rbox(0.02, -0.23, -0.39, 0.07, 0.23, 0.39, 0.012), RoomMats.blackMatte(), 'tv-body'));
  g.add(mesh(boxAt(0.071, -0.21, -0.37, 0.074, 0.21, 0.37), RoomMats.blackGloss(), 'tv-screen'));
  g.add(mesh(boxAt(0, -0.08, -0.1, 0.02, 0.08, 0.1), RoomMats.blackMatte(), 'tv-bracket'));
  return g;
}

/** Split AC indoor unit (cream, guest-room photo), facing +x. */
export function makeAC(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'ac';
  g.add(mesh(rbox(0, -0.14, -0.4, 0.21, 0.14, 0.4, 0.03), RoomMats.acCream(), 'ac-body'));
  g.add(mesh(boxAt(0.12, -0.14, -0.34, 0.2, -0.105, 0.34), RoomMats.blackMatte(), 'ac-vent'));
  g.add(mesh(boxAt(0.205, -0.1, -0.38, 0.214, 0.12, 0.38), RoomMats.acCream(), 'ac-front'));
  return g;
}

/** Luggage rack: chrome frame with two straps. */
export function makeLuggageRack(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'luggage';
  const parts: THREE.BufferGeometry[] = [];
  for (const z of [-0.3, 0.3]) for (const x of [0.02, 0.42]) parts.push(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6).translate(x, 0.25, z));
  for (const x of [0.02, 0.42]) parts.push(new THREE.CylinderGeometry(0.012, 0.012, 0.62, 6).rotateX(Math.PI / 2).translate(x, 0.5, 0));
  g.add(mesh(mergeParts(parts), RoomMats.chrome(), 'luggage-frame'));
  g.add(mesh(mergeParts([boxAt(0.02, 0.495, -0.2, 0.42, 0.505, -0.14), boxAt(0.02, 0.495, 0.14, 0.42, 0.505, 0.2)]), RoomMats.blackMatte(), 'luggage-straps'));
  return g;
}

/** Gold framed leaf artwork (DLX: banana leaves; SUP: wheat). Faces +x. */
export function makeArt(kind: 'banana' | 'wheat'): THREE.Group {
  const g = new THREE.Group();
  g.name = `art-${kind}`;
  const w = kind === 'banana' ? 0.46 : 0.42, h = kind === 'banana' ? 0.7 : 0.72;
  const f = 0.012;
  g.add(mesh(mergeParts([
    boxAt(0, -h / 2, -w / 2, 0.02, h / 2, -w / 2 + f),
    boxAt(0, -h / 2, w / 2 - f, 0.02, h / 2, w / 2),
    boxAt(0, h / 2 - f, -w / 2, 0.02, h / 2, w / 2),
    boxAt(0, -h / 2, -w / 2, 0.02, -h / 2 + f, w / 2),
  ]), RoomMats.gold(), 'art-frame'));
  const leaf = new THREE.PlaneGeometry(w - 0.06, h - 0.06).rotateY(Math.PI / 2);
  const lm = mesh(leaf, RoomMats.goldLeaf(kind), 'art-leaves');
  lm.position.x = 0.012;
  g.add(lm);
  return g;
}

/** Pleated curtains on a rail along +x. `open` 0…1 gathers both panels
 *  toward the ends. Hung in front of a wall facing +z (rail along x). */
export class Curtains {
  readonly group = new THREE.Group();
  private panels: THREE.Mesh[] = [];
  private width: number;
  constructor(width: number, height: number, tone: 'navy' | 'sage') {
    this.width = width;
    this.group.name = `curtains-${tone}`;
    const rail = mesh(new THREE.CylinderGeometry(0.012, 0.012, width + 0.1, 8).rotateZ(Math.PI / 2).translate(width / 2, height + 0.04, 0.02), RoomMats.chrome(), 'curtain-rail');
    this.group.add(rail);
    for (let k = 0; k < 2; k++) {
      const pw = width / 2;
      const segs = 48;
      const geo = new THREE.PlaneGeometry(pw, height, segs, 1);
      const p = geo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const u = (p.getX(i) + pw / 2) / pw;
        p.setXYZ(i, p.getX(i) + pw / 2, p.getY(i) + height / 2, Math.sin(u * Math.PI * 2 * 9) * 0.035 + 0.06);
      }
      geo.computeVertexNormals();
      const m = mesh(geo, RoomMats.curtain(tone), 'curtain-panel');
      this.panels.push(m);
      this.group.add(m);
    }
    this.setOpen(0);
  }

  /** 0 = drawn closed, 1 = gathered open to 20 % stacks at each end. */
  setOpen(open: number): void {
    const s = THREE.MathUtils.lerp(1, 0.2, THREE.MathUtils.clamp(open, 0, 1));
    const [a, b] = this.panels;
    a.scale.x = s;
    a.position.x = 0;
    b.scale.x = s;
    b.position.x = this.width - (this.width / 2) * s;
  }
}

// ---------------------------------------------------------------- ensuite
/** Pedestal basin, faces +x from a wall at x = 0. */
export function makeBasin(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'basin';
  const cer = RoomMats.ceramic();
  const bowl = new THREE.LatheGeometry([new THREE.Vector2(0.0, 0.0), new THREE.Vector2(0.18, 0.02), new THREE.Vector2(0.24, 0.12), new THREE.Vector2(0.25, 0.16), new THREE.Vector2(0.2, 0.15), new THREE.Vector2(0.05, 0.05)], 24);
  bowl.scale(1, 1, 0.8);
  bowl.translate(0.25, 0.68, 0);
  g.add(mesh(bowl, cer, 'basin-bowl'));
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.7, 16).translate(0.2, 0.35, 0), cer, 'basin-pedestal'));
  const tap = mesh(mergeParts([
    new THREE.CylinderGeometry(0.018, 0.022, 0.14, 10).translate(0.07, 0.9, 0),
    new THREE.CylinderGeometry(0.011, 0.011, 0.1, 8).rotateZ(Math.PI / 2).translate(0.12, 0.95, 0),
  ]), RoomMats.chrome(), 'basin-tap');
  g.add(tap);
  return g;
}

export function makeToilet(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'toilet';
  const cer = RoomMats.ceramic();
  g.add(mesh(rbox(0.02, 0.42, -0.22, 0.2, 0.78, 0.22, 0.03), cer, 'cistern'));
  const pan = new THREE.CylinderGeometry(0.19, 0.14, 0.4, 20).scale(1.25, 1, 1).translate(0.4, 0.2, 0);
  g.add(mesh(pan, cer, 'pan'));
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 20).scale(1.25, 1, 1).translate(0.4, 0.415, 0), cer, 'seat'));
  // folded towel over the seat (photos)
  const towel = mesh(cushion(0.5, 0.05, 0.42, 0.3).translate(0.42, 0.45, 0), RoomMats.towel(), 'seat-towel');
  g.add(towel);
  // bidet sprayer on the wall
  g.add(mesh(mergeParts([
    boxAt(0.0, 0.55, 0.28, 0.04, 0.62, 0.3),
    new THREE.CylinderGeometry(0.012, 0.012, 0.12, 8).translate(0.03, 0.66, 0.29),
  ]), RoomMats.chrome(), 'sprayer'));
  return g;
}

/** Hotel towel shelf with a rail below: rolled towels on top, folded below. */
export function makeTowelRack(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'towel-rack';
  const bars: THREE.BufferGeometry[] = [];
  for (const x of [0.06, 0.12, 0.18, 0.22]) bars.push(new THREE.CylinderGeometry(0.006, 0.006, 0.6, 6).rotateX(Math.PI / 2).translate(x, 0, 0));
  bars.push(new THREE.CylinderGeometry(0.008, 0.008, 0.56, 6).rotateX(Math.PI / 2).translate(0.2, -0.16, 0));
  for (const z of [-0.29, 0.29]) bars.push(new THREE.CylinderGeometry(0.01, 0.01, 0.24, 6).rotateZ(Math.PI / 2).translate(0.12, 0, z));
  g.add(mesh(mergeParts(bars), RoomMats.chrome(), 'rack'));
  const towels: THREE.BufferGeometry[] = [];
  for (const z of [-0.12, 0.1]) towels.push(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 14).rotateZ(Math.PI / 2).translate(0.14, 0.07, z));
  for (const z of [-0.1, 0.12]) towels.push(boxAt(0.17, -0.55, z - 0.1, 0.23, -0.15, z + 0.1));
  g.add(mesh(mergeParts(towels), RoomMats.towel(), 'towels'));
  return g;
}

/** Wall switch / socket plate. */
export function makePlate(): THREE.Mesh {
  return mesh(boxAt(0, -0.043, -0.043, 0.012, 0.043, 0.043), RoomMats.white(), 'plate');
}

