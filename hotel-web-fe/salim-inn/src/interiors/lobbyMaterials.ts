// Public-area finishes: lobby, reservation counter, stair and the level-1
// corridor, sampled from the owner's photos (2026-10-02): the reception's
// striated grey laminate, white pillars and black granite counter in front of
// the painted mural; cream walls, burgundy loop-pile carpet with aluminium
// nosings and stainless rails on the stair; dark brown doors with acrylic
// red-number plates and red wayfinding plates in the corridors. The palette
// is PUBLIC_COLOURS in config/materials.ts. Everything is generated on a
// canvas (brief §4.6) except the mural, which is the owner's photo of it.
import * as THREE from 'three';
import { canvas, finish, normalFrom } from '../world/textures';
import { rng } from '../world/geom';
import { BRAND, PUBLIC_COLOURS } from '../config/materials';
import muralUrl from './reception-mural.jpg';

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
/** Polished 600 mm porcelain, light cream, soft veining; one texture = 1.2 m. */
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

/** Burgundy loop pile (stair and corridors): a plain field with a fine
 *  speckle in tone and height. One texture = 0.5 m. */
export function carpetTextures(): { map: THREE.Texture; normalMap: THREE.Texture } {
  const map = cached('carpet', () => {
    const S = 512;
    const [c, g] = canvas(S, S);
    const [hc, hg] = canvas(S, S);
    const r = rng(3);
    g.fillStyle = hex(PUBLIC_COLOURS.carpetField);
    g.fillRect(0, 0, S, S);
    hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S);
    // loops: speckle in colour and height, gathered into one path per style
    // and filled once (separate fills with a style change each were the
    // slowest texture in the interior)
    const light: number[] = [], dark: number[] = [];
    const byHeight = new Map<number, number[]>();
    for (let k = 0; k < 18000; k++) {
      const x = r() * S, y = r() * S;
      (r() > 0.45 ? light : dark).push(x, y);
      const v = Math.floor(90 + r() * 90);
      const list = byHeight.get(v) ?? [];
      list.push(x, y);
      byHeight.set(v, list);
    }
    const speckles = (ctx: CanvasRenderingContext2D, style: string, xy: number[]) => {
      ctx.fillStyle = style;
      ctx.beginPath();
      for (let i = 0; i < xy.length; i += 2) ctx.rect(xy[i], xy[i + 1], 1.6, 1.6);
      ctx.fill();
    };
    speckles(g, 'rgba(255,170,170,0.05)', light);
    speckles(g, 'rgba(20,0,4,0.12)', dark);
    for (const [v, xy] of byHeight) speckles(hg, `rgb(${v},${v},${v})`, xy);
    texCache.set('carpetN', normalFrom(hc, 1.4));
    return finish(c, true);
  });
  return { map, normalMap: texCache.get('carpetN')! };
}

// ---------------------------------------------------------------- joinery & stone
/** Striated grey-brown laminate, the grain running along u (horizontal on
 *  walls, the bulkhead and the counter front). One texture = 1.2 × 0.6 m. */
export function laminateTexture(): THREE.Texture {
  return cached('laminate', () => {
    const W = 1024, H = 512;
    const [c, g] = canvas(W, H);
    const r = rng(611);
    g.fillStyle = hex(PUBLIC_COLOURS.laminate);
    g.fillRect(0, 0, W, H);
    // broad bands of tone across the board
    for (let y = 0; y < H; ) {
      const h = 3 + r() * 24;
      g.fillStyle = r() < 0.5 ? `rgba(40,36,33,${0.06 + r() * 0.16})` : `rgba(175,166,156,${0.04 + r() * 0.12})`;
      g.fillRect(0, y, W, h);
      y += h;
    }
    // fine streaks along the grain, wrapped at the seam
    for (let k = 0; k < 2200; k++) {
      const y = r() * H, x = r() * W, len = 40 + r() * 420, h = 0.6 + r() * 1.6;
      g.fillStyle = r() < 0.55 ? `rgba(30,27,25,${0.08 + r() * 0.22})` : `rgba(200,192,182,${0.04 + r() * 0.14})`;
      g.fillRect(x, y, len, h);
      if (x + len > W) g.fillRect(x - W, y, len, h);
    }
    return finish(c, true);
  });
}

/** White laminate for the pillars and trims: the faintest vertical grain. */
export function whiteLaminateTexture(): THREE.Texture {
  return cached('laminateWhite', () => {
    const W = 256, H = 512;
    const [c, g] = canvas(W, H);
    const r = rng(907);
    g.fillStyle = hex(PUBLIC_COLOURS.pillar);
    g.fillRect(0, 0, W, H);
    for (let k = 0; k < 500; k++) {
      const x = r() * W, y = r() * H, len = 30 + r() * 220;
      g.fillStyle = r() < 0.5 ? `rgba(150,148,142,${0.04 + r() * 0.07})` : `rgba(255,255,255,${0.05 + r() * 0.08})`;
      g.fillRect(x, y, 0.8 + r(), len);
      if (y + len > H) g.fillRect(x, y - H, 0.8 + r(), len);
    }
    return finish(c, true);
  });
}

/** Black granite: a near-black ground with grey and white flecks. One
 *  texture = 0.6 m. */
export function graniteTexture(): THREE.Texture {
  return cached('granite', () => {
    const S = 512;
    const [c, g] = canvas(S, S);
    const r = rng(1201);
    g.fillStyle = hex(PUBLIC_COLOURS.granite);
    g.fillRect(0, 0, S, S);
    for (let k = 0; k < 3200; k++) {
      const x = r() * S, y = r() * S, s = 0.6 + r() * r() * 2.0;
      const v = r();
      g.fillStyle = v < 0.85 ? `rgba(48,49,52,${0.2 + r() * 0.35})` : v < 0.99 ? `rgba(92,93,96,${0.15 + r() * 0.3})` : `rgba(170,172,176,${0.2 + r() * 0.3})`;
      g.fillRect(x, y, s, s);
    }
    return finish(c, true);
  });
}

// ---------------------------------------------------------------- signs & plates
const SIGN_FONT = '"Arial Narrow", "Helvetica Neue", Arial, sans-serif';

/** A red wayfinding plate: white room numbers and a white arrow (the
 *  corridors' "◀ 209–212", "201–208 213–215 ▶" plates). */
export function wayfindingTexture(text: string, arrow: 'left' | 'right'): THREE.Texture {
  return cached(`way-${arrow}-${text}`, () => {
    const W = 512, H = 128;
    const [c, g] = canvas(W, H);
    g.fillStyle = hex(PUBLIC_COLOURS.signRed);
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 4;
    g.strokeRect(6, 6, W - 12, H - 12);
    g.fillStyle = '#ffffff';
    const ax = arrow === 'left' ? 46 : W - 46;
    const d = arrow === 'left' ? -1 : 1;
    g.beginPath();
    g.moveTo(ax + d * 24, H / 2);
    g.lineTo(ax - d * 16, H / 2 - 30);
    g.lineTo(ax - d * 16, H / 2 + 30);
    g.closePath();
    g.fill();
    g.font = `700 ${text.length > 9 ? 54 : 64}px ${SIGN_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, W / 2 - d * 26, H / 2 + 3, W - 130);
    return finish(c, true, false);
  });
}

/** The green KELUAR exit sign: the word and a running figure. */
export function exitTexture(): THREE.Texture {
  return cached('keluar', () => {
    const W = 512, H = 144;
    const [c, g] = canvas(W, H);
    g.fillStyle = hex(PUBLIC_COLOURS.exitGreen);
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#f4fff6';
    g.font = `700 82px ${SIGN_FONT}`;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText('KELUAR', 26, H / 2 + 4);
    // a white tile with the running figure
    const x0 = 360, y0 = 18, s = 108;
    g.fillRect(x0, y0, s, s);
    g.strokeStyle = hex(PUBLIC_COLOURS.exitGreen);
    g.fillStyle = hex(PUBLIC_COLOURS.exitGreen);
    g.lineCap = 'round';
    g.lineWidth = 11;
    const P = (x: number, y: number): [number, number] => [x0 + x * s, y0 + y * s];
    g.beginPath(); g.arc(...P(0.62, 0.2), 9, 0, Math.PI * 2); g.fill();
    for (const seg of [[[0.55, 0.32], [0.42, 0.58]], [[0.42, 0.58], [0.6, 0.72], [0.55, 0.9]], [[0.42, 0.58], [0.3, 0.78], [0.14, 0.8]], [[0.52, 0.36], [0.36, 0.42], [0.26, 0.36]], [[0.52, 0.36], [0.66, 0.48], [0.8, 0.44]]] as [number, number][][]) {
      g.beginPath();
      seg.forEach(([x, y], i) => (i ? g.lineTo(...P(x, y)) : g.moveTo(...P(x, y))));
      g.stroke();
    }
    return finish(c, true, false);
  });
}

/** Round red Wi-Fi sign (transparent outside the disc). */
export function wifiTexture(): THREE.Texture {
  return cached('wifi', () => {
    const S = 256;
    const [c, g] = canvas(S, S);
    g.fillStyle = hex(PUBLIC_COLOURS.signRed);
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ffffff';
    g.fillStyle = '#ffffff';
    g.lineCap = 'round';
    g.lineWidth = 13;
    for (const rr of [26, 52, 78]) { g.beginPath(); g.arc(S / 2, S * 0.6, rr, -Math.PI * 0.78, -Math.PI * 0.22); g.stroke(); }
    g.beginPath(); g.arc(S / 2, S * 0.6, 9, 0, Math.PI * 2); g.fill();
    g.font = `700 34px ${SIGN_FONT}`;
    g.textAlign = 'center';
    g.fillText('Wi-Fi', S / 2, S * 0.83);
    return finish(c, true, false);
  });
}

/** No-smoking notice: the pictogram over DILARANG MEROKOK, with a yellow
 *  strip of small print (unreadable at any distance the film reaches). */
export function noSmokingTexture(): THREE.Texture {
  return cached('noSmoking', () => {
    const W = 256, H = 320;
    const [c, g] = canvas(W, H);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, W, H);
    // cigarette
    g.fillStyle = '#1b1b1b'; g.fillRect(58, 112, 120, 22);
    g.fillStyle = '#e9e2d6'; g.fillRect(178, 112, 22, 22);
    g.strokeStyle = '#8a8a8a'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(196, 106); g.bezierCurveTo(208, 92, 186, 82, 200, 66); g.stroke();
    // red ring and bar
    g.strokeStyle = '#d0202a'; g.lineWidth = 16;
    g.beginPath(); g.arc(W / 2, 122, 86, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(W / 2 - 61, 61); g.lineTo(W / 2 + 61, 183); g.stroke();
    g.fillStyle = '#d0202a';
    g.font = `700 30px ${SIGN_FONT}`;
    g.textAlign = 'center';
    g.fillText('DILARANG MEROKOK', W / 2, 248);
    g.fillStyle = '#f2c230'; g.fillRect(0, 266, W, 54);
    g.fillStyle = 'rgba(0,0,0,0.65)';
    for (let i = 0; i < 3; i++) g.fillRect(70, 276 + i * 13, 150 - i * 30, 5);
    g.fillRect(16, 274, 40, 40);
    return finish(c, true, false);
  });
}

/** A room number in red on clear acrylic (transparent ground), with the four
 *  stand-off screws. */
export function acrylicNumberTexture(n: number): THREE.Texture {
  return cached(`acrylic-${n}`, () => {
    const W = 256, H = 112;
    const [c, g] = canvas(W, H);
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#d3242d';
    g.font = `700 ${H * 0.72}px ${SIGN_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), W / 2, H / 2 + 4);
    g.fillStyle = '#c9cdd1';
    for (const [x, y] of [[12, 12], [W - 12, 12], [12, H - 12], [W - 12, H - 12]]) { g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill(); }
    return finish(c, true, false);
  });
}

/** Generic notice papers taped to the reception pillars: a heading bar and
 *  lines of small print (no logos, no legible text). */
export function noticeTexture(seed: number): THREE.Texture {
  return cached(`notice-${seed}`, () => {
    const W = 256, H = 352;
    const [c, g] = canvas(W, H);
    const r = rng(seed);
    g.fillStyle = '#fbfaf6';
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(30,30,30,0.85)';
    g.fillRect(70, 30, 116, 14);
    for (let i = 0; i < 9; i++) g.fillRect(36 + r() * 12, 72 + i * 26, 150 + r() * 30, 6);
    return finish(c, true, false);
  });
}

// ---------------------------------------------------------------- art
/** Hexagonal canvases in the corridors: blossom on navy, gold sprays on deep
 *  green. Square texture; the geometry cuts the hexagon. */
export function hexArtTexture(kind: 'navy' | 'green'): THREE.Texture {
  return cached(`hex-${kind}`, () => {
    const S = 512;
    const [c, g] = canvas(S, S);
    const r = rng(kind === 'navy' ? 71 : 73);
    g.fillStyle = kind === 'navy' ? '#1c2438' : '#1f3a2c';
    g.fillRect(0, 0, S, S);
    // branches
    g.strokeStyle = kind === 'navy' ? 'rgba(90,70,60,0.9)' : 'rgba(150,120,60,0.9)';
    g.lineCap = 'round';
    for (let b = 0; b < 4; b++) {
      let x = r() * S * 0.3, y = S * (0.3 + r() * 0.5), a = -0.4 - r() * 0.5;
      g.lineWidth = 6;
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 22; s++) { a += (r() - 0.5) * 0.4; x += Math.cos(a) * 16; y += Math.sin(a) * 16; g.lineTo(x, y); }
      g.stroke();
    }
    // flowers: clusters of dots
    for (let k = 0; k < 90; k++) {
      const x = r() * S, y = r() * S * 0.9;
      const col = kind === 'navy' ? (r() < 0.8 ? '#f4f2ee' : '#c9d6ea') : (r() < 0.7 ? '#e0b44c' : '#f2dd8f');
      g.fillStyle = col;
      for (let p = 0; p < 5; p++) { g.beginPath(); g.arc(x + Math.cos(p * 1.26) * 6, y + Math.sin(p * 1.26) * 6, 5 + r() * 2, 0, Math.PI * 2); g.fill(); }
    }
    return finish(c, true, false);
  });
}

/** A monstera leaf print on white canvas (stair). */
export function monsteraTexture(): THREE.Texture {
  return cached('monstera', () => {
    const W = 384, H = 512;
    const [c, g] = canvas(W, H);
    g.fillStyle = '#f6f5f1';
    g.fillRect(0, 0, W, H);
    g.save();
    g.translate(W / 2, H * 0.55);
    g.rotate(-0.25);
    g.fillStyle = '#2f5a3a';
    g.beginPath();
    g.ellipse(0, 0, 130, 170, 0, 0, Math.PI * 2);
    g.fill();
    // slits cut in from both edges towards the midrib
    g.fillStyle = '#f6f5f1';
    for (let i = 0; i < 8; i++) {
      for (const side of [-1, 1]) {
        g.beginPath();
        g.ellipse(side * 96, -126 + i * 34, 56, 6, side * 0.35, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.strokeStyle = '#8fb08a';
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(0, 175); g.lineTo(0, -160); g.stroke();
    g.restore();
    return finish(c, true, false);
  });
}

/** A loose abstract canvas in blue, yellow and orange (stair landing). */
export function abstractTexture(): THREE.Texture {
  return cached('abstract', () => {
    const W = 256, H = 512;
    const [c, g] = canvas(W, H);
    const r = rng(331);
    g.fillStyle = '#e9e4d6';
    g.fillRect(0, 0, W, H);
    const cols = ['#2b5c9e', '#3f7fc4', '#e6b52f', '#e07a2a', '#f4f1ea', '#1d3a66'];
    for (let k = 0; k < 40; k++) {
      g.fillStyle = cols[Math.floor(r() * cols.length)];
      g.globalAlpha = 0.55 + r() * 0.4;
      g.fillRect(r() * W - 40, r() * H - 40, 30 + r() * 140, 16 + r() * 110);
    }
    g.globalAlpha = 1;
    return finish(c, true, false);
  });
}

/** A long canvas of white blossom on pale blue (level-1 corridor). */
export function blossomTexture(): THREE.Texture {
  return cached('blossom', () => {
    const W = 1024, H = 256;
    const [c, g] = canvas(W, H);
    const r = rng(517);
    const gr = g.createLinearGradient(0, 0, W, H);
    gr.addColorStop(0, '#9fb3c4'); gr.addColorStop(1, '#c3d0d8');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(70,60,55,0.8)';
    g.lineCap = 'round';
    for (let b = 0; b < 7; b++) {
      let x = r() * W, y = H, a = -1.2 - r() * 0.7;
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 18; s++) { a += (r() - 0.5) * 0.5; x += Math.cos(a) * 14; y += Math.sin(a) * 14; g.lineTo(x, y); }
      g.stroke();
    }
    for (let k = 0; k < 900; k++) {
      g.fillStyle = r() < 0.85 ? 'rgba(250,250,252,0.9)' : 'rgba(230,214,224,0.9)';
      g.beginPath(); g.arc(r() * W, r() * H, 1.5 + r() * 4, 0, Math.PI * 2); g.fill();
    }
    return finish(c, true, false);
  });
}

/** The reception mural: the owner's photo of it, squared to the wall
 *  (perf workshop: cropped between the pillar edges and under the soffit;
 *  the price stand in front of its lower left painted out). The texture
 *  object exists from the start and receives the image when it arrives, so
 *  the material never recompiles. */
export function muralTexture(): THREE.Texture {
  return cached('mural', () => {
    const [c, g] = canvas(4, 4);
    g.fillStyle = '#d8d3c8';
    g.fillRect(0, 0, 4, 4);
    const t = new THREE.Texture<HTMLCanvasElement | HTMLImageElement>(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { t.image = img; t.needsUpdate = true; };
    img.src = muralUrl;
    return t;
  });
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
    for (const x of [t.map, t.roughnessMap, t.normalMap]) x.repeat.set(1 / 1.2, 1 / 1.2);
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, map: t.map, roughnessMap: t.roughnessMap, normalMap: t.normalMap, roughness: 0.4, envMapIntensity: 1.3 });
    m.normalScale.set(0.6, 0.6);
    return m;
  }),
  carpet: () => mat('carpet', () => {
    const t = carpetTextures();
    for (const x of [t.map, t.normalMap]) x.repeat.set(1 / 0.5, 1 / 0.5);
    return new THREE.MeshStandardMaterial({ color: 0xffffff, map: t.map, normalMap: t.normalMap, roughness: 1, envMapIntensity: 0.4 });
  }),
  laminate: () => mat('laminate', () => {
    const t = laminateTexture();
    t.repeat.set(1 / 1.2, 1 / 0.6);
    return new THREE.MeshStandardMaterial({ color: 0xffffff, map: t, roughness: 0.55, envMapIntensity: 0.7 });
  }),
  laminateWhite: () => mat('laminateWhite', () => {
    const t = whiteLaminateTexture();
    t.repeat.set(1 / 0.3, 1 / 0.6);
    return new THREE.MeshStandardMaterial({ color: 0xffffff, map: t, roughness: 0.5 });
  }),
  granite: () => mat('granite', () => {
    const t = graniteTexture();
    t.repeat.set(1 / 0.6, 1 / 0.6);
    return new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: t, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.2, envMapIntensity: 0.55 });
  }),
  mural: () => mat('mural', () => new THREE.MeshStandardMaterial({ color: 0xffffff, map: muralTexture(), roughness: 0.82 })),
  door: () => mat('doorDark', () => new THREE.MeshStandardMaterial({ color: PUBLIC_COLOURS.door, roughness: 0.42, envMapIntensity: 0.8 })),
  frame: () => mat('doorFrame', () => new THREE.MeshStandardMaterial({ color: PUBLIC_COLOURS.frame, roughness: 0.5 })),
  brushed: () => mat('brushed', () => new THREE.MeshStandardMaterial({ color: 0xc9cdd0, roughness: 0.32, metalness: 1 })),
  stainless: () => mat('stainless', () => new THREE.MeshStandardMaterial({ color: 0xd6d9dc, roughness: 0.2, metalness: 1, envMapIntensity: 1.2 })),
  acrylic: () => mat('acrylic', () => new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false, clearcoat: 1 })),
  plaster: () => mat('plaster', () => new THREE.MeshStandardMaterial({ color: PUBLIC_COLOURS.plaster, roughness: 0.92 })),
  corridorWall: () => mat('corridorWall', () => new THREE.MeshStandardMaterial({ color: PUBLIC_COLOURS.corridorWall, roughness: 0.9 })),
  ceiling: () => mat('publicCeiling', () => new THREE.MeshStandardMaterial({ color: 0xf5f4f0, roughness: 0.95 })),
  darkMetal: () => mat('darkMetal', () => new THREE.MeshStandardMaterial({ color: 0x1d1e1f, roughness: 0.4, metalness: 0.7 })),
  black: () => mat('publicBlack', () => new THREE.MeshStandardMaterial({ color: 0x121314, roughness: 0.5 })),
  white: () => mat('publicWhite', () => new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.45 })),
  red: () => mat('publicRed', () => new THREE.MeshStandardMaterial({ color: 0xb7151f, roughness: 0.35, metalness: 0.1 })),
  paper: () => mat('paper', () => new THREE.MeshStandardMaterial({ color: 0xf7f3ea, roughness: 0.85 })),
  brass: () => mat('brass', () => new THREE.MeshStandardMaterial({ color: BRAND.gold, roughness: 0.26, metalness: 1, envMapIntensity: 1.4 })),
  /** A printed plate or canvas: its own texture, matte. */
  print: (tex: THREE.Texture, key: string, transparent = false) => mat(`print-${key}`, () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, transparent, alphaTest: transparent ? 0.02 : 0 })),
  /** Additive light: washes, glows, halos. `k` scales the colour (HDR). */
  glow: (tex: THREE.Texture, color: number, k: number, key: string) => mat(`glow-${key}`, () => new THREE.MeshBasicMaterial({
    map: tex, color: new THREE.Color(color).multiplyScalar(k), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  })),
  emissive: (color: number, k: number, key: string) => mat(`emit-${key}`, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false })),
};
