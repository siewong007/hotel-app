// Public-area finishes: lobby, reservation counter, stair and the level-1
// corridor. No reception, stair or corridor photo exists (flagged in
// OPEN_QUESTIONS), so these are designed rather than sampled: the stone of
// the facade's lobby wall, the timber and brass of the rooms, and the brand's
// forest green and gold (brief §4.4: "the most 'hospitality' moment — give it
// the richest materials"). The palette is PUBLIC_COLOURS in config/materials.ts.
// Everything is generated on a canvas (brief §4.6).
import * as THREE from 'three';
import { canvas, finish, normalFrom, stoneCladding } from '../world/textures';
import { rng } from '../world/geom';
import { BRAND, PUBLIC_COLOURS } from '../config/materials';

const texCache = new Map<string, THREE.Texture>();
function cached<T extends THREE.Texture>(key: string, make: () => T): T {
  if (!texCache.has(key)) texCache.set(key, make());
  return texCache.get(key) as T;
}
const hex = (c: number, k = 1) => `#${new THREE.Color(c).multiplyScalar(k).getHexString()}`;
/** Soft light textures skip mipmaps: at grazing angles a mip level averages
 *  a wash across its whole width, turning a soft cone into a hard-edged band. */
function noMips<T extends THREE.Texture>(t: T): T {
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter;
  return t;
}

// ---------------------------------------------------------------- floors
/** Polished 800 mm porcelain with soft veining; one texture = 1.6 m. */
export function porcelainTextures(): { map: THREE.Texture; roughnessMap: THREE.Texture; normalMap: THREE.Texture } {
  const map = cached('porc', () => {
    const S = 1024, T = S / 2;
    const [c, g] = canvas(S, S);
    const [rc, rg] = canvas(S, S);
    const [hc, hg] = canvas(S, S);
    const r = rng(808);
    g.fillStyle = hex(PUBLIC_COLOURS.grout);
    g.fillRect(0, 0, S, S);
    rg.fillStyle = '#b4b4b4'; rg.fillRect(0, 0, S, S);
    hg.fillStyle = '#000'; hg.fillRect(0, 0, S, S);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const x0 = i * T + 2, y0 = j * T + 2, w = T - 4;
      g.fillStyle = hex(PUBLIC_COLOURS.tile, 0.97 + r() * 0.05);
      g.fillRect(x0, y0, w, w);
      g.save();
      g.beginPath(); g.rect(x0, y0, w, w); g.clip();
      // cloudy tone and a few soft veins
      for (let k = 0; k < 6; k++) {
        const gr = g.createRadialGradient(x0 + r() * w, y0 + r() * w, 0, x0 + r() * w, y0 + r() * w, 80 + r() * 200);
        gr.addColorStop(0, `rgba(${r() > 0.5 ? '255,250,240' : '190,175,150'},0.10)`);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(x0, y0, w, w);
      }
      for (let v = 0; v < 3; v++) {
        const x = x0 + r() * w, y = y0 - 10, a = 1.2 + r() * 0.6;
        for (const [lw, al] of [[9, 0.03], [4, 0.05], [1.4, 0.1]] as const) {
          g.strokeStyle = `rgba(150,136,116,${al})`;
          g.lineWidth = lw;
          g.beginPath();
          let xx = x, yy = y, aa = a;
          const rr = rng(Math.floor(x * 13 + y)); // same path for each pass
          g.moveTo(xx, yy);
          for (let s = 0; s < 70; s++) { aa += (rr() - 0.5) * 0.5; xx += Math.cos(aa) * 9; yy += Math.sin(aa) * 9; g.lineTo(xx, yy); }
          g.stroke();
        }
      }
      g.restore();
      rg.fillStyle = '#2a2a2a'; rg.fillRect(x0, y0, w, w); // polished
      hg.fillStyle = '#fff'; hg.fillRect(x0, y0, w, w);
    }
    texCache.set('porcR', finish(rc, false));
    texCache.set('porcN', normalFrom(hc, 2));
    return finish(c, true);
  });
  return { map, roughnessMap: texCache.get('porcR')!, normalMap: texCache.get('porcN')! };
}

/** Terrazzo stair treads: ivory ground, grey, black and ochre chips. 1 tex = 1 m. */
export function terrazzoTexture(): THREE.Texture {
  return cached('terrazzo', () => {
    const S = 512;
    const [c, g] = canvas(S, S);
    const r = rng(47);
    g.fillStyle = hex(PUBLIC_COLOURS.terrazzo);
    g.fillRect(0, 0, S, S);
    const chips = ['#8d887f', '#5c5750', '#2a2826', '#b9a27a', '#f4f1ea', '#a39e95'];
    for (let k = 0; k < 2600; k++) {
      const x = r() * S, y = r() * S, s = 1 + r() * r() * 7;
      g.fillStyle = chips[Math.floor(r() * chips.length)];
      g.beginPath();
      const n = 4 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r() * 0.6;
        g.lineTo(x + Math.cos(a) * s * (0.6 + r() * 0.6), y + Math.sin(a) * s * (0.6 + r() * 0.6));
      }
      g.fill();
    }
    return finish(c, true);
  });
}

/** Corridor carpet: forest-green ground, a tone-on-tone trellis and small
 *  gold dots where it crosses, over a fine pile. One texture = 0.8 m. */
export function carpetTextures(): { map: THREE.Texture; normalMap: THREE.Texture } {
  const map = cached('carpet', () => {
    const S = 512, cell = S / 4;
    const [c, g] = canvas(S, S);
    const [hc, hg] = canvas(S, S);
    const r = rng(3);
    g.fillStyle = hex(PUBLIC_COLOURS.carpetField);
    g.fillRect(0, 0, S, S);
    hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S);
    // ogee trellis: two families of sine curves
    g.strokeStyle = hex(PUBLIC_COLOURS.carpetMotif);
    g.lineWidth = 7;
    for (let k = -1; k <= 4; k++) {
      for (const dir of [1, -1]) {
        g.beginPath();
        for (let y = 0; y <= S; y += 4) g.lineTo(k * cell + (dir * cell * 0.5 * Math.sin((y / cell) * Math.PI)) + cell / 2, y);
        g.stroke();
      }
    }
    g.fillStyle = hex(PUBLIC_COLOURS.carpetGold);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      g.beginPath(); g.arc(i * cell + cell / 2, j * cell, 5, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(i * cell, j * cell + cell / 2, 3, 0, Math.PI * 2); g.fill();
    }
    // pile: speckle in colour and height — gathered into one path per style
    // and filled once (32,000 separate fills with a style change each were
    // the slowest texture in the interior)
    const light: number[] = [], dark: number[] = [];
    const byHeight = new Map<number, number[]>();
    for (let k = 0; k < 16000; k++) {
      const x = r() * S, y = r() * S;
      (r() > 0.5 ? light : dark).push(x, y);
      const v = Math.floor(90 + r() * 90);
      const list = byHeight.get(v) ?? [];
      list.push(x, y);
      byHeight.set(v, list);
    }
    const speckles = (ctx: CanvasRenderingContext2D, style: string, xy: number[]) => {
      ctx.fillStyle = style;
      ctx.beginPath();
      for (let i = 0; i < xy.length; i += 2) ctx.rect(xy[i], xy[i + 1], 1.5, 1.5);
      ctx.fill();
    };
    speckles(g, 'rgba(255,255,255,0.035)', light);
    speckles(g, 'rgba(0,0,0,0.06)', dark);
    for (const [v, xy] of byHeight) speckles(hg, `rgb(${v},${v},${v})`, xy);
    texCache.set('carpetN', normalFrom(hc, 1.2));
    return finish(c, true);
  });
  return { map, normalMap: texCache.get('carpetN')! };
}

// ---------------------------------------------------------------- joinery & stone
/** Fluted walnut: 3 cm vertical flutes with the grain running along them.
 *  One texture = 0.48 m square (16 flutes). */
export function walnutTextures(): { map: THREE.Texture; normalMap: THREE.Texture } {
  const map = cached('walnut', () => {
    const S = 512, n = 16, fw = S / n;
    const [c, g] = canvas(S, S);
    const [hc, hg] = canvas(S, S);
    const r = rng(19);
    g.fillStyle = hex(PUBLIC_COLOURS.walnut);
    g.fillRect(0, 0, S, S);
    for (let k = 0; k < 220; k++) {
      const x = r() * S;
      g.strokeStyle = r() < 0.65 ? `rgba(35,20,10,${0.08 + r() * 0.16})` : `rgba(190,140,95,${0.05 + r() * 0.1})`;
      g.lineWidth = 0.6 + r() * 2.4;
      g.beginPath();
      const ph = r() * 6.28, amp = 1 + r() * 4;
      for (let y = 0; y <= S; y += 8) g.lineTo(x + Math.sin(y * 0.013 + ph) * amp, y);
      g.stroke();
    }
    // flutes: rounded profile (height) and a soft shade in the grooves
    for (let i = 0; i < n; i++) {
      for (let x = 0; x < fw; x++) {
        const t = x / fw;
        const h = Math.sqrt(Math.max(0, 1 - Math.pow(2 * t - 1, 2)));
        const v = Math.round(40 + 215 * h);
        hg.fillStyle = `rgb(${v},${v},${v})`;
        hg.fillRect(i * fw + x, 0, 1, S);
        if (h < 0.35) { g.fillStyle = `rgba(20,10,5,${0.16 * (1 - h / 0.35)})`; g.fillRect(i * fw + x, 0, 1, S); }
      }
    }
    texCache.set('walnutN', normalFrom(hc, 3.2));
    return finish(c, true);
  });
  return { map, normalMap: texCache.get('walnutN')! };
}

/** Plain walnut veneer (grain only) for ends, doors and trims. 1 tex = 1 m. */
export function veneerTexture(tone: number, seed = 23): THREE.Texture {
  return cached(`veneer-${tone}-${seed}`, () => {
    const S = 512;
    const [c, g] = canvas(S, S);
    const r = rng(seed);
    g.fillStyle = hex(tone);
    g.fillRect(0, 0, S, S);
    for (let k = 0; k < 200; k++) {
      const x = r() * S;
      g.strokeStyle = r() < 0.6 ? `rgba(30,18,8,${0.04 + r() * 0.08})` : `rgba(200,150,105,${0.03 + r() * 0.05})`;
      g.lineWidth = 0.6 + r() * 2.2;
      g.beginPath();
      const ph = r() * 6.28, amp = 2 + r() * 8;
      for (let y = 0; y <= S; y += 8) g.lineTo(x + Math.sin(y * 0.01 + ph) * amp + Math.sin(y * 0.043 + ph * 2) * 1.5, y);
      g.stroke();
    }
    return finish(c, true);
  });
}

/** Warm white marble with grey veins (counter top). One texture = 1.2 × 0.6 m. */
export function marbleTexture(): THREE.Texture {
  return cached('marble', () => {
    const W = 1024, H = 512;
    const [c, g] = canvas(W, H);
    const r = rng(1311);
    g.fillStyle = hex(PUBLIC_COLOURS.marble);
    g.fillRect(0, 0, W, H);
    for (let k = 0; k < 14; k++) {
      const gr = g.createRadialGradient(r() * W, r() * H, 0, r() * W, r() * H, 60 + r() * 220);
      gr.addColorStop(0, r() > 0.5 ? 'rgba(255,253,248,0.35)' : 'rgba(205,196,182,0.22)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
    const vein = (x: number, y: number, a: number, len: number, main: boolean) => {
      for (const [lw, al] of (main ? [[10, 0.03], [5, 0.07], [1.8, 0.28]] : [[3, 0.04], [0.9, 0.2]]) as [number, number][]) {
        const rr = rng(Math.floor(x * 7 + y * 3 + len));
        let xx = x, yy = y, aa = a;
        g.strokeStyle = `rgba(118,110,100,${al})`;
        g.lineWidth = lw;
        g.beginPath();
        g.moveTo(xx, yy);
        for (let s = 0; s < len; s++) { aa += (rr() - 0.5) * 0.45; xx += Math.cos(aa) * 6; yy += Math.sin(aa) * 6; g.lineTo(xx, yy); }
        g.stroke();
      }
    };
    for (let k = 0; k < 5; k++) vein(r() * W * 0.3 - 60, r() * H, -0.35 + r() * 0.5, 170 + r() * 60, true);
    for (let k = 0; k < 16; k++) vein(r() * W, r() * H, r() * 6.28, 20 + r() * 50, false);
    return finish(c, true);
  });
}

/** The facade's stacked stone, for the wall behind the counter. */
export function featureStone(): { map: THREE.Texture; normalMap: THREE.Texture } {
  return stoneCladding();
}

// ---------------------------------------------------------------- graphics
/** Soft radial glow (alpha in the colour, for additive washes). */
export function glowTexture(): THREE.Texture {
  return cached('glow', () => {
    const S = 256;
    const [c, g] = canvas(S, S);
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.42)');
    gr.addColorStop(0.7, 'rgba(255,255,255,0.1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
    return noMips(finish(c, true, false));
  });
}

/** Wall-sconce wash: a light cone up and down the wall from the fitting. */
export function sconceWash(): THREE.Texture {
  return cached('sconceWash', () => {
    const W = 128, H = 256;
    const [c, g] = canvas(W, H);
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = Math.abs(y - H / 2) / (H / 2); // 0 at the fitting
      const spread = 0.18 + 0.82 * v; // the cone widens away from it
      const u = Math.abs(x - W / 2) / (W / 2) / spread;
      const a = Math.max(0, 1 - u * u) * Math.pow(1 - v, 1.6) * (0.55 + 0.45 * v);
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(255 * Math.min(1, a * 1.4));
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return noMips(finish(c, true, false));
  });
}

/** Downlight scallop on a wall: bright under the fitting, a cone widening
 *  and fading downwards. */
export function scallopWash(): THREE.Texture {
  return cached('scallop', () => {
    const W = 128, H = 256;
    const [c, g] = canvas(W, H);
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = y / H; // 0 at the ceiling
      const spread = 0.12 + 0.88 * Math.sqrt(v);
      const u = Math.abs(x - W / 2) / (W / 2) / spread;
      const edge = Math.max(0, 1 - u * u);
      const a = edge * Math.pow(1 - v, 1.3) * Math.min(1, v * 9);
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(255 * Math.min(1, a));
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return noMips(finish(c, true, false));
  });
}

/** Linear falloff across a strip (cove light spreading over the ceiling). */
export function stripWash(): THREE.Texture {
  return cached('stripWash', () => {
    const [c, g] = canvas(8, 128);
    const gr = g.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 8, 128);
    const t = finish(c, true, false);
    t.wrapS = THREE.RepeatWrapping;
    return noMips(t);
  });
}

/** Backlight halo for the wall letters: the word's glow on the stone. */
export function haloTexture(text: string): THREE.Texture {
  return cached(`halo-${text}`, () => {
    const W = 1024, H = 256;
    const [c, g] = canvas(W, H);
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    // draw the word off-canvas and keep only its blurred shadow
    // (shadowBlur works in every browser; ctx.filter does not)
    g.font = `800 ${H * 0.62}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const sx = Math.min(1, (W * 0.84) / g.measureText(text).width);
    for (const [blur, col] of [[46, 'rgba(255,190,150,0.9)'], [16, 'rgba(255,225,200,0.9)']] as const) {
      g.save();
      g.shadowColor = col;
      g.shadowBlur = blur;
      g.shadowOffsetX = W * 4;
      g.translate(W / 2 - W * 4, H / 2);
      g.scale(sx, 1);
      g.fillStyle = '#fff';
      g.fillText(text, 0, 0);
      g.restore();
    }
    return noMips(finish(c, true, false));
  });
}

/** Clock dial: ivory face, black batons, brass rim drawn separately. */
export function clockFace(): THREE.Texture {
  return cached('clock', () => {
    const S = 512;
    const [c, g] = canvas(S, S);
    g.fillStyle = '#f6f2ea';
    g.fillRect(0, 0, S, S);
    g.translate(S / 2, S / 2);
    for (let i = 0; i < 60; i++) {
      g.save();
      g.rotate((i / 60) * Math.PI * 2);
      g.fillStyle = '#1b1b1b';
      if (i % 5 === 0) g.fillRect(-7, -S * 0.46, 14, 48);
      else g.fillRect(-2, -S * 0.46, 4, 16);
      g.restore();
    }
    g.fillStyle = '#1b1b1b';
    g.font = `600 ${S * 0.1}px "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('SIBU', 0, S * 0.2);
    return finish(c, true, false);
  });
}

/** Brass-on-walnut room-number plaque. */
export function plaqueTexture(n: number): THREE.Texture {
  return cached(`plaque-${n}`, () => {
    const W = 256, H = 128;
    const [c, g] = canvas(W, H);
    g.fillStyle = '#2e1f15';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = hex(BRAND.gold, 0.9);
    g.lineWidth = 4;
    g.strokeRect(8, 8, W - 16, H - 16);
    g.fillStyle = hex(BRAND.gold);
    g.font = `600 ${H * 0.58}px "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), W / 2, H / 2 + 4);
    return finish(c, true, false);
  });
}

/** The registration card on the counter: live facts from the site config
 *  (brief §3 ch. 5 — its DOM twin becomes the booking panel in chapter 8). */
export function registrationCard(lines: { title: string; rows: string[]; foot: string }): THREE.Texture {
  return cached(`card-${lines.rows.join('|')}`, () => {
    const W = 1024, H = 724;
    const [c, g] = canvas(W, H);
    g.fillStyle = '#fbf8f1';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = hex(BRAND.gold);
    g.lineWidth = 6;
    g.strokeRect(26, 26, W - 52, H - 52);
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.fillStyle = hex(BRAND.signalRed);
    g.font = `800 96px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
    g.fillText(lines.title, W / 2, 150);
    g.fillStyle = hex(BRAND.gold, 0.85);
    g.fillRect(W / 2 - 120, 180, 240, 4);
    g.fillStyle = '#1d2a25';
    g.font = `600 64px "Helvetica Neue", Arial, sans-serif`;
    lines.rows.forEach((row, i) => g.fillText(row, W / 2, 300 + i * 110));
    g.fillStyle = '#5a5a55';
    g.font = `400 34px "Helvetica Neue", Arial, sans-serif`;
    g.fillText(lines.foot, W / 2, H - 70);
    const t = finish(c, true, false);
    t.anisotropy = 16;
    return t;
  });
}

// ---------------------------------------------------------------- materials
const matCache = new Map<string, THREE.Material>();
function mat<T extends THREE.Material>(key: string, make: () => T): T {
  if (!matCache.has(key)) matCache.set(key, make());
  return matCache.get(key) as T;
}

export const PublicMats = {
  porcelain: () => mat('porcelain', () => {
    const t = porcelainTextures();
    for (const x of [t.map, t.roughnessMap, t.normalMap]) x.repeat.set(1 / 1.6, 1 / 1.6);
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, map: t.map, roughnessMap: t.roughnessMap, normalMap: t.normalMap, roughness: 0.6, envMapIntensity: 1.3 });
    m.normalScale.set(0.6, 0.6);
    return m;
  }),
  terrazzo: () => mat('terrazzo', () => new THREE.MeshStandardMaterial({ color: 0xffffff, map: terrazzoTexture(), roughness: 0.38 })),
  carpet: () => mat('carpet', () => {
    const t = carpetTextures();
    for (const x of [t.map, t.normalMap]) x.repeat.set(1 / 0.8, 1 / 0.8);
    return new THREE.MeshStandardMaterial({ color: 0xffffff, map: t.map, normalMap: t.normalMap, roughness: 1, envMapIntensity: 0.4 });
  }),
  walnutFluted: () => mat('walnutFluted', () => {
    const t = walnutTextures();
    for (const x of [t.map, t.normalMap]) x.repeat.set(1 / 0.48, 1 / 0.48);
    const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: t.map, normalMap: t.normalMap, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.35 });
    m.normalScale.set(0.9, 0.9);
    return m;
  }),
  walnut: () => mat('walnut', () => new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: veneerTexture(PUBLIC_COLOURS.walnut), roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.4 })),
  door: () => mat('doorVeneer', () => new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: veneerTexture(PUBLIC_COLOURS.door, 31), roughness: 0.5, clearcoat: 0.2, clearcoatRoughness: 0.5 })),
  frame: () => mat('doorFrame', () => new THREE.MeshStandardMaterial({ color: 0xffffff, map: veneerTexture(PUBLIC_COLOURS.frame, 37), roughness: 0.5 })),
  marble: () => mat('marble', () => {
    const t = marbleTexture();
    t.repeat.set(1 / 1.2, 1 / 0.6);
    return new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: t, roughness: 0.14, clearcoat: 0.7, clearcoatRoughness: 0.1 });
  }),
  stone: () => mat('featureStone', () => {
    const t = featureStone();
    return new THREE.MeshStandardMaterial({ color: 0xd9cbb6, map: t.map, normalMap: t.normalMap, roughness: 0.9 });
  }),
  brass: () => mat('brass', () => new THREE.MeshStandardMaterial({ color: BRAND.gold, roughness: 0.26, metalness: 1, envMapIntensity: 1.4 })),
  brushed: () => mat('brushed', () => new THREE.MeshStandardMaterial({ color: 0xc9cdd0, roughness: 0.32, metalness: 1 })),
  plaster: () => mat('plaster', () => new THREE.MeshStandardMaterial({ color: PUBLIC_COLOURS.plaster, roughness: 0.92 })),
  corridorWall: () => mat('corridorWall', () => new THREE.MeshStandardMaterial({ color: PUBLIC_COLOURS.corridorWall, roughness: 0.9 })),
  ceiling: () => mat('publicCeiling', () => new THREE.MeshStandardMaterial({ color: 0xf5f3ee, roughness: 0.95 })),
  darkMetal: () => mat('darkMetal', () => new THREE.MeshStandardMaterial({ color: 0x1d1e1f, roughness: 0.4, metalness: 0.7 })),
  black: () => mat('publicBlack', () => new THREE.MeshStandardMaterial({ color: 0x121314, roughness: 0.5 })),
  paper: () => mat('paper', () => new THREE.MeshStandardMaterial({ color: 0xf7f3ea, roughness: 0.85 })),
  signRed: () => mat('signRed', () => new THREE.MeshStandardMaterial({ color: BRAND.signalRed, emissive: new THREE.Color(BRAND.signalRed), emissiveIntensity: 0, roughness: 0.35 })),
  /** Additive light: washes, glows, halos. `k` scales the colour (HDR). */
  glow: (tex: THREE.Texture, color: number, k: number, key: string) => mat(`glow-${key}`, () => new THREE.MeshBasicMaterial({
    map: tex, color: new THREE.Color(color).multiplyScalar(k), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  })),
  emissive: (color: number, k: number, key: string) => mat(`emit-${key}`, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false })),
};
