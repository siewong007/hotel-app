// Guest-room textures and materials, matched to the owner's photos
// (/salim-inn/rooms/*.jpg, /salim-inn/gallery/*.jpg). The sampled palette is
// ROOM_COLOURS in config/materials.ts (brief §4.5). Everything is generated
// on a canvas: no downloads (brief §4.6).
import * as THREE from 'three';
import { canvas, finish, normalFrom } from '../world/textures';
import { rng } from '../world/geom';
import { BRAND, ROOM_COLOURS } from '../config/materials';

const texCache = new Map<string, THREE.Texture>();
function cached<T extends THREE.Texture>(key: string, make: () => T): T {
  if (!texCache.has(key)) texCache.set(key, make());
  return texCache.get(key) as T;
}

// ---------------------------------------------------------------- floor
/** Laminate planks, 1.2 × 0.2 m, staggered; the texture spans 2.4 × 2.4 m. */
export function laminateTextures(): { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture } {
  const map = cached('lamMap', () => {
    const S = 1024;
    const [c, g] = canvas(S, S);
    const [hc, hg] = canvas(S, S);
    const [rc, rg] = canvas(S, S);
    const r = rng(1203);
    const rows = 16, rowH = S / rows, plank = S / 2; // 0.15 m wide, 1.2 m long
    hg.fillStyle = '#000'; hg.fillRect(0, 0, S, S);
    rg.fillStyle = '#6e6e6e'; rg.fillRect(0, 0, S, S);
    for (let row = 0; row < rows; row++) {
      const off = r() * plank;
      for (let k = -1; k < 3; k++) {
        const x0 = off + k * plank, y0 = row * rowH;
        const tone = 0.82 + r() * 0.3;
        const base = new THREE.Color(ROOM_COLOURS.floor).multiplyScalar(tone).offsetHSL((r() - 0.5) * 0.02, (r() - 0.5) * 0.08, 0);
        g.fillStyle = `#${base.getHexString()}`;
        g.fillRect(x0, y0, plank, rowH);
        // grain: long wavy streaks along the plank
        for (let s = 0; s < 26; s++) {
          const yy = y0 + r() * rowH;
          const dark = r() < 0.6;
          g.strokeStyle = dark ? `rgba(70,38,18,${0.06 + r() * 0.12})` : `rgba(255,226,180,${0.04 + r() * 0.08})`;
          g.lineWidth = 0.6 + r() * 1.8;
          g.beginPath();
          const amp = 1 + r() * 3, ph = r() * 6.28, fr = 0.004 + r() * 0.01;
          for (let x = 0; x <= plank; x += 12) g.lineTo(x0 + x, yy + Math.sin(x * fr + ph) * amp);
          g.stroke();
        }
        // plank faces raised, bevelled edges
        hg.fillStyle = '#fff';
        hg.fillRect(x0 + 2, y0 + 2, plank - 4, rowH - 4);
        rg.fillStyle = `rgb(${128 + r() * 40},${128 + r() * 40},${128 + r() * 40})`;
        rg.fillRect(x0 + 2, y0 + 2, plank - 4, rowH - 4);
        // seams
        g.fillStyle = 'rgba(40,20,10,0.55)';
        g.fillRect(x0, y0, 2, rowH);
      }
      g.fillStyle = 'rgba(40,20,10,0.5)';
      g.fillRect(0, row * rowH, S, 2);
    }
    const t = finish(c, true);
    texCache.set('lamNormal', normalFrom(hc, 3));
    texCache.set('lamRough', finish(rc, false));
    return t;
  });
  return { map, normalMap: texCache.get('lamNormal')!, roughnessMap: texCache.get('lamRough')! };
}

// ---------------------------------------------------------------- bedding
/** Damask-stripe sheets: satin and matte bands ~3.5 cm across the bed. */
export function damaskTextures(): { map: THREE.Texture; roughnessMap: THREE.Texture } {
  const map = cached('damMap', () => {
    const S = 256, bands = 8;
    const [c, g] = canvas(S, S);
    const [rc, rg] = canvas(S, S);
    for (let i = 0; i < bands; i++) {
      const satin = i % 2 === 0;
      g.fillStyle = satin ? '#fdfcf8' : '#efeee9';
      g.fillRect(0, (i * S) / bands, S, S / bands);
      rg.fillStyle = satin ? '#6a6a6a' : '#d0d0d0';
      rg.fillRect(0, (i * S) / bands, S, S / bands);
    }
    // faint weave
    const r = rng(7);
    for (let k = 0; k < 2200; k++) {
      g.fillStyle = `rgba(120,110,95,${r() * 0.03})`;
      g.fillRect(r() * S, r() * S, 1, 1 + r() * 3);
    }
    texCache.set('damRough', finish(rc, false));
    return finish(c, true);
  });
  return { map, roughnessMap: texCache.get('damRough')! };
}

/** Fine fabric weave (normal map) for pillows, curtains, skirts. */
export function weaveNormal(): THREE.Texture {
  return cached('weave', () => {
    const S = 256;
    const [hc, hg] = canvas(S, S);
    const r = rng(33);
    hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 2) for (let x = 0; x < S; x += 2) {
      const v = 110 + ((x / 2 + y / 2) % 2) * 40 + r() * 30;
      hg.fillStyle = `rgb(${v},${v},${v})`;
      hg.fillRect(x, y, 2, 2);
    }
    return normalFrom(hc, 1.2);
  });
}

/** Soft creases for bed linen: blurred random strokes as a height field. */
export function wrinkleNormal(): THREE.Texture {
  return cached('wrinkles', () => {
    const S = 512;
    const [hc, hg] = canvas(S, S);
    const r = rng(91);
    hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S);
    // the strokes on a layer of their own, blurred once as it goes down
    // (blurring each of the 70 strokes as drawn cost ~70 ms)
    const [lc, lg] = canvas(S, S);
    for (let k = 0; k < 70; k++) {
      const x = r() * S, y = r() * S, a = r() * Math.PI, len = 60 + r() * 180;
      lg.strokeStyle = r() < 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)';
      lg.lineWidth = 3 + r() * 8;
      lg.beginPath();
      lg.moveTo(x, y);
      lg.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + (r() - 0.5) * 40, y + Math.sin(a) * len * 0.5 + (r() - 0.5) * 40, x + Math.cos(a) * len, y + Math.sin(a) * len);
      lg.stroke();
    }
    hg.filter = 'blur(6px)';
    hg.drawImage(lc, 0, 0, S, S);
    hg.filter = 'none';
    return normalFrom(hc, 2.5);
  });
}

/** Vertical folds (skirt valances, curtains): a sine height field. */
export function foldNormal(folds = 8): THREE.Texture {
  return cached(`folds${folds}`, () => {
    const S = 256;
    const [hc, hg] = canvas(S, S);
    for (let x = 0; x < S; x++) {
      const v = 128 + 110 * Math.sin((x / S) * folds * Math.PI * 2) * (0.7 + 0.3 * Math.sin((x / S) * 3.1 * Math.PI));
      hg.fillStyle = `rgb(${v},${v},${v})`;
      hg.fillRect(x, 0, 1, S);
    }
    return normalFrom(hc, 2.2);
  });
}

// ---------------------------------------------------------------- headboards
export type HeadStyle = 'tufted' | 'goldPiping' | 'whiteStripes' | 'thinStripes' | 'channel';

/** Headboard face textures (map + normal), drawn for a 2:1 panel. */
export function headboardTextures(style: HeadStyle): { map: THREE.Texture; normalMap: THREE.Texture } {
  const key = `head-${style}`;
  const map = cached(key, () => {
    const W = 1024, H = 384;
    const [c, g] = canvas(W, H);
    const [hc, hg] = canvas(W, H);
    const base = new THREE.Color(
      style === 'tufted' ? ROOM_COLOURS.headDLX
        : style === 'goldPiping' ? ROOM_COLOURS.headSUP
          : style === 'whiteStripes' ? ROOM_COLOURS.headFRKing
            : style === 'thinStripes' ? ROOM_COLOURS.headFRSingle
              : ROOM_COLOURS.headFS,
    );
    g.fillStyle = `#${base.getHexString()}`;
    g.fillRect(0, 0, W, H);
    hg.fillStyle = '#888'; hg.fillRect(0, 0, W, H);
    const r = rng(style.length * 17 + 3);
    // leather / vinyl sheen mottling
    for (let k = 0; k < 900; k++) {
      g.fillStyle = `rgba(255,255,255,${r() * 0.025})`;
      g.beginPath(); g.arc(r() * W, r() * H, 2 + r() * 10, 0, 6.3); g.fill();
    }
    const pillow = (x0: number, y0: number, w: number, h: number) => {
      // puffy cushion: radial height falloff
      const grd = hg.createRadialGradient(x0 + w / 2, y0 + h / 2, 2, x0 + w / 2, y0 + h / 2, Math.max(w, h) * 0.72);
      grd.addColorStop(0, '#f4f4f4'); grd.addColorStop(0.7, '#b0b0b0'); grd.addColorStop(1, '#303030');
      hg.fillStyle = grd; hg.fillRect(x0, y0, w, h);
    };
    if (style === 'tufted') {
      const cols = 8, rows = 3;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const x0 = (i * W) / cols, y0 = (j * H) / rows, cw = W / cols, ch = H / rows;
        pillow(x0, y0, cw, ch);
        // leather crown catching the light, darker toward the seams
        const lg = g.createRadialGradient(x0 + cw * 0.45, y0 + ch * 0.4, 2, x0 + cw / 2, y0 + ch / 2, cw * 0.7);
        lg.addColorStop(0, 'rgba(120,128,126,0.55)'); lg.addColorStop(0.6, 'rgba(60,66,65,0.2)'); lg.addColorStop(1, 'rgba(0,0,0,0.35)');
        g.fillStyle = lg; g.fillRect(x0, y0, cw, ch);
      }
      g.strokeStyle = 'rgba(0,0,0,0.85)'; g.lineWidth = 5;
      for (let i = 0; i <= cols; i++) { g.beginPath(); g.moveTo((i * W) / cols, 0); g.lineTo((i * W) / cols, H); g.stroke(); }
      for (let j = 0; j <= rows; j++) { g.beginPath(); g.moveTo(0, (j * H) / rows); g.lineTo(W, (j * H) / rows); g.stroke(); }
    } else if (style === 'channel') {
      const cols = 6;
      for (let i = 0; i < cols; i++) {
        pillow((i * W) / cols, 0, W / cols, H);
        const lg = g.createLinearGradient((i * W) / cols, 0, ((i + 1) * W) / cols, 0);
        lg.addColorStop(0, 'rgba(0,0,0,0.25)'); lg.addColorStop(0.45, 'rgba(255,250,220,0.18)'); lg.addColorStop(1, 'rgba(0,0,0,0.25)');
        g.fillStyle = lg; g.fillRect((i * W) / cols, 0, W / cols, H);
      }
      g.strokeStyle = 'rgba(30,28,22,0.9)'; g.lineWidth = 5;
      for (let i = 1; i < cols; i++) { g.beginPath(); g.moveTo((i * W) / cols, 0); g.lineTo((i * W) / cols, H); g.stroke(); }
    } else {
      // smooth panel with piping / stripes near the ends
      const grd = hg.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, '#6a6a6a'); grd.addColorStop(0.15, '#d8d8d8'); grd.addColorStop(0.85, '#d8d8d8'); grd.addColorStop(1, '#6a6a6a');
      hg.fillStyle = grd; hg.fillRect(0, 0, W, H);
      const stripe = (x: number, w: number, colour: string) => { g.fillStyle = colour; g.fillRect(x - w / 2, 0, w, H); };
      if (style === 'whiteStripes') {
        for (const x of [0.07, 0.1, 0.13, 0.87, 0.9, 0.93]) stripe(x * W, 12, '#e9e9e6');
      } else if (style === 'thinStripes') {
        for (const x of [0.3, 0.7]) stripe(x * W, 5, '#b9b3a8');
      } else {
        for (const x of [0.28, 0.72]) stripe(x * W, 5, '#c9a55a');
      }
    }
    texCache.set(`${key}-n`, normalFrom(hc, style === 'tufted' || style === 'channel' ? 4 : 1.5));
    const t = finish(c, true, false);
    return t;
  });
  return { map, normalMap: texCache.get(`${key}-n`)! };
}

/** Quilted divan fabric (SUP, FS): wavy stitch lines 6 cm apart, puffed
 *  between. One texture = 0.5 m (the divan has metric UVs). */
export function chevronTextures(): { map: THREE.Texture; normalMap: THREE.Texture } {
  const map = cached('chev', () => {
    const S = 256, gap = 32, wl = 64, amp = 7;
    const [c, g] = canvas(S, S);
    const [hc, hg] = canvas(S, S);
    g.fillStyle = `#${new THREE.Color(ROOM_COLOURS.divan).getHexString()}`;
    g.fillRect(0, 0, S, S);
    // puff: bright mid-way between stitch lines (written as pixels: the same
    // 2×1 cells the canvas calls drew, without 32,768 of them)
    const puff = hg.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x += 2) {
        const off = amp * Math.sin((2 * Math.PI * x) / wl);
        const f = (((y - off) % gap) + gap) % gap / gap;
        const v = Math.round(90 + 150 * Math.sin(Math.PI * f));
        for (const i of [(y * S + x) * 4, (y * S + x + 1) * 4]) {
          puff.data[i] = puff.data[i + 1] = puff.data[i + 2] = v;
          puff.data[i + 3] = 255;
        }
      }
    }
    hg.putImageData(puff, 0, 0);
    for (let y0 = 0; y0 < S + gap; y0 += gap) {
      for (const [ctx, style, lw] of [[g, 'rgba(92,84,68,0.42)', 1.4], [hg, '#202020', 2.5]] as const) {
        ctx.strokeStyle = style;
        ctx.lineWidth = lw;
        ctx.beginPath();
        for (let x = 0; x <= S; x += 4) ctx.lineTo(x, y0 + amp * Math.sin((2 * Math.PI * x) / wl));
        ctx.stroke();
      }
    }
    const t = finish(c, true);
    t.repeat.set(2, 2);
    const n = normalFrom(hc, 1.6);
    n.repeat.set(2, 2);
    texCache.set('chev-n', n);
    return t;
  });
  return { map, normalMap: texCache.get('chev-n')! };
}

// ---------------------------------------------------------------- joinery & finishes
/** Pale pink-beige wood-grain laminate (wardrobe, desk, bedside tables). */
export function woodLaminate(): THREE.Texture {
  return cached('wood', () => {
    const S = 512;
    const [c, g] = canvas(S, S);
    const r = rng(512);
    g.fillStyle = `#${new THREE.Color(ROOM_COLOURS.laminate).getHexString()}`;
    g.fillRect(0, 0, S, S);
    for (let k = 0; k < 160; k++) {
      const x = r() * S;
      g.strokeStyle = `rgba(150,110,90,${0.04 + r() * 0.1})`;
      g.lineWidth = 0.5 + r() * 2.5;
      g.beginPath();
      for (let y = 0; y <= S; y += 16) g.lineTo(x + Math.sin(y * 0.02 + k) * 3, y);
      g.stroke();
    }
    return finish(c, true);
  });
}

/** Ceramic tiles with grout: wall 30×60 cm landscape, floor 40×40 cm. 1 tex = 1.2 m. */
export function tileTexture(kind: 'wall' | 'floor'): THREE.Texture {
  return cached(`tile-${kind}`, () => {
    const S = 512;
    const [c, g] = canvas(S, S);
    const r = rng(kind === 'wall' ? 61 : 62);
    const grout = kind === 'wall' ? '#b7b0a5' : '#3a312a';
    const face = new THREE.Color(kind === 'wall' ? ROOM_COLOURS.tileWall : ROOM_COLOURS.tileFloor);
    g.fillStyle = grout; g.fillRect(0, 0, S, S);
    const tw = kind === 'wall' ? S / 2 : S / 3, th = kind === 'wall' ? S / 4 : S / 3; // 0.6×0.3 / 0.4×0.4 of 1.2 m
    for (let y = 0; y < S; y += th) for (let x = 0; x < S; x += tw) {
      g.fillStyle = `#${face.clone().multiplyScalar(0.94 + r() * 0.1).getHexString()}`;
      g.fillRect(x + 2, y + 2, tw - 4, th - 4);
    }
    return finish(c, true);
  });
}

/** Gold leaf artwork (alpha): banana leaves (DLX) or a wheat spray (SUP). */
export function leafArt(kind: 'banana' | 'wheat'): THREE.Texture {
  return cached(`art-${kind}`, () => {
    const W = 256, H = 384;
    const [c, g] = canvas(W, H);
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#fff';
    g.strokeStyle = '#fff';
    const leaf = (x: number, y: number, len: number, wid: number, rot: number) => {
      g.save(); g.translate(x, y); g.rotate(rot);
      g.beginPath(); g.moveTo(0, 0);
      g.quadraticCurveTo(wid, -len * 0.5, 0, -len);
      g.quadraticCurveTo(-wid, -len * 0.5, 0, 0);
      g.fill(); g.restore();
    };
    if (kind === 'banana') {
      leaf(118, 300, 250, 60, -0.28);
      leaf(146, 300, 230, 52, 0.22);
      g.lineWidth = 4; g.beginPath(); g.moveTo(128, 300); g.lineTo(128, 360); g.stroke();
    } else {
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(128, 360); g.quadraticCurveTo(122, 200, 138, 60); g.stroke();
      for (let k = 0; k < 11; k++) {
        const t = k / 11, y = 330 - t * 260, x = 126 + Math.sin(t * 2) * 6;
        leaf(x, y, 60 - t * 25, 11, -0.9);
        leaf(x, y, 60 - t * 25, 11, 0.9);
      }
    }
    return finish(c, false, false);
  });
}

// ---------------------------------------------------------------- materials
const matCache = new Map<string, THREE.Material>();
function mat<T extends THREE.Material>(key: string, make: () => T): T {
  if (!matCache.has(key)) matCache.set(key, make());
  return matCache.get(key) as T;
}

export const RoomMats = {
  wall: () => mat('wall', () => new THREE.MeshStandardMaterial({ color: ROOM_COLOURS.wall, roughness: 0.92 })),
  ceiling: () => mat('ceiling', () => new THREE.MeshStandardMaterial({ color: ROOM_COLOURS.ceiling, roughness: 0.95 })),
  skirting: () => mat('skirting', () => new THREE.MeshStandardMaterial({ color: ROOM_COLOURS.skirting, roughness: 0.5 })),
  floor: () => mat('floor', () => {
    const t = laminateTextures();
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, roughness: 1, envMapIntensity: 0.9 });
    m.normalScale.set(0.6, 0.6);
    return m;
  }),
  sheet: () => mat('sheet', () => {
    const t = damaskTextures();
    return new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: t.map, roughnessMap: t.roughnessMap, roughness: 1, sheen: 0.55, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xffffff), normalMap: wrinkleNormal(), normalScale: new THREE.Vector2(0.55, 0.55) });
  }),
  pillow: () => mat('pillow', () => new THREE.MeshPhysicalMaterial({ color: ROOM_COLOURS.pillow, roughness: 0.78, sheen: 0.7, sheenRoughness: 0.4, sheenColor: new THREE.Color(0xffffff), normalMap: weaveNormal(), normalScale: new THREE.Vector2(0.3, 0.3) })),
  // brand forest green (brief §4.5: "bed runner in brand forest green")
  runner: () => mat('runner', () => new THREE.MeshPhysicalMaterial({ color: BRAND.forest, roughness: 0.8, sheen: 0.22, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x24503f), normalMap: weaveNormal() })),
  headboard: (style: HeadStyle) => mat(`hb-${style}`, () => {
    const t = headboardTextures(style);
    const leather = style === 'tufted' || style === 'whiteStripes';
    return new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: t.map, normalMap: t.normalMap, roughness: leather ? 0.42 : 0.7, clearcoat: leather ? 0.25 : 0, clearcoatRoughness: 0.5, sheen: leather ? 0 : 0.4, sheenColor: new THREE.Color(0xffffff) });
  }),
  headboardSide: (style: HeadStyle) => mat(`hbs-${style}`, () => {
    const c = style === 'tufted' ? ROOM_COLOURS.headDLX : style === 'goldPiping' ? ROOM_COLOURS.headSUP : style === 'whiteStripes' ? ROOM_COLOURS.headFRKing : style === 'thinStripes' ? ROOM_COLOURS.headFRSingle : ROOM_COLOURS.headFS;
    return new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 });
  }),
  skirt: () => mat('skirt', () => {
    // pleats are in the geometry; a faint weave on top
    const m = new THREE.MeshPhysicalMaterial({ color: ROOM_COLOURS.skirt, roughness: 0.88, sheen: 0.18, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x8e5a42), normalMap: weaveNormal(), side: THREE.DoubleSide });
    m.normalScale.set(0.25, 0.25);
    return m;
  }),
  divan: () => mat('divan', () => {
    const t = chevronTextures();
    return new THREE.MeshStandardMaterial({ color: 0xffffff, map: t.map, normalMap: t.normalMap, roughness: 0.88 });
  }),
  curtain: (tone: 'navy' | 'sage') => mat(`curtain-${tone}`, () => new THREE.MeshPhysicalMaterial({
    color: tone === 'navy' ? ROOM_COLOURS.navy : ROOM_COLOURS.sage, roughness: 0.82, sheen: 0.6, sheenRoughness: 0.5,
    sheenColor: new THREE.Color(tone === 'navy' ? 0x56708f : 0x9cc0aa), normalMap: weaveNormal(), normalScale: new THREE.Vector2(0.4, 0.4), side: THREE.DoubleSide,
  })),
  laminate: () => mat('laminate', () => new THREE.MeshStandardMaterial({ color: 0xffffff, map: woodLaminate(), roughness: 0.55 })),
  gold: () => mat('gold', () => new THREE.MeshStandardMaterial({ color: 0xd2a643, roughness: 0.3, metalness: 0.75, envMapIntensity: 1.6 })),
  goldLeaf: (kind: 'banana' | 'wheat') => mat(`leaf-${kind}`, () => new THREE.MeshStandardMaterial({ color: 0xd8ad45, roughness: 0.32, metalness: 0.7, envMapIntensity: 1.6, alphaMap: leafArt(kind), alphaTest: 0.5, side: THREE.DoubleSide })),
  chrome: () => mat('chrome', () => new THREE.MeshStandardMaterial({ color: 0xe8ecee, roughness: 0.12, metalness: 1 })),
  ceramic: () => mat('ceramic', () => new THREE.MeshPhysicalMaterial({ color: 0xf7f7f4, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08 })),
  mirror: () => mat('mirror', () => new THREE.MeshStandardMaterial({ color: 0xeef3f4, roughness: 0.02, metalness: 1, envMapIntensity: 2.2 })),
  frosted: () => mat('frosted', () => new THREE.MeshPhysicalMaterial({ color: ROOM_COLOURS.frosted, roughness: 0.45, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide })),
  tileWall: () => mat('tileWall', () => new THREE.MeshStandardMaterial({ color: 0xffffff, map: tileTexture('wall'), roughness: 0.25 })),
  tileFloor: () => mat('tileFloor', () => new THREE.MeshStandardMaterial({ color: 0xffffff, map: tileTexture('floor'), roughness: 0.35 })),
  plasticGreen: () => mat('plasticGreen', () => new THREE.MeshStandardMaterial({ color: ROOM_COLOURS.chairGreen, roughness: 0.45 })),
  blackGloss: () => mat('blackGloss', () => new THREE.MeshStandardMaterial({ color: 0x0b0c0d, roughness: 0.15, metalness: 0.2 })),
  blackMatte: () => mat('blackMatte', () => new THREE.MeshStandardMaterial({ color: 0x1a1b1c, roughness: 0.6 })),
  acCream: () => mat('acCream', () => new THREE.MeshStandardMaterial({ color: ROOM_COLOURS.acCream, roughness: 0.5 })),
  phone: () => mat('phone', () => new THREE.MeshStandardMaterial({ color: ROOM_COLOURS.phone, roughness: 0.45 })),
  white: () => mat('whiteGloss', () => new THREE.MeshStandardMaterial({ color: 0xf3f2ee, roughness: 0.35 })),
  towel: () => mat('towel', () => new THREE.MeshPhysicalMaterial({ color: 0xfbfaf7, roughness: 0.95, sheen: 1, sheenRoughness: 0.9, sheenColor: new THREE.Color(0xffffff), normalMap: weaveNormal(), normalScale: new THREE.Vector2(0.8, 0.8) })),
  showerCurtain: (tone: 'blue' | 'white') => mat(`shower-${tone}`, () => new THREE.MeshStandardMaterial({ color: tone === 'blue' ? ROOM_COLOURS.showerBlue : ROOM_COLOURS.showerWhite, roughness: 0.7, normalMap: foldNormal(14), side: THREE.DoubleSide })),
  bottle: () => mat('bottle', () => new THREE.MeshPhysicalMaterial({ color: 0xcfe6f2, roughness: 0.08, transparent: true, opacity: 0.55, depthWrite: false })),
  bin: () => mat('bin', () => new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.55 })),
};
