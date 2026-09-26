// Gold location pin, pulse rings and light beam over Salim Inn (from V16),
// plus the category hotspot anchors for chapter 2 (DOM labels are projected
// onto these points by the UI).
import * as THREE from 'three';
import { BRAND } from '../config/materials';
import { POINTS } from './layout';
import { site } from '../data/site';

export interface HotspotAnchor {
  key: 'groceries' | 'food' | 'health' | 'services' | 'hotel';
  label: string;
  world: THREE.Vector3;
}

function poiCentroid(filter: (k: string, n?: string) => boolean, fallback: THREE.Vector3): THREE.Vector3 {
  const hits = site.pois.filter((p) => p.n && filter(p.k, p.n) && Math.hypot(p.x - 55, p.z + 52) < 170);
  if (!hits.length) return fallback;
  const x = hits.reduce((s, p) => s + p.x, 0) / hits.length;
  const z = hits.reduce((s, p) => s + p.z, 0) / hits.length;
  return new THREE.Vector3(x, 16, z);
}

export class Hotspots {
  readonly group = new THREE.Group();
  readonly anchors: HotspotAnchor[];
  private rings: THREE.Mesh[] = [];
  private beam: THREE.Mesh;
  private time = 0;
  private reveal = 0;

  constructor() {
    const base = POINTS.guestBay.clone();
    const gold = new THREE.Color(BRAND.gold);
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(
        new THREE.RingGeometry(2.2 + i * 1.6, 2.5 + i * 1.6, 96).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: gold.clone().multiplyScalar(2.2), transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false }),
      );
      r.position.set(base.x, 0.22, base.z);
      r.userData.o = i * 0.8;
      r.renderOrder = 6;
      this.rings.push(r);
      this.group.add(r);
    }
    // V16's thin gold beam: fades in above the ground so it never veils the
    // facade, strongest at its core, gone by the top
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.42, 34, 20, 1, true).translate(0, 17, 0),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uColor: { value: gold.clone() }, uOpacity: { value: 0.5 } },
        vertexShader: /* glsl */ `varying vec2 vUv; varying float vRim;
          void main(){
            vUv = uv;
            vec3 n = normalize(normalMatrix * normal);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vRim = abs(dot(n, normalize(-mv.xyz)));
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv; varying float vRim;
          void main(){
            float a = smoothstep(0.0, 0.3, vUv.y) * pow(1.0 - vUv.y, 1.4) * pow(vRim, 2.0) * uOpacity;
            gl_FragColor = vec4(uColor * 1.8, a);
          }`,
      }),
    );
    this.beam.position.set(base.x, 0, base.z);
    this.beam.renderOrder = 7;
    this.group.add(this.beam);

    const salim = POINTS.pin.clone();
    this.anchors = [
      { key: 'hotel', label: 'Salim Inn', world: salim },
      { key: 'groceries', label: 'Groceries & daily needs', world: poiCentroid((k, n) => k.includes('supermarket') || !!n?.includes('Farley Supermarket'), new THREE.Vector3(93, 18, 16)) },
      { key: 'food', label: 'Food & cafés', world: poiCentroid((k) => k.includes('restaurant') || k.includes('cafe') || k.includes('fast_food') || k.includes('bakery'), new THREE.Vector3(40, 16, -60)) },
      { key: 'health', label: 'Pharmacies & clinic', world: poiCentroid((k) => k.includes('pharmacy') || k.includes('hospital') || k.includes('clinic'), new THREE.Vector3(-20, 16, -70)) },
      { key: 'services', label: 'Everyday services', world: poiCentroid((k) => k.includes('bank') || k.includes('atm') || k.includes('car_repair') || k.includes('hardware') || k.includes('stationery'), new THREE.Vector3(90, 16, -70)) },
    ];
  }

  /** 0..1 — how present the pin is (chapter 3 lock-on → chapter 4 arrival). */
  setReveal(v: number): void {
    this.reveal = v;
    this.group.visible = v > 0.002;
  }

  update(dt: number): void {
    this.time += dt;
    const v = this.reveal;
    this.rings.forEach((r) => {
      const ph = (this.time * 0.45 + r.userData.o) % 1;
      r.scale.setScalar(0.85 + ph * 0.5);
      (r.material as THREE.MeshBasicMaterial).opacity = (1 - ph) * 0.75 * v;
    });
    (this.beam.material as THREE.ShaderMaterial).uniforms.uOpacity.value = (0.5 + Math.sin(this.time * 1.3) * 0.08) * v;
  }
}
