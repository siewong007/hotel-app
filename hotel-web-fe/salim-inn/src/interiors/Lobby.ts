// Lobby (corner bay, ground floor). Milestone 1: floor, stone-clad feature
// wall behind the counter with a placeholder for the backlit wordmark, ceiling
// downlights, pendant pair and cove light (warm 2,700–3,000 K).
import * as THREE from 'three';
import { PLAN } from '../world/SalimInnBuilding';
import { FACADE, BRAND } from '../config/materials';
import { boxAt } from '../world/geom';
import { wordmarkTexture } from '../world/signage';
import { ReservationCounter } from './ReservationCounter';

const WARM = 0xffc58a; // ≈ 2,800 K

export class Lobby {
  readonly group = new THREE.Group();
  readonly lights: THREE.Light[] = [];
  readonly counter = new ReservationCounter();
  private wordmark: THREE.Mesh;

  constructor() {
    const L = PLAN.lobby;
    const floor = new THREE.Mesh(boxAt(L.x0, -0.02, L.z0, L.x1, 0.012, L.z1), new THREE.MeshStandardMaterial({ color: 0xcfc6b6, roughness: 0.35 }));
    floor.receiveShadow = true;
    const feature = new THREE.Mesh(boxAt(L.x0 + 0.1, 0, L.z0 + 0.0, PLAN.stair.x0 - 0.25, PLAN.lobbyCeiling, L.z0 + 0.08), new THREE.MeshStandardMaterial({ color: FACADE.stone, roughness: 0.92 }));
    feature.receiveShadow = true;
    // Backlit wall letters: red wordmark as on the entrance wall in
    // rec2_t190s (placeholder until the 3D letters in M3). The Chinese name
    // above it on the real wall is not legible in the frames — left out until
    // the owner confirms the characters.
    const tex = wordmarkTexture({ w: 1024, h: 320 });
    this.wordmark = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.81),
      new THREE.MeshStandardMaterial({ map: tex, transparent: true, emissive: BRAND.signalRed, emissiveMap: tex, emissiveIntensity: 1.4, roughness: 0.4 }),
    );
    this.wordmark.position.set(PLAN.counter.x, 2.5, L.z0 + 0.1);
    this.wordmark.name = 'lobby-wordmark';
    // downlights (emissive discs) + light sources
    const disc = new THREE.CircleGeometry(0.07, 20).rotateX(Math.PI / 2);
    const discMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(WARM).multiplyScalar(3), toneMapped: false });
    for (const [x, z] of [[L.x0 + 0.9, -4], [L.x0 + 3.0, -4], [L.x0 + 5.1, -4], [L.x0 + 0.9, -6.8], [L.x0 + 3.0, -6.8], [L.x0 + 5.1, -6.8]]) {
      const d = new THREE.Mesh(disc, discMat);
      d.position.set(x, PLAN.lobbyCeiling - 0.005, z);
      this.group.add(d);
    }
    // pendant pair over the counter
    const c = PLAN.counter;
    for (const dx of [-0.6, 0.6]) {
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 0.22, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide }));
      shade.position.set(c.x + dx, 2.35, c.z + 0.1);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), discMat);
      bulb.position.set(c.x + dx, 2.3, c.z + 0.1);
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, PLAN.lobbyCeiling - 2.46, 4), new THREE.MeshBasicMaterial({ color: 0x111111 }));
      cord.position.set(c.x + dx, (PLAN.lobbyCeiling + 2.46) / 2, c.z + 0.1);
      this.group.add(shade, bulb, cord);
    }
    const p1 = new THREE.PointLight(WARM, 0, 7, 2);
    p1.position.set(c.x, 2.2, c.z + 0.2);
    const p2 = new THREE.PointLight(WARM, 0, 10, 2);
    p2.position.set((L.x0 + L.x1) / 2, 3.1, -5.2);
    p1.castShadow = false;
    this.lights.push(p1, p2);
    this.group.add(floor, feature, this.wordmark, p1, p2, this.counter.group);
    this.group.name = 'lobby';
  }

  setLights(v: number): void {
    (this.lights[0] as THREE.PointLight).intensity = 5.5 * v;
    (this.lights[1] as THREE.PointLight).intensity = 9 * v;
  }
}
