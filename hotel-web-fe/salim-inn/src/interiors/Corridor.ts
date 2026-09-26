// Stair core and the level-1 corridor (milestone 1: stair flights, landing,
// corridor floor and ceiling, sconces, room-number plaques as blanks).
// Room numbers 101–114 and the carpet/sconce materials land in milestone 3.
import * as THREE from 'three';
import { PLAN } from '../world/SalimInnBuilding';
import { FLOOR_Y } from '../config/dimensions';
import { SALIM_WIDTH } from '../world/layout';
import { boxAt, mergeAll } from '../world/geom';

export class Corridor {
  readonly group = new THREE.Group();
  readonly light: THREE.PointLight;

  constructor() {
    const s = PLAN.stair;
    const y1 = FLOOR_Y.level1;
    // dog-leg stair hugging the core's walls, leaving the central well open
    const steps: THREE.BufferGeometry[] = [];
    const n = 12;
    const rise = y1 / (2 * n);
    const run = 0.27;
    const fw = 0.88; // flight width (leaves a ~1 m open well the camera rises through)
    for (let i = 0; i < n; i++) {
      // flight 1 along the party-wall side, climbing away from the lobby
      steps.push(boxAt(s.x1 - fw, 0, s.z1 - 0.3 - (i + 1) * run, s.x1, (i + 1) * rise, s.z1 - 0.3 - i * run));
      // flight 2 back towards the corridor on the lobby side
      steps.push(boxAt(s.x0, y1 / 2, s.z1 - 0.3 - n * run - 1.0 + (i + 1) * run - run, s.x0 + fw, y1 / 2 + (i + 1) * rise, s.z1 - 0.3 - n * run - 1.0 + (i + 1) * run));
    }
    // mid landing at the back
    steps.push(boxAt(s.x0, y1 / 2 - 0.2, s.z0 + 0.2, s.x1, y1 / 2, s.z1 - 0.3 - n * run));
    const stairMesh = new THREE.Mesh(mergeAll(steps, ['position', 'normal']), new THREE.MeshStandardMaterial({ color: 0xbfb6a6, roughness: 0.6 }));
    stairMesh.castShadow = stairMesh.receiveShadow = true;
    stairMesh.name = 'stair';

    const cz0 = PLAN.corridor.z0, cz1 = PLAN.corridor.z1;
    const floor = new THREE.Mesh(boxAt(0.2, y1 - 0.01, cz0, SALIM_WIDTH - 0.2, y1 + 0.012, cz1), new THREE.MeshStandardMaterial({ color: 0x3b3431, roughness: 0.95 }));
    floor.receiveShadow = true;
    const ceiling = new THREE.Mesh(boxAt(0.2, y1 + 2.7, cz0, SALIM_WIDTH - 0.2, y1 + 2.74, cz1), new THREE.MeshStandardMaterial({ color: 0xf3f0ea, roughness: 0.9 }));
    const sconceMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd29a).multiplyScalar(2.5), toneMapped: false });
    for (let x = 2.5; x < SALIM_WIDTH - 1; x += 3.4) {
      if (x > PLAN.stair.x0 - 0.4 && x < PLAN.stair.x1 + 0.4) continue; // no wall there: the stair opening
      const sc = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.26, 0.05), sconceMat);
      sc.position.set(x, y1 + 1.85, cz0 - 0.1);
      this.group.add(sc);
    }
    this.light = new THREE.PointLight(0xffcf94, 0, 12, 2);
    this.light.position.set(8.5, y1 + 2.4, (cz0 + cz1) / 2);
    this.group.add(stairMesh, floor, ceiling, this.light);
    this.group.name = 'corridor';
  }

  setLights(v: number): void {
    this.light.intensity = 7 * v;
  }
}
