// Builds and owns everything in the scene, and maps the master timeline onto
// scene state (route draw, pin, dusk lights, door, interior lights, culling).
import * as THREE from 'three';
import { Atmosphere } from './Sky';
import { Ground } from './Ground';
import { Roads } from './Roads';
import { FarleyBlocks } from './FarleyBlocks';
import { SalimInnBuilding, acUnitGeometry } from './SalimInnBuilding';
import { FarleySupermarket } from './FarleySupermarket';
import { Parking } from './Parking';
import { Vegetation } from './Vegetation';
import { FarField } from './FarField';
import { RouteLine } from './RouteLine';
import { Hotspots } from './Hotspots';
import { StreetLights } from './StreetLights';
import { CornerCanopy } from './CornerCanopy';
import { Lobby } from '../interiors/Lobby';
import { Corridor } from '../interiors/Corridor';
import { RoomBuilder } from '../interiors/RoomBuilder';
import { salimFrame } from './layout';
import type { Tier } from '../config/quality';
import { GLOBAL } from './shaders';

const ramp = (p: number, a: number, b: number) => THREE.MathUtils.smoothstep(p, a, b);

/** Golden hour (0) → blue hour (1) across the film. */
const DUSK_KEYS: [number, number][] = [[0, 0.06], [0.35, 0.3], [0.48, 0.52], [0.58, 0.6], [0.9, 0.72], [1, 0.84]];
export function duskAt(p: number): number {
  for (let i = 0; i < DUSK_KEYS.length - 1; i++) {
    const [a, va] = DUSK_KEYS[i], [b, vb] = DUSK_KEYS[i + 1];
    if (p <= b) return va + (vb - va) * THREE.MathUtils.smoothstep(p, a, b);
  }
  return DUSK_KEYS[DUSK_KEYS.length - 1][1];
}

export type Step = (label: string, fraction: number) => Promise<void>;

export class World {
  readonly scene = new THREE.Scene();
  atmosphere!: Atmosphere;
  ground!: Ground;
  roads!: Roads;
  blocks!: FarleyBlocks;
  salim!: SalimInnBuilding;
  mart!: FarleySupermarket;
  parking!: Parking;
  trees!: Vegetation;
  far!: FarField;
  lamps!: StreetLights;
  route!: RouteLine;
  hotspots!: Hotspots;
  interior = new THREE.Group();
  lobby!: Lobby;
  corridor!: Corridor;
  room!: RoomBuilder;
  /** Solid meshes the camera must never touch (clip check). */
  readonly solids: THREE.Object3D[] = [];
  private inside = false;
  private downOn = 0;
  /** Debug/calibration: force the time of day (0 golden hour … 1 blue hour). */
  duskOverride: number | null = null;
  /** World-y threshold below which the hero's windows are lit. */
  readonly salimLevels = { value: 99 };

  async build(renderer: THREE.WebGLRenderer, tier: Tier, step: Step): Promise<void> {
    const s = this.scene;
    s.background = new THREE.Color(0x2b3346);
    this.atmosphere = new Atmosphere(s);
    this.atmosphere.bakeEnvironment(renderer);
    this.atmosphere.setShadowResolution(tier.shadowMap);
    await step('Sky and light', 0.12);

    this.ground = new Ground(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
    s.add(this.ground.group);
    await step('Ground and rivers', 0.22);

    this.roads = new Roads();
    s.add(this.roads.group);
    await step('Roads', 0.32);

    this.salim = new SalimInnBuilding(this.salimLevels);
    this.blocks = new FarleyBlocks(acUnitGeometry(true));
    this.mart = new FarleySupermarket();
    s.add(this.blocks.group, this.salim.group, this.mart.group, new CornerCanopy().group);
    await step('Farley Commercial Centre', 0.46);

    this.salim.applyWash([this.ground.paved.material as THREE.MeshStandardMaterial]);
    this.parking = new Parking();
    s.add(this.parking.group);
    await step('Car parks', 0.54);

    this.far = new FarField(tier.farDensity);
    s.add(this.far.group);
    await step('Sibu', 0.66);

    this.trees = new Vegetation(tier.farTrees ? 1 : 0.6, this.atmosphere.sunDir.clone());
    this.lamps = new StreetLights();
    s.add(this.lamps.group);
    this.trees.setFarVisible(tier.farTrees);
    s.add(this.trees.group);
    await step('Trees', 0.74);

    this.route = new RouteLine();
    this.hotspots = new Hotspots();
    s.add(this.route.group, this.hotspots.group);

    // Interiors live in the Salim Inn block frame.
    this.interior.position.copy(salimFrame.position);
    this.interior.rotation.copy(salimFrame.rotation);
    this.lobby = new Lobby();
    this.lobby.group.position.y = 0.15; // the lobby is one step up, level with the five-foot way
    this.corridor = new Corridor();
    this.room = new RoomBuilder('DLX');
    this.interior.add(this.lobby.group, this.corridor.group, this.room.group);
    this.interior.name = 'interiors';
    s.add(this.interior);
    await step('Lobby and rooms', 0.82);

    this.solids.push(this.blocks.group, this.salim.group, this.mart.group, this.parking.group, this.trees.group, this.far.osm, this.lobby.group, this.corridor.group, this.room.group);
  }

  applyTier(t: Tier): void {
    this.atmosphere.setShadowResolution(t.shadowMap);
    this.trees.setFarVisible(t.farTrees && !this.inside);
  }

  /** Scene state for timeline progress p. */
  update(p: number, dt: number, camera: THREE.PerspectiveCamera, focus: THREE.Vector3, tier: Tier): void {
    this.atmosphere.update(dt, camera, focus);
    this.parking.update(camera.position);
    this.trees.update(camera.position);

    // chapter 2: the flying line draws; gone once we are on the ground
    const route = ramp(p, 0.13, 0.34);
    this.route.setProgress(route, dt);
    this.route.setFade(1 - ramp(p, 0.36, 0.41));
    this.route.group.visible = p > 0.125 && p < 0.42;

    // chapter 3: pin + pulse rings lock on; fade as we land
    this.hotspots.setReveal(ramp(p, 0.355, 0.4) * (1 - ramp(p, 0.49, 0.53)));
    this.hotspots.update(dt);

    // dusk: the film runs from golden hour to blue hour
    const d = this.duskOverride ?? duskAt(p);
    GLOBAL.uDusk.value = d;
    GLOBAL.uLights.value = THREE.MathUtils.clamp(0.2 + d * 1.35, 0, 1);
    GLOBAL.uTime.value += dt;
    this.atmosphere.setDusk(d);
    // chapter 3: the roof sign lights up, then the windows floor by floor
    const sign = ramp(p, 0.37, 0.43);
    this.salimLevels.value = THREE.MathUtils.lerp(-1, 13, ramp(p, 0.4, 0.465));
    // chapter 4: canopy downlights switch on one after another, 40 ms apart
    if (p > 0.49) this.downOn = Math.min(this.salim.downlightCount + 1, this.downOn + dt / 0.04);
    else if (p < 0.47) this.downOn = 0;
    this.salim.setDusk(sign, this.downOn);
    this.blocks.setDusk(GLOBAL.uLights.value * ramp(p, 0.2, 0.45));
    this.lamps.update(ramp(d, 0.18, 0.5));
    this.mart.setDusk(GLOBAL.uLights.value);

    // chapter 4: the glass door slides as we reach it
    this.salim.setDoor(ramp(p, 0.545, 0.572) * (1 - ramp(p, 0.9, 0.95)));

    // interior lights only while we can see them
    const inLight = ramp(p, 0.52, 0.56) * (1 - ramp(p, 0.915, 0.945));
    this.lobby.setLights(inLight);
    this.corridor.setLights(inLight);
    this.room.setLights(inLight);
    this.interior.visible = p > 0.47 && p < 0.96;

    // culling: far field off while inside the block
    const inside = p > 0.585 && p < 0.892;
    if (inside !== this.inside) {
      this.inside = inside;
      this.far.group.visible = !inside;
      this.trees.setFarVisible(!inside && tier.farTrees);
      this.ground.group.visible = true;
    }

    // near/far planes follow altitude (keeps depth precision everywhere)
    const h = Math.max(0.5, camera.position.y);
    const near = THREE.MathUtils.clamp(h * 0.004, 0.05, 7);
    const far = THREE.MathUtils.clamp(2600 + h * 26, 2600, 52000);
    if (Math.abs(camera.near - near) > 1e-3 || Math.abs(camera.far - far) > 1) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
  }
}
