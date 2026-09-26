// Generated textures (canvas, seeded, cached). No downloads: the brief allows
// "CC0 only … or generated", and generating keeps the transfer budget free.
import * as THREE from 'three';
import { rng } from './geom';

const cache = new Map<string, THREE.Texture>();

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

function finish(c: HTMLCanvasElement, srgb: boolean, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Normal map from a greyscale height canvas (Sobel). */
function normalFrom(height: HTMLCanvasElement, strength = 2.0): THREE.CanvasTexture {
  const w = height.width, h = height.height;
  const src = height.getContext('2d')!.getImageData(0, 0, w, h).data;
  const [c, g] = canvas(w, h);
  const out = g.createImageData(w, h);
  const H = (x: number, y: number) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
    const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const n = new THREE.Vector3(-dx, -dy, 1).normalize();
    const i = (y * w + x) * 4;
    out.data[i] = (n.x * 0.5 + 0.5) * 255;
    out.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
    out.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
    out.data[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  return finish(c, false);
}

/** Stacked-stone cladding (the lobby feature wall, rec2_t190s). 1 tile = 1 m. */
export function stoneCladding(): { map: THREE.Texture; normalMap: THREE.Texture } {
  if (cache.has('stone')) return { map: cache.get('stone')!, normalMap: cache.get('stoneN')! };
  const S = 512;
  const [c, g] = canvas(S, S);
  const [hc, hg] = canvas(S, S);
  const r = rng(71);
  g.fillStyle = '#3d3a36';
  g.fillRect(0, 0, S, S);
  hg.fillStyle = '#000';
  hg.fillRect(0, 0, S, S);
  const tones = ['#8e8474', '#a3978a', '#6f675d', '#b3a896', '#7e7263', '#9a8c78', '#5f5a53', '#c0b5a2'];
  let y = 0;
  while (y < S) {
    const rowH = 14 + r() * 22;
    let x = -r() * 60;
    while (x < S) {
      const w = 40 + r() * 110;
      g.fillStyle = tones[Math.floor(r() * tones.length)];
      g.fillRect(x + 2, y + 2, w - 3, rowH - 3);
      const shade = 150 + r() * 105;
      hg.fillStyle = `rgb(${shade},${shade},${shade})`;
      hg.fillRect(x + 2, y + 2, w - 3, rowH - 3);
      // surface grain
      for (let k = 0; k < 6; k++) {
        g.fillStyle = `rgba(${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 255 : 0},0.05)`;
        g.fillRect(x + r() * w, y + r() * rowH, 6 + r() * 20, 2 + r() * 4);
      }
      x += w;
    }
    y += rowH;
  }
  const map = finish(c, true);
  const n = normalFrom(hc, 3.5);
  cache.set('stone', map);
  cache.set('stoneN', n);
  return { map, normalMap: n };
}

/** Large-format off-white wall tiles with grout (600 mm; rec2_t190s). */
export function wallTiles(): THREE.Texture {
  if (cache.has('tiles')) return cache.get('tiles')!;
  const S = 256;
  const [c, g] = canvas(S, S);
  const r = rng(5);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const v = 232 + Math.floor(r() * 12);
    g.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
    g.fillRect(i * 128, j * 128, 128, 128);
  }
  g.strokeStyle = 'rgba(120,112,100,0.55)';
  g.lineWidth = 3;
  for (let k = 0; k <= 2; k++) {
    g.beginPath(); g.moveTo(k * 128, 0); g.lineTo(k * 128, S); g.stroke();
    g.beginPath(); g.moveTo(0, k * 128); g.lineTo(S, k * 128); g.stroke();
  }
  const t = finish(c, true);
  cache.set('tiles', t);
  return t;
}

/** Linear metal soffit slats (dark, ~110 mm pitch) — map + normal. */
export function soffitSlats(): { map: THREE.Texture; normalMap: THREE.Texture } {
  if (cache.has('soffit')) return { map: cache.get('soffit')!, normalMap: cache.get('soffitN')! };
  const W = 256, H = 64;
  const [c, g] = canvas(W, H);
  const [hc, hg] = canvas(W, H);
  const slats = 8;
  for (let i = 0; i < slats; i++) {
    const x0 = (i * W) / slats;
    const grad = g.createLinearGradient(x0, 0, x0 + W / slats, 0);
    grad.addColorStop(0, '#3a3f43');
    grad.addColorStop(0.5, '#4a5055');
    grad.addColorStop(0.92, '#2c3033');
    grad.addColorStop(1, '#101214');
    g.fillStyle = grad;
    g.fillRect(x0, 0, W / slats, H);
    const hgrad = hg.createLinearGradient(x0, 0, x0 + W / slats, 0);
    hgrad.addColorStop(0, '#606060');
    hgrad.addColorStop(0.5, '#ffffff');
    hgrad.addColorStop(0.9, '#707070');
    hgrad.addColorStop(1, '#000000');
    hg.fillStyle = hgrad;
    hg.fillRect(x0, 0, W / slats, H);
  }
  const map = finish(c, true);
  const n = normalFrom(hc, 2.5);
  cache.set('soffit', map);
  cache.set('soffitN', n);
  return { map, normalMap: n };
}

/** Horizontal louvres for the roof sign cabinet (grey aluminium). */
export function louvres(): THREE.Texture {
  if (cache.has('louvre')) return cache.get('louvre')!;
  const W = 64, H = 256;
  const [c, g] = canvas(W, H);
  const n = 22;
  for (let i = 0; i < n; i++) {
    const y0 = (i * H) / n;
    const grad = g.createLinearGradient(0, y0, 0, y0 + H / n);
    grad.addColorStop(0, '#d9dcdc');
    grad.addColorStop(0.55, '#a9aeb0');
    grad.addColorStop(0.9, '#7d8386');
    grad.addColorStop(1, '#4b5053');
    g.fillStyle = grad;
    g.fillRect(0, y0, W, H / n);
  }
  const t = finish(c, true);
  cache.set('louvre', t);
  return t;
}

/** Roller shutter (closed shops) — vertical ribs. */
export function shutter(): THREE.Texture {
  if (cache.has('shutter')) return cache.get('shutter')!;
  const W = 32, H = 128;
  const [c, g] = canvas(W, H);
  for (let i = 0; i < 32; i++) {
    const y0 = i * 4;
    const grad = g.createLinearGradient(0, y0, 0, y0 + 4);
    grad.addColorStop(0, '#c4c7c6');
    grad.addColorStop(0.6, '#9ea3a3');
    grad.addColorStop(1, '#6d7272');
    g.fillStyle = grad;
    g.fillRect(0, y0, W, 4);
  }
  const t = finish(c, true);
  cache.set('shutter', t);
  return t;
}
