import * as THREE from '../vendor/three.module.min.js';
import { rand } from './core.js';

// Tropical midday sky, read off the Google Earth walkthrough of Farley: a
// deep blue zenith that washes to a pale, humid haze within about 25° of the
// horizon, with a broken cumulus band sitting low. The scene used to render
// against a flat near-black clear colour, which read as dusk and left the
// street-level stages — where the sky fills the top third of frame — looking
// nothing like the footage they were traced from.
//
// Painted into a texture rather than built from a shader so the horizon haze
// colour can be sampled back out for the fog (see HAZE), keeping the distance
// falloff and the sky the same colour instead of two competing greys.
export const ZENITH = 0x2f6ea8;
export const HAZE = 0xc8d7dd;

const W = 1024;
const H = 512;

function paint(ctx) {
  // SphereGeometry maps v = 1 to the north pole and v = 0 to the south, and a
  // CanvasTexture is flipped on upload, so canvas y = 0 is the zenith and
  // y = H/2 is the horizon. Everything below the halfway line is under the
  // ground plate and is only ever glimpsed past its edge — hence the flat
  // ground haze rather than more sky.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0.00, '#1a5493');
  g.addColorStop(0.20, '#2d72af');
  g.addColorStop(0.38, '#4d90c1');
  g.addColorStop(0.455, '#8bb7d3');
  g.addColorStop(0.497, '#ccd8dd');
  // Eased rather than stepped across the horizon: a tight stop pair here
  // showed as a hard seam wherever open sky sat above the ground plate,
  // which on a tall phone viewport cuts straight across the frame.
  g.addColorStop(0.56, '#c2c7bf');
  g.addColorStop(0.72, '#a8aea3');
  g.addColorStop(1.00, '#8f978c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Cumulus. Each cloud is a cluster of soft radial blobs; the shadowed
  // underside is drawn first and slightly lower so the tops stay bright.
  // Deterministic — a scroll-scrubbed scene must render identically on every
  // reload, so nothing here may call Math.random().
  const blob = (x, y, r, alpha, tint) => {
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(${tint},${alpha})`);
    rg.addColorStop(0.55, `rgba(${tint},${alpha * 0.62})`);
    rg.addColorStop(1, `rgba(${tint},0)`);
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  for (let i = 0; i < 38; i++) {
    const cx = rand(i * 3.7) * W;
    // Held between roughly 5° and 40° above the horizon: cumulus over Sibu
    // banks up near the horizon, and anything painted past y = H/2 would sit
    // below the ground plate where it can never be seen.
    const cy = H * (0.31 + rand(i * 5.1) * 0.16);
    const scale = 26 + rand(i * 1.9) * 48;
    const puffs = 4 + Math.floor(rand(i * 7.3) * 4);
    for (let k = 0; k < puffs; k++) {
      const ox = (rand(i * 11 + k) - 0.5) * scale * 2.4;
      const oy = (rand(i * 13 + k * 3) - 0.5) * scale * 0.5;
      const r = scale * (0.5 + rand(i * 17 + k) * 0.6);
      blob(cx + ox, cy + oy + r * 0.26, r * 1.05, 0.34, '142,158,172');
      blob(cx + ox, cy + oy, r * 0.96, 0.86, '255,255,255');
    }
  }
}

export function buildSky(scene) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  paint(c.getContext('2d'));
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(900, 40, 24),
    // fog:false — the haze is painted into the gradient, so letting the fog
    // wash the dome as well would flatten the whole sky to one grey.
    new THREE.MeshBasicMaterial({ map, side: THREE.BackSide, depthWrite: false, fog: false })
  );
  dome.renderOrder = -1;
  scene.add(dome);

  // `map` is 2:1, i.e. already equirectangular, so it doubles as the source
  // for the scene's image-based lighting — see salim-inn.js. The dome itself
  // rides with the camera, so it can never be clipped by the far plane
  // however far the flythrough travels across the site.
  return { dome, map, follow: (camera) => dome.position.copy(camera.position) };
}
