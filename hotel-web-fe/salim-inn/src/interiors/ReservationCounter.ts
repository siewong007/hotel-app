// Sample reservation counter (brief §4.4) — milestone-1 massing at true size:
// 2.4 m long, 1.05 m guest-side height, 0.75 m staff work surface behind,
// timber-look front with a brass inlay line, stone top, LED kick glow.
// Materials, props and the live registration card arrive in milestone 3.
import * as THREE from 'three';
import { PLAN } from '../world/SalimInnBuilding';
import { BRAND } from '../config/materials';
import { roundedBox } from '../world/geom';

export class ReservationCounter {
  readonly group = new THREE.Group();

  constructor() {
    const c = PLAN.counter;
    this.group.position.set(c.x, 0, c.z);
    const timber = new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 0.55 });
    const stone = new THREE.MeshStandardMaterial({ color: 0xd8d2c6, roughness: 0.3 });
    const brass = new THREE.MeshStandardMaterial({ color: BRAND.gold, roughness: 0.28, metalness: 1 });
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc98a).multiplyScalar(2.2), toneMapped: false });

    const front = new THREE.Mesh(roundedBox(c.length, 1.0, 0.1, 0.015), timber);
    front.position.set(0, 0.54, c.depth / 2 - 0.05);
    const body = new THREE.Mesh(roundedBox(c.length, 0.98, c.depth - 0.1, 0.01), timber);
    body.position.set(0, 0.53, -0.05);
    const top = new THREE.Mesh(roundedBox(c.length + 0.08, 0.05, 0.42, 0.012), stone);
    top.position.set(0, 1.055, c.depth / 2 - 0.16);
    const work = new THREE.Mesh(roundedBox(c.length - 0.1, 0.04, 0.55, 0.01), stone);
    work.position.set(0, 0.76, -c.depth / 2 + 0.05);
    const inlay = new THREE.Mesh(new THREE.BoxGeometry(c.length - 0.12, 0.012, 0.01), brass);
    inlay.position.set(0, 0.86, c.depth / 2 + 0.002);
    const kick = new THREE.Mesh(new THREE.BoxGeometry(c.length - 0.1, 0.02, 0.02), glow);
    kick.position.set(0, 0.06, c.depth / 2 - 0.02);
    for (const m of [front, body, top, work, inlay]) {
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
    this.group.add(kick);
    this.group.name = 'reservation-counter';
  }
}
