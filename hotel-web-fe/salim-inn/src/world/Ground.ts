// Ground: a stylised land-cover map drawn from OSM (our own rendering — no
// satellite imagery), the paved Farley site, and the rivers.
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { site, pts } from '../data/site';
import { GROUND } from '../config/materials';
import { footprints } from './layout';
import { bufferConvex, convexHull, flatPolygon } from './geom';
import { asphalt, grass } from './shaders';

const EXT = site.extent; // half-size of the mapped square (m)
const TEX = 2048;

function landColour(k: string): string | null {
  if (k.includes('park') || k.includes('pitch') || k.includes('grass') || k.includes('recreation') || k.includes('golf')) return '#6f8d4a';
  if (k.includes('cemetery')) return '#71804c';
  if (k.includes('residential')) return '#8a876f';
  if (k.includes('industrial') || k.includes('commercial') || k.includes('retail') || k.includes('lu_yes')) return '#8f877a';
  if (k.includes('wood') || k.includes('scrub') || k.includes('forest')) return '#4d6236';
  if (k.includes('wetland')) return '#566b4d';
  if (k === 'parking') return '#6e6b66';
  if (k === 'school') return '#8c8a74';
  return null;
}

function drawLandCover(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const g = c.getContext('2d')!;
  const k = TEX / (2 * EXT);
  const X = (x: number) => (x + EXT) * k;
  const Z = (z: number) => (z + EXT) * k;

  // base: tropical scrub / green, with low-frequency variation
  g.fillStyle = '#5b6d3f';
  g.fillRect(0, 0, TEX, TEX);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * TEX, y = Math.random() * TEX, r = 20 + Math.random() * 90;
    g.fillStyle = `rgba(${70 + Math.random() * 40},${88 + Math.random() * 30},${50 + Math.random() * 20},0.18)`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }

  // settlement: every street gets a band of roofs/yards either side
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const r of site.roads) {
    const settle = r.c === 'residential' ? 58 : r.c === 'unclassified' || r.c === 'tertiary' ? 46 : r.c === 'service' ? 0 : 30;
    if (!settle) continue;
    g.strokeStyle = 'rgba(138,128,112,0.55)';
    g.lineWidth = settle * k;
    g.beginPath();
    const p = r.p;
    g.moveTo(X(p[0]), Z(p[1]));
    for (let i = 2; i < p.length; i += 2) g.lineTo(X(p[i]), Z(p[i + 1]));
    g.stroke();
  }

  for (const l of site.land) {
    const col = landColour(l.k);
    if (!col) continue;
    g.fillStyle = col;
    g.beginPath();
    const p = l.p;
    g.moveTo(X(p[0]), Z(p[1]));
    for (let i = 2; i < p.length; i += 2) g.lineTo(X(p[i]), Z(p[i + 1]));
    g.closePath();
    g.fill();
  }

  // water
  g.fillStyle = '#334b52';
  for (const w of site.water) {
    g.beginPath();
    for (const ring of w.rings) {
      g.moveTo(X(ring[0]), Z(ring[1]));
      for (let i = 2; i < ring.length; i += 2) g.lineTo(X(ring[i]), Z(ring[i + 1]));
      g.closePath();
    }
    g.fill('evenodd');
  }
  g.strokeStyle = '#3a5257';
  for (const w of site.waterways) {
    g.lineWidth = Math.max(1, w.w * k * 1.4);
    g.beginPath();
    g.moveTo(X(w.p[0]), Z(w.p[1]));
    for (let i = 2; i < w.p.length; i += 2) g.lineTo(X(w.p[i]), Z(w.p[i + 1]));
    g.stroke();
  }

  // roads (the far field; near roads are meshes on top)
  for (const r of site.roads) {
    if (r.c === 'service' || r.c === 'track') continue;
    g.strokeStyle = r.c === 'primary' || r.c === 'secondary' ? '#5b5b58' : '#6d6b66';
    g.lineWidth = Math.max(1.1, r.w * k * 1.1);
    g.beginPath();
    g.moveTo(X(r.p[0]), Z(r.p[1]));
    for (let i = 2; i < r.p.length; i += 2) g.lineTo(X(r.p[i]), Z(r.p[i + 1]));
    g.stroke();
  }
  return c;
}

export class Ground {
  readonly group = new THREE.Group();
  readonly paved: THREE.Mesh;
  readonly base: THREE.Mesh;

  constructor(anisotropy: number) {
    const tex = new THREE.CanvasTexture(drawLandCover());
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = anisotropy;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;

    // Base plane: the mapped square, then a skirt fading into haze.
    const baseGeo = new THREE.PlaneGeometry(EXT * 2, EXT * 2, 1, 1).rotateX(-Math.PI / 2);
    const baseMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.97, metalness: 0 });
    baseMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGW = (modelMatrix * vec4(transformed,1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vGW;
          float gh(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
          float gn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
            return mix(mix(gh(i),gh(i+vec2(1,0)),u.x), mix(gh(i+vec2(0,1)),gh(i+vec2(1,1)),u.x), u.y); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          float d1 = gn(vGW.xz * 0.35) * 0.5 + gn(vGW.xz * 1.7) * 0.3 + gn(vGW.xz * 0.05) * 0.4;
          diffuseColor.rgb *= 0.78 + 0.34 * d1;`);
    };
    grass(baseMat);
    this.base = new THREE.Mesh(baseGeo, baseMat);
    this.base.receiveShadow = true;
    this.base.name = 'ground-base';

    const skirtGeo = new THREE.RingGeometry(EXT * 0.98, 42000, 64, 1).rotateX(-Math.PI / 2);
    const skirt = new THREE.Mesh(skirtGeo, new THREE.MeshStandardMaterial({ color: 0x55653d, roughness: 1 }));
    skirt.position.y = -0.4;
    skirt.name = 'ground-skirt';

    // Paved Farley site: both blocks' hulls buffered by the parking ring.
    const hullOf = (ids: string[]) => convexHull(footprints.filter((f) => ids.some((id) => f.id.startsWith(id))).flatMap((f) => f.outer));
    const nwHull = bufferConvex(hullOf(['nw', 'salim']), 23, 5);
    const seHull = bufferConvex(hullOf(['se', 'mart']), 26, 5);
    const ring = (v: THREE.Vector2[]): [number, number][] => [...v.map((p) => [p.x, p.y] as [number, number]), [v[0].x, v[0].y]];
    const union = polygonClipping.union([ring(nwHull)], [ring(seHull)]);
    const pavedGeos = union.map((poly) => flatPolygon(poly[0].slice(0, -1).map(([x, z]) => new THREE.Vector2(x, z)), poly.slice(1).map((h) => h.slice(0, -1).map(([x, z]) => new THREE.Vector2(x, z))), 0.04));
    const pavedMat = asphalt(new THREE.MeshStandardMaterial({ color: GROUND.asphalt, roughness: 0.92, metalness: 0 }), 1.3);
    this.paved = new THREE.Mesh(pavedGeos.length === 1 ? pavedGeos[0] : pavedGeos[0], pavedMat);
    for (let i = 1; i < pavedGeos.length; i++) this.group.add(new THREE.Mesh(pavedGeos[i], pavedMat));
    this.paved.receiveShadow = true;
    this.paved.name = 'farley-paving';

    // Rivers: reflective sheets over the map.
    const waterMat = new THREE.MeshStandardMaterial({ color: GROUND.water, roughness: 0.12, metalness: 0.0, envMapIntensity: 1.1 });
    for (const w of site.water) {
      const outer = pts(w.rings[0]).map(([x, z]) => new THREE.Vector2(x, z));
      const holes = w.rings.slice(1).map((r) => pts(r).map(([x, z]) => new THREE.Vector2(x, z)));
      const m = new THREE.Mesh(flatPolygon(outer, holes, 0.15), waterMat);
      m.name = 'water';
      m.receiveShadow = false;
      this.group.add(m);
    }

    this.group.add(this.base, skirt, this.paved);
  }
}
