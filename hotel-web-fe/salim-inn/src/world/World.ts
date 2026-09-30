// Builds and owns everything in the scene, and maps the master timeline onto
// scene state (route draw, pin, dusk lights, door, interior lights, culling).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Atmosphere } from './Sky';
import { Ground } from './Ground';
import { Roads } from './Roads';
import { FarleyBlocks } from './FarleyBlocks';
import { SalimInnBuilding, acUnitGeometry } from './SalimInnBuilding';
import { FarleySupermarket } from './FarleySupermarket';
import { Parking } from './Parking';
import { Vegetation, treeTableRows } from './Vegetation';
import { carModelMakers, type CarModel } from './cars';
import { FarField } from './FarField';
import { RouteLine } from './RouteLine';
import { Hotspots } from './Hotspots';
import { StreetLights } from './StreetLights';
import { CornerCanopy } from './CornerCanopy';
import { WalkRings } from './WalkRings';
import { Lobby } from '../interiors/Lobby';
import { ReservationCounter } from '../interiors/ReservationCounter';
import { Corridor } from '../interiors/Corridor';
import { RoomBuilder } from '../interiors/RoomBuilder';
import { POINTS, salimFrame } from './layout';
import type { Tier } from '../config/quality';
import type { RoomCode } from '../config/site';
import { GLOBAL } from './shaders';
import { setTextureLimits } from './textures';
import { bakeShadowCasters } from './ShadowCasters';
import { mergeStatic, packGroups } from './geom';
import { CULLED_LAYER, Visibility, pvsMeshes } from './Visibility';
import { interiorMaterials } from '../interiors/prepare';

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

/** Timeline span over which the showcase room's door swings open (ch. 6). */
const DOOR_OPEN: [number, number] = [0.784, 0.796];

/** Where each part can be seen at all — measured, not guessed: perf/probe.ts
 *  `audit` renders the film with and without each part, at desktop and phone
 *  framing, every 0.0025 of the timeline and from every room type's
 *  configurator view. Outside these spans a part adds draw calls and no
 *  pixels, so it is hidden (the lobby from the street, the room from the
 *  counter, the street from the stairs…). Spans carry a 0.01 margin, as the
 *  look target lags the path in playback; retake the audit after moving the
 *  camera path. Trees and cars cast live shadows, so they stay until the
 *  shadow map freezes indoors (0.6; see film.ts). */
const SEEN: Record<string, [number, number][]> = {
  ground: [[0, 0.5725], [0.785, 1]],
  roads: [[0, 0.5625], [0.785, 1]],
  'farley-blocks': [[0, 0.5725], [0.895, 1]],
  mart: [[0, 0.5325], [0.9, 1]],
  parking: [[0, 0.6175], [0.8875, 1]],
  'far-field': [[0, 0.5525], [0.8825, 1]],
  'street-lights': [[0, 0.5525], [0.805, 1]],
  trees: [[0, 0.6], [0.785, 1]],
  lobby: [[0.46, 0.7625]],
  corridor: [[0.5375, 0.675], [0.7225, 0.805]],
  room: [[0.46, 0.56], [0.7575, 0.97]],
};
const seenAt = (spans: [number, number][], p: number) => spans.some(([a, b]) => p >= a && p <= b);
/** Beyond this (metres from the room's centre) the room seen from outside
 *  drops its en-suite and beds (RoomBuilder.setFar). */
const ROOM_FAR = 30;

/** Move a group's children, except its lights, into a new child group: hiding
 *  that one hides the meshes and leaves the lights in the scene. */
function contentOf(group: THREE.Group): THREE.Group {
  const content = new THREE.Group();
  content.name = `${group.name}-content`;
  for (const c of [...group.children]) if (!(c as THREE.Light).isLight) content.add(c);
  group.add(content);
  return content;
}

/** Let the browser paint and handle input between slices of loading work. */
export const yieldToMain = (): Promise<void> => new Promise((r) => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => r();
  ch.port2.postMessage(null);
});

/** A slicer for work done while the film runs: call it between steps; once
 *  `budget` ms have gone since the last pause it waits for the next frame to
 *  be drawn (rAF, then a task after it), so the work fills the gaps between
 *  frames. While `urgent()` it never waits. */
export function slicer(budget: number, urgent: () => boolean): () => Promise<void> {
  let t0 = performance.now();
  return async () => {
    if (urgent() || performance.now() - t0 < budget) return;
    await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    t0 = performance.now();
  };
}

const hasLight = (o: THREE.Object3D) => {
  let found = false;
  o.traverse((c) => { found ||= (c as THREE.Light).isLight === true; });
  return found;
};

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
  walkRings!: WalkRings;
  interior = new THREE.Group();
  /** The interior is built after the first frame (buildInterior); these are
   *  null until then. */
  lobby: Lobby | null = null;
  corridor: Corridor | null = null;
  room: RoomBuilder | null = null;
  /** True once the interior is built, compiled and warmed. */
  interiorReady = false;
  private lobbyContent: THREE.Group | null = null;
  private corridorContent: THREE.Group | null = null;
  private roomContent: THREE.Group | null = null;
  private exteriorRoots: THREE.Object3D[] = [];
  /** Parts shown only where they can be seen (SEEN). */
  private zoned: [THREE.Object3D, [number, number][]][] = [];
  /** Each mesh drawn only where it reaches the screen (Visibility.ts). */
  visibility!: Visibility;
  /** Solid meshes the camera must never touch (clip check). */
  readonly solids: THREE.Object3D[] = [];
  private inside = false;
  private roomEnv: THREE.Texture | null = null;
  private downOn = 0;
  /** Debug/calibration: force the time of day (0 golden hour … 1 blue hour). */
  duskOverride: number | null = null;
  /** World-y threshold below which the hero's windows are lit. */
  readonly salimLevels = { value: 99 };

  async build(renderer: THREE.WebGLRenderer, tier: Tier, step: Step): Promise<void> {
    const s = this.scene;
    if (tier.name === 'high') setTextureLimits(2048, 1024);
    else setTextureLimits(1024, 512);
    s.background = new THREE.Color(0x2b3346);
    this.atmosphere = new Atmosphere(s);
    this.atmosphere.bakeEnvironment(renderer);
    this.atmosphere.setShadowResolution(tier.shadowMap);
    await step('Sky and light', 0.12);

    this.ground = new Ground(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
    mergeStatic(this.ground.group); // the rivers: five meshes, one material
    s.add(this.ground.group);
    await step('Ground and rivers', 0.22);

    this.roads = new Roads();
    s.add(this.roads.group);
    await step('Roads', 0.32);

    this.salim = new SalimInnBuilding(this.salimLevels);
    await yieldToMain();
    this.blocks = new FarleyBlocks(acUnitGeometry(true));
    await yieldToMain();
    this.mart = new FarleySupermarket();
    const canopy = new CornerCanopy().group;
    s.add(this.blocks.group, this.salim.group, this.mart.group, canopy);
    await step('Farley Commercial Centre', 0.46);

    this.salim.applyWash([this.ground.paved.material as THREE.MeshStandardMaterial]);
    // the car models and the trees' geometry a piece a task: each whole was a
    // 40–50 ms task here, 160–200 ms on a phone's CPU (Lighthouse ×4)
    const models: CarModel[] = [];
    for (const make of carModelMakers()) {
      models.push(make());
      await yieldToMain();
    }
    this.parking = new Parking(models);
    s.add(this.parking.group);
    await step('Car parks', 0.54);

    this.far = new FarField(tier.farDensity);
    s.add(this.far.group);
    await step('Sibu', 0.66);

    const rows: THREE.BufferGeometry[][] = [];
    for (const make of treeTableRows()) {
      rows.push(make());
      await yieldToMain();
    }
    this.trees = new Vegetation(tier.farTrees ? 1 : 0.6, this.atmosphere.sunDir.clone(), rows);
    await yieldToMain();
    this.lamps = new StreetLights();
    s.add(this.lamps.group);
    this.trees.setFarVisible(tier.farTrees);
    this.trees.setLodScale(tier.lodScale);
    this.parking.setLodScale(tier.lodScale);
    s.add(this.trees.group);
    this.aloftHidden = [this.lamps.poles, this.blocks.group.getObjectByName('rows-trim')].filter((o): o is THREE.Object3D => !!o);
    await step('Trees', 0.74);

    // every static exterior caster, merged into the shadow pass's own meshes
    s.add(bakeShadowCasters([this.blocks.group, this.salim.group, this.mart.group, canopy, this.parking.group, this.far.group, this.lamps.group, this.trees.group]));
    await yieldToMain();

    this.route = new RouteLine();
    this.hotspots = new Hotspots();
    this.walkRings = new WalkRings(POINTS.lobbyDoor);
    s.add(this.route.group, this.hotspots.group, this.walkRings.group);

    // The interior's frame: built after the first frame (buildInterior), but
    // placed now, last in the scene, so its meshes come after the exterior's
    // in scene order (the order Visibility's audit measured them in).
    this.interior.position.copy(salimFrame.position);
    this.interior.rotation.copy(salimFrame.rotation);
    this.interior.name = 'interiors';
    this.interior.visible = false;
    s.add(this.interior);

    await yieldToMain();
    s.traverse((o) => { if ((o as THREE.Mesh).isMesh) packGroups(o as THREE.Mesh); });
    this.solids.push(this.blocks.group, this.salim.group, this.mart.group, this.parking.group, this.trees.group, this.far.osm);
    // names for the debug overlay and perf/ breakdowns
    const named: [THREE.Object3D, string][] = [[this.ground.group, 'ground'], [this.roads.group, 'roads'], [this.blocks.group, 'farley-blocks'], [this.mart.group, 'mart'], [canopy, 'corner-canopy'], [this.parking.group, 'parking'], [this.far.group, 'far-field'], [this.lamps.group, 'street-lights'], [this.trees.group, 'trees'], [this.route.group, 'route'], [this.hotspots.group, 'hotspots'], [this.walkRings.group, 'walk-rings']];
    for (const [o, n] of named) if (!o.name) o.name = n;
    this.zoned = named.filter(([, n]) => SEEN[n]).map(([o, n]) => [o, SEEN[n]] as [THREE.Object3D, [number, number][]]);
    this.exteriorRoots = s.children.filter((o) => o !== this.interior && !hasLight(o));
    // after every merge, so the mesh list is the one the audit measured
    this.visibility = new Visibility(pvsMeshes(s, this.pvsSkip()), 'exterior');
  }

  /** Left out of the measured visibility: the room's walls move with its
   *  type (it keeps its own zoning), and the sky dome and clouds. */
  private pvsSkip(): THREE.Object3D[] {
    return [this.atmosphere.sky, this.atmosphere.clouds, ...(this.room ? [this.room.group] : [])];
  }

  /** The lobby, corridor and showcase room (brief §4.6: "interior
   *  (lazy-loaded during chapter 2–3 in the background)"): built after the
   *  first frame in slices that fill the gaps between frames — materials and
   *  their textures one at a time (the costly part), then each part — and
   *  then compiled, uploaded and drawn once off screen the same way, so the
   *  camera never meets a first use. `urgent()` true (the camera is nearly
   *  at the door): the rest runs without waiting for frames. */
  async buildInterior(renderer: THREE.WebGLRenderer, camera: THREE.Camera, target: THREE.WebGLRenderTarget, urgent: () => boolean): Promise<void> {
    const slice = slicer(8, urgent);
    const mark = (step: string) => performance.mark(`salim:interior:${step}`); // perf/load.ts
    // interiors reflect a neutral room, not the dusk sky (brief §5)
    mark('environment');
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.roomEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    await slice();
    mark('materials');
    for (const make of interiorMaterials()) {
      make();
      await slice();
    }
    mark('lobby');
    const counter = new ReservationCounter();
    await slice();
    const lobby = new Lobby(counter, false);
    lobby.group.position.y = 0.15; // the lobby is one step up, level with the five-foot way
    await slice();
    lobby.merge();
    await slice();
    mark('corridor');
    const corridor = new Corridor();
    await slice();
    mark('room');
    const room = new RoomBuilder('DLX');
    room.corridorFace.push(corridor.frontWall);
    await slice();
    // every type's pieces, so a room tab never builds on the click
    const spare: THREE.Object3D[] = [];
    for (const code of Object.keys(room.layouts) as RoomCode[]) {
      spare.push(...room.prebuild(code));
      await slice();
    }
    mark('assemble');

    // Only the sun casts shadows, and indoors it is dimmed to a sliver (see
    // update); interior pieces casting into its map doubled their draw calls
    // for nothing. They still receive the building's shadows.
    const parts = new THREE.Group();
    parts.add(lobby.group, corridor.group, room.group);
    parts.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = false; packGroups(o as THREE.Mesh); } });
    // Each part's meshes go in a child group of their own, so a part can be
    // hidden while its lights stay in the scene (see update)
    this.lobbyContent = contentOf(lobby.group);
    this.corridorContent = contentOf(corridor.group);
    this.roomContent = contentOf(room.group);
    this.interior.add(lobby.group, corridor.group, room.group);
    this.lobby = lobby;
    this.corridor = corridor;
    this.room = room;
    new THREE.Box3().setFromObject(room.group).getCenter(this.roomCentre);
    this.solids.push(lobby.group, corridor.group, room.group);
    this.zoned.push([this.lobbyContent, SEEN.lobby], [this.corridorContent, SEEN.corridor], [this.roomContent, SEEN.room]);
    this.visibility.reset();
    this.visibility = new Visibility(pvsMeshes(this.scene, this.pvsSkip()), 'full');
    await slice();

    // Shaders for the interior's light set, the exterior's included (the
    // interior's six lights join the scene from 0.47), a root at a time
    mark('compile');
    // the other types' pieces ride along in the room through compile, upload
    // and the warm-up draw (the room is outside the visibility data), then
    // wait in the pool
    room.furniture.add(...spare);
    for (const root of [...this.exteriorRoots, this.lobbyContent, this.corridorContent, this.roomContent]) {
      await this.compileRoot(renderer, camera, target, root, true);
      await slice();
    }
    mark('upload');
    await this.uploadTextures(renderer, 6, slice);
    mark('warm');
    for (const root of [...this.exteriorRoots, this.lobbyContent, this.corridorContent, this.roomContent]) {
      this.warmDraw(renderer, camera, target, root, true);
      await slice();
    }
    room.furniture.remove(...spare);
    this.interiorReady = true;
  }

  /** Compile one root's materials for the light set the film shows it under
   *  (the interior's lights in the scene or not). The film draws into the
   *  post chain's buffer (linear), not the screen (sRGB): a shader compiled
   *  for the screen is a different program and would be compiled again on
   *  first use. Roots holding lights would count them twice: pass lightless
   *  roots (the exterior's, the interior parts' content groups). */
  private compileRoot(renderer: THREE.WebGLRenderer, camera: THREE.Camera, target: THREE.WebGLRenderTarget, root: THREE.Object3D, interiorLights: boolean): Promise<unknown> {
    const was = this.interior.visible;
    renderer.setRenderTarget(target);
    this.interior.visible = interiorLights;
    const done = renderer.compileAsync(root, camera, this.scene);
    this.interior.visible = was;
    renderer.setRenderTarget(null);
    return done;
  }

  /** Before the first frame: the exterior's materials, without the interior
   *  (it is built later, with its lights; see buildInterior), a root per
   *  task — compile() does its own share of work on the main thread. */
  async precompile(renderer: THREE.WebGLRenderer, camera: THREE.Camera, target: THREE.WebGLRenderTarget): Promise<void> {
    const pending: Promise<unknown>[] = [];
    for (const o of this.exteriorRoots) {
      pending.push(this.compileRoot(renderer, camera, target, o, false));
      await yieldToMain();
    }
    await Promise.all(pending);
  }

  /** Upload every texture before its first frame, a few milliseconds at a
   *  time: a first use uploads (and mipmaps) it inside that frame, and the
   *  interior's first frame carried fifty of them. */
  async uploadTextures(renderer: THREE.WebGLRenderer, yieldEvery = 8, slice?: () => Promise<void>): Promise<void> {
    const textures = new Set<THREE.Texture>();
    const add = (v: unknown) => { if ((v as THREE.Texture)?.isTexture && !(v as THREE.Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture) textures.add(v as THREE.Texture); };
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
        for (const v of Object.values(mat)) add(v);
        const u = (mat as THREE.ShaderMaterial).uniforms;
        if (u) for (const x of Object.values(u)) add(x?.value);
      }
    });
    let t0 = performance.now();
    for (const t of textures) {
      renderer.initTexture(t); // (a texture already on the GPU is skipped)
      if (slice) await slice();
      else if (performance.now() - t0 > yieldEvery) {
        await yieldToMain();
        t0 = performance.now();
      }
    }
  }

  /** Draw one root's objects once, off screen (a 1 px scissor into the post
   *  chain's own buffer, culling off), under the given light set, and put
   *  everything back before returning — the film may be running. A mesh's
   *  first draw uploads its geometry, looks up its program's uniforms and has
   *  the GPU build its pipeline state; left to the film, that landed in the
   *  frame where the interior came into view and stalled it for half a
   *  second. */
  private warmDraw(renderer: THREE.WebGLRenderer, camera: THREE.Camera, target: THREE.WebGLRenderTarget, root: THREE.Object3D, interiorLights: boolean): void {
    const saved: [THREE.Object3D, boolean, boolean][] = [];
    this.scene.traverse((o) => saved.push([o, o.visible, o.frustumCulled]));
    const scissor = [target.scissorTest, target.scissor.clone()] as const;
    const shadows = renderer.shadowMap.autoUpdate;
    try {
      for (const o of this.exteriorRoots) o.visible = false;
      this.interior.visible = interiorLights;
      for (const c of [this.lobbyContent, this.corridorContent, this.roomContent]) if (c) c.visible = false;
      root.traverse((o) => { o.visible = true; o.frustumCulled = false; });
      for (let p = root.parent; p && p !== this.scene; p = p.parent) p.visible = true;
      camera.layers.enable(CULLED_LAYER); // meshes culled this frame are warmed too
      renderer.shadowMap.autoUpdate = false; // the map stays the film's
      target.scissorTest = true;
      target.scissor.set(0, 0, 1, 1);
      renderer.setRenderTarget(target);
      renderer.render(this.scene, camera);
      renderer.setRenderTarget(null);
    } finally {
      for (const [o, v, f] of saved) { o.visible = v; o.frustumCulled = f; }
      target.scissorTest = scissor[0];
      target.scissor.copy(scissor[1]);
      camera.layers.disable(CULLED_LAYER);
      renderer.shadowMap.autoUpdate = shadows;
    }
  }

  /** Before the first frame: each exterior root drawn once (warmDraw). */
  async warmUp(renderer: THREE.WebGLRenderer, camera: THREE.Camera, target: THREE.WebGLRenderTarget): Promise<void> {
    for (const root of this.exteriorRoots) {
      this.warmDraw(renderer, camera, target, root, false);
      await yieldToMain();
    }
  }

  applyTier(t: Tier): void {
    this.atmosphere.setShadowResolution(t.shadowMap);
    this.trees.setFarVisible(t.farTrees && !this.inside);
    this.trees.setLodScale(t.lodScale);
    this.parking.setLodScale(t.lodScale);
  }

  /** Under a pixel from high above the town, and 55k triangles between them
   *  (brief §8, phones): the lamp posts (their lamps stay) and the shop rows'
   *  trim. Tiers below high leave them out above 250 m. */
  private aloftHidden: THREE.Object3D[] = [];
  private aloft = false;

  private readonly subjectAt = new THREE.Vector3();
  private readonly roomCentre = new THREE.Vector3();
  /** Depth of field's subject where it is not the camera's aim (null):
   *  from the room door to the window, the beds (CameraRig.subject). */
  subject(p: number): THREE.Vector3 | null {
    return this.room && p > DOOR_OPEN[1] && p < 0.9 ? this.room.bedCentre(this.subjectAt) : null;
  }

  /** Scene state for timeline progress p. */
  update(p: number, dt: number, camera: THREE.PerspectiveCamera, focus: THREE.Vector3, tier: Tier): void {
    this.atmosphere.update(dt, camera, focus);
    this.parking.update(camera.position);
    this.trees.update(camera.position);
    const aloft = tier.lodScale < 1 && camera.position.y > 250;
    if (aloft !== this.aloft) {
      this.aloft = aloft;
      for (const o of this.aloftHidden) o.visible = !aloft;
    }

    // chapter 2: the flying line draws; gone once we are on the ground
    const route = ramp(p, 0.13, 0.34);
    this.route.setProgress(route, dt);
    this.route.setFade(1 - ramp(p, 0.36, 0.41));
    this.route.group.visible = p > 0.125 && p < 0.42;

    // chapter 3: pin + pulse rings lock on; fade as we land
    this.hotspots.setReveal(ramp(p, 0.355, 0.4) * (1 - ramp(p, 0.49, 0.53)));
    this.hotspots.update(dt);
    // chapter 7: walking-time rings from the hotel door
    this.walkRings.setProgress(p);

    // dusk: the film runs from golden hour to blue hour
    const d = this.duskOverride ?? duskAt(p);
    GLOBAL.uDusk.value = d;
    GLOBAL.uLights.value = THREE.MathUtils.clamp(0.2 + d * 1.35, 0, 1);
    GLOBAL.uTime.value += dt;
    this.atmosphere.setDusk(d);
    // indoors the low sun through the entrance glazing drew a hard, bright
    // patch across the lobby wall; the interior is lit by its own lamps.
    // Upstairs it goes out: nothing indoors casts into its map (buildInterior)
    // and the map is held from the lobby door (film.ts), so its sliver came
    // through the room window unshadowed and lit the wardrobe's chrome pull
    // like a lamp
    const indoors = ramp(p, 0.556, 0.582) * (1 - ramp(p, 0.878, 0.9));
    this.atmosphere.sun.intensity *= 1 - (0.85 + 0.15 * ramp(p, 0.72, 0.75)) * indoors;
    // doorway (ch. 4 → 5) and window (ch. 7): the environment dips to nothing,
    // swaps between the dusk sky and the room, and comes back up
    const envIn = ramp(p, 0.574, 0.586) * (1 - ramp(p, 0.884, 0.896));
    const envOut = (1 - ramp(p, 0.562, 0.574)) + ramp(p, 0.896, 0.908);
    const sc = this.scene;
    if (envIn > 0 && this.roomEnv) {
      sc.environment = this.roomEnv;
      // the lobby keeps less ambient than the rooms, so its lamps, scallops
      // and cove carry the light (brief §4.4: the most "hospitality" moment)
      sc.environmentIntensity = envIn * THREE.MathUtils.lerp(0.36, 0.55, ramp(p, 0.735, 0.785));
    } else {
      sc.environment = this.atmosphere.envMap;
      sc.environmentIntensity *= Math.min(1, envOut);
    }
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

    // Interior lights only while we can see them. Each lit material carries
    // one compiled shader per count of lights in view, so the six interior
    // lights enter and leave the scene together, once each way (with the
    // interior, at 0.47 and 0.96; both variants are compiled before either is
    // needed: the exterior's before the first frame, the rest with the
    // interior in buildInterior). Between those points a part that drops out hides its meshes and
    // turns its lights down, but its lights stay: taking the lobby's out as
    // the camera went upstairs recompiled every shader in view — a 300 ms stall.
    const inLight = ramp(p, 0.52, 0.56) * (1 - ramp(p, 0.915, 0.945));
    this.interior.visible = this.interiorReady && p > 0.47 && p < 0.96;
    if (this.lobby && this.corridor && this.room) {
      // the lobby drops out once the camera is upstairs, the corridor once it
      // has left through the room window
      const lobbyOn = p < 0.795, corridorOn = p < 0.9;
      this.lobby.setLights(lobbyOn ? inLight : 0);
      this.lobby.update();
      // chapter 5: the key cards fan out of their sleeve as we reach the counter
      this.lobby.counter.setFan(ramp(p, 0.655, 0.7));
      this.corridor.setLights(corridorOn ? inLight : 0);
      this.room.setLights(inLight);
      this.room.update(dt);
      // chapter 6: the door swings open as the camera reaches it; chapter 7:
      // the curtains draw back for the exit through the window
      this.room.setDoor(ramp(p, DOOR_OPEN[0], DOOR_OPEN[1]) * (1 - ramp(p, 0.95, 0.96)));
      this.room.openCurtainsForExit(ramp(p, 0.874, 0.89));
      const street = p < 0.56 || p > 0.905;
      this.room.setStreetView(street);
      this.room.setFar(street && camera.position.distanceToSquared(this.roomCentre) > ROOM_FAR * ROOM_FAR);
    }

    // culling: each part only where it can be seen, and the far trees'
    // canopy layer off while inside the block
    for (const [o, spans] of this.zoned) o.visible = seenAt(spans, p);
    this.visibility.update(p, innerWidth / innerHeight);
    const inside = p > 0.585 && p < 0.892;
    if (inside !== this.inside) {
      this.inside = inside;
      this.trees.setFarVisible(!inside && tier.farTrees);
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
