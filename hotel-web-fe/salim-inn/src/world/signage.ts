// Canvas-generated signage textures (no third-party artwork). The hotel's own
// wordmark is set in a heavy condensed face in the red of the real signs
// (rec2_t180s roof box, rec2_t190s wall letters).
import * as THREE from 'three';

export function wordmarkTexture(opts: { text?: string; sub?: string; bg?: string; fg?: string; w?: number; h?: number; weight?: number } = {}): THREE.CanvasTexture {
  const { text = 'SALIM INN', sub, bg = 'rgba(0,0,0,0)', fg = '#c8242b', w = 1024, h = 256, weight = 800 } = opts;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const main = sub ? h * 0.52 : h * 0.72;
  g.font = `${weight} ${main}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
  const m = g.measureText(text);
  const sx = Math.min(1, (w * 0.9) / m.width);
  g.save();
  g.translate(w / 2, sub ? h * 0.62 : h / 2);
  g.scale(sx, 1);
  g.fillText(text, 0, 0);
  g.restore();
  if (sub) {
    g.font = `600 ${h * 0.22}px "Noto Serif SC", "Songti SC", serif`;
    g.fillText(sub, w / 2, h * 0.2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
