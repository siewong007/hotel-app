import * as THREE from './vendor/three.module.min.js';
import { SALIM_APPROACH } from './site/plan.js';
import { clamp, range, spriteLabel, SITE_W, SITE_CENTRE } from './site/core.js';
import { buildGround } from './site/ground.js';
import { buildFarley } from './site/farley.js';
import { buildSalim } from './site/salim.js';
import { buildCarPark } from './site/carpark.js';
import { buildDressing } from './site/dressing.js';
import { buildInterior } from './site/interior.js';
import { buildPaths } from './site/camera.js';
import { buildSky, HAZE } from './site/sky.js';

// Scroll-driven flythrough from the Farley Commercial Centre apron to a room
// at Salim Inn, Lorong Salim 17, Sibu. The world is built in site/*; this file
// owns the renderer, the lighting, the stage choreography and the UI wiring.

const scene = new THREE.Scene();
// Sky and fog share one colour so the distance falloff resolves into the
// horizon haze instead of fighting it. The scene used to clear to near-black,
// which read as dusk against reference footage shot at tropical midday.
const HAZE_C = new THREE.Color(HAZE);
const INDOOR_C = new THREE.Color(0x1b1610);
scene.background = new THREE.Color(HAZE);
// Tuned against the opening framing: the establishing camera sits ~220 m from
// the apron, so anything denser than this washes the whole block to background.
scene.fog = new THREE.FogExp2(HAZE, 0.0016);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 1400);
const renderer = new THREE.WebGLRenderer({
  canvas: document.querySelector('#webgl'),
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
// Pulled back from 1.08 now that a lit sky fills the frame; the cream facades
// were clipping to flat white against it at the old exposure.
renderer.toneMappingExposure = 1.02;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const sky = buildSky(scene);
// The sky doubles as the environment map. Without it the glazing, the metal
// roofs and the parked cars have nothing to reflect and read as flat paint;
// with it the windows pick up the sky the way they do in the footage. The
// PMREM is generated once and the working render target released.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromEquirectangular(sky.map).texture;
pmrem.dispose();
// Sky and bounce colours sampled from the same footage as the dome: a strong
// blue ambient from above, warm dry concrete bouncing back up. Lower than it
// would otherwise be, because the environment map now carries the skylight.
const hemi = new THREE.HemisphereLight(0xbcd9f2, 0x7c7767, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d8, 3.1);
// Aimed at the middle of the complex rather than the world origin, which sits
// on the Salim Inn pin at the north-east corner.
//
// High and to the north. The old WSW position front-lit Farley's WNW frontage
// and left the Salim Inn frontage — which faces ENE, and which the whole
// second half of the sequence looks straight at — in its own shadow for the
// entire walk. From the north both read, Salim Inn strongly and Farley at a
// raking angle, and at 2°N a near-overhead northerly sun is the real thing.
sun.position.set(SITE_CENTRE[0] + 60, 250, SITE_CENTRE[1] - 230);
sun.target.position.set(SITE_CENTRE[0], 0, SITE_CENTRE[1]);
scene.add(sun.target);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
// Coverage spans the complex without wasting texels on the empty margins.
for (const [k, v] of [['left', -140], ['right', 140], ['top', 140], ['bottom', -140]]) sun.shadow.camera[k] = v;
sun.shadow.camera.far = 620;
sun.shadow.bias = -0.0006;
scene.add(sun);
const fill = new THREE.DirectionalLight(0x9dc4dc, 0.7);
fill.position.set(150, 90, -90);
scene.add(fill);

const ground = buildGround(scene, renderer);
const farley = buildFarley(scene);
const salim = buildSalim(scene);
const carpark = buildCarPark(scene);
const dressing = buildDressing(scene);
const interior = buildInterior(salim);
const { samplePath } = buildPaths(salim, farley, interior);

const parkingWorld = new THREE.Vector3(SALIM_APPROACH[0], 0.8, SALIM_APPROACH[1]);
const parkingLabel = spriteLabel('GUEST PARKING', true, 3.2);
parkingLabel.position.copy(parkingWorld).setY(2.6);
scene.add(parkingLabel);

// Locator rings and light beam over the hotel, shown while the camera is high.
const salimWorld = new THREE.Vector3(salim.hotel.x, 0, salim.hotel.z);
const ringMat = new THREE.MeshBasicMaterial({
  color: 0xd8b36d, transparent: true, opacity: 0.62, side: THREE.DoubleSide,
});
const rings = [];
for (let i = 0; i < 3; i++) {
  const rr = new THREE.Mesh(new THREE.RingGeometry(6 + i * 4.5, 6.7 + i * 4.5, 80), ringMat.clone());
  rr.rotation.x = -Math.PI / 2;
  rr.position.set(salimWorld.x, 0.2, salimWorld.z);
  rr.userData.o = i * 0.8;
  scene.add(rr);
  rings.push(rr);
}
const beam = new THREE.Mesh(
  new THREE.CylinderGeometry(0.3, 2.2, 95, 20, 1, true),
  new THREE.MeshBasicMaterial({
    color: 0xd8b36d, transparent: true, opacity: 0.05, depthWrite: false,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  })
);
beam.position.set(salimWorld.x, 47, salimWorld.z);
scene.add(beam);

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
scrollTo({ top: 0, behavior: 'auto' });

const state = { progress: 0, target: 0, autoplayProgress: 0, stage: -1, playing: true, alignment: true };
const copy = [
  { i: '01', k: 'Your Sibu base', t: 'Easy to find at Farley', b: 'See exactly where Salim Inn sits, how to approach the frontage, and where to park before you arrive.' },
  { i: '02', k: 'A connected location', t: 'Everything at Farley, close at hand', b: 'Shops, dining, and everyday conveniences sit around your stay, so errands and easy meals never feel far away.' },
  { i: '03', k: 'A simple arrival', t: 'Drive up and park out front', b: 'Follow the perimeter road to the Salim Inn frontage, with dedicated guest parking positioned directly outside.' },
  { i: '04', k: 'A warm welcome', t: 'Step straight into reception', b: 'From the parking bays, the route continues through the hotel entrance to a straightforward, friendly check-in.' },
  { i: '05', k: 'Time to unwind', t: 'A comfortable room awaits upstairs', b: 'Settle into a clean, practical room designed for a restful night after a full day in Sibu.' },
];

const phaseButtons = [...document.querySelectorAll('.phase')];
const stageIndex = document.querySelector('#stageIndex');
const stageKicker = document.querySelector('#stageKicker');
const stageTitle = document.querySelector('#stageTitle');
const stageBody = document.querySelector('#stageBody');
const heroCopy = document.querySelector('#heroCopy');
const progressBar = document.querySelector('#progressBar');
const transitionFlare = document.querySelector('#transitionFlare');
const phaseStops = [0, 0.31, 0.52, 0.76, 1];

function setStage(i) {
  if (state.stage === i) return;
  state.stage = i;
  phaseButtons.forEach((b, n) => b.classList.toggle('is-active', n === i));
  const c = copy[i];
  stageIndex.textContent = c.i;
  stageKicker.textContent = c.k;
  stageTitle.textContent = c.t;
  stageBody.textContent = c.b;
  heroCopy.style.opacity = i < 2 ? '1' : '0';
  heroCopy.style.transform = `translateY(-50%) translateX(${i < 2 ? 0 : -30}px)`;
}

function scrollPhase(i) {
  state.playing = false;
  const sec = document.querySelector('.experience');
  const max = sec.offsetHeight - innerHeight;
  scrollTo({ top: sec.offsetTop + max * phaseStops[i], behavior: 'smooth' });
}
phaseButtons.forEach((b, i) => { b.onclick = () => scrollPhase(i); });

function onScroll() {
  const sec = document.querySelector('.experience');
  const max = Math.max(1, sec.offsetHeight - innerHeight);
  const p = clamp((scrollY - sec.offsetTop) / max, 0, 1);
  if (!state.playing) state.target = p;
  progressBar.style.width = `${p * 100}%`;
  setStage(Math.min(4, Math.floor(p * 5)));
  transitionFlare.style.opacity =
    Math.sin(range(p, 0.58, 0.72) * Math.PI) * 0.2 + Math.sin(range(p, 0.79, 0.93) * Math.PI) * 0.16;
}
addEventListener('scroll', onScroll, { passive: true });
onScroll();

function setOpacity(meshes, value) {
  for (const m of meshes) {
    if (Array.isArray(m.material)) for (const mm of m.material) mm.opacity = value;
    else m.material.opacity = value;
  }
}

function updateScene(p) {
  camera.position.copy(samplePath(p, 'pos'));
  camera.lookAt(samplePath(p, 'tar'));
  camera.fov =
    THREE.MathUtils.lerp(38, 47, range(p, 0.4, 0.7)) - THREE.MathUtils.lerp(0, 4, range(p, 0.76, 1));
  camera.updateProjectionMatrix();

  // The walk now ends standing in the bays at p≈0.63, so the dissolve holds
  // off until the interior spline takes over at 0.64. Starting it at 0.57, as
  // before, meant the frontage was already half transparent by the time the
  // camera arrived in front of it.
  const enter = range(p, 0.64, 0.76);
  const roomReveal = range(p, 0.78, 0.93);
  const recFade = 1 - range(p, 0.84, 0.96);
  const shellFade = 1 - 0.96 * range(p, 0.66, 0.78);
  const worldFade = THREE.MathUtils.lerp(1, 0.05, range(p, 0.66, 0.80));

  // Faded out before the camera reaches street level: at a grazing angle the
  // plan's road bands foreshorten into a bright wedge across the foreground.
  ground.underlayMat.opacity = THREE.MathUtils.lerp(state.alignment ? 0.95 : 0.12, 0.02, range(p, 0.3, 0.52));
  setOpacity(dressing.shells, THREE.MathUtils.lerp(0.97, 0.04, range(p, 0.66, 0.80)));
  setOpacity(salim.exterior, shellFade);
  setOpacity(farley.shell, worldFade);
  setOpacity(carpark.meshes, worldFade);
  salim.roofSignMesh.material.opacity = 1 - range(p, 0.66, 0.79);
  salim.cafeMesh.material.opacity = 1 - range(p, 0.66, 0.79);
  parkingLabel.material.opacity = range(p, 0.3, 0.44) * (1 - range(p, 0.5, 0.6));

  for (const m of interior.interiorMeshes) m.material.opacity = enter * recFade;
  interior.recSign.material.opacity = enter * recFade;
  for (const m of interior.roomMeshes) m.material.opacity = roomReveal;
  interior.roomDoorPivot.rotation.y = -Math.PI * 0.48 * range(p, 0.86, 0.97);

  const far = p < 0.42;
  for (const r of rings) r.visible = far;
  beam.visible = far;
  dressing.group.visible = p < 0.84;
  dressing.props.visible = p < 0.84;
  ground.group.visible = p < 0.86;
  carpark.group.visible = p < 0.86;
  scene.fog.density = THREE.MathUtils.lerp(0.0016, 0.02, range(p, 0.82, 1));

  // Once the shell has dissolved and the camera is inside the room, the
  // daylight dome is no longer a horizon — it is a lit backdrop directly
  // behind a small interior, and holding it there blows the room out. It is
  // dropped and the fog carried to a warm interior tone instead.
  const indoors = range(p, 0.78, 0.9);
  sky.dome.visible = indoors < 0.98;
  sky.dome.material.opacity = 1 - indoors;
  sky.dome.material.transparent = indoors > 0;
  scene.fog.color.copy(HAZE_C).lerp(INDOOR_C, indoors);
  scene.background.copy(HAZE_C).lerp(INDOOR_C, indoors);
}

const hotelHotspot = document.querySelector('#hotelHotspot');
const parkingHotspot = document.querySelector('#parkingHotspot');
function project(el, world, visible) {
  const v = world.clone().project(camera);
  const ok = v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && visible;
  el.classList.toggle('is-visible', ok);
  if (ok) {
    el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
    el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
  }
}

const info = document.querySelector('#infoCard');
function openInfo(k, t, b) {
  document.querySelector('#infoKicker').textContent = k;
  document.querySelector('#infoTitle').textContent = t;
  document.querySelector('#infoBody').textContent = b;
  info.classList.add('is-open');
}
document.querySelector('#closeInfo').onclick = () => info.classList.remove('is-open');
hotelHotspot.onclick = () => openInfo(
  'Reception entrance', 'Welcome to Salim Inn',
  'The reception entrance sits under the covered five-foot way, between the stone-clad wall and the Salim Inn sign, facing the car park.'
);
parkingHotspot.onclick = () => openInfo(
  'Easy arrival', 'Park right out front',
  'Guest parking sits on the Farley apron directly outside the frontage, a few steps from the entrance.'
);
const mapToggle = document.querySelector('#mapToggle');
mapToggle.onclick = () => {
  state.alignment = !state.alignment;
  mapToggle.textContent = `Map alignment: ${state.alignment ? 'on' : 'off'}`;
  mapToggle.setAttribute('aria-pressed', String(state.alignment));
};

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.04, clock.getDelta());
  if (state.playing) {
    state.autoplayProgress += dt * 0.05;
    state.target = state.autoplayProgress;
    if (state.target >= 1) {
      state.target = 1;
      state.playing = false;
    }
    const sec = document.querySelector('.experience');
    const max = sec.offsetHeight - innerHeight;
    scrollTo({ top: sec.offsetTop + max * state.target, behavior: 'instant' });
  }
  state.progress += (state.target - state.progress) * 0.065;
  const time = clock.elapsedTime;
  rings.forEach((r) => {
    r.scale.setScalar(1 + Math.sin(time * 1.55 + r.userData.o) * 0.06);
    r.material.opacity = 0.45 + Math.sin(time * 1.4 + r.userData.o) * 0.16;
  });
  beam.material.opacity = 0.05 + Math.sin(time * 1.2) * 0.02;
  updateScene(state.progress);
  sky.follow(camera);
  project(hotelHotspot, salim.doorWorld.clone().add(new THREE.Vector3(0, 1.6, 0)), state.progress > 0.34 && state.progress < 0.66);
  project(parkingHotspot, parkingWorld.clone().setY(2.2), state.progress > 0.35 && state.progress < 0.66);
  renderer.render(scene, camera);
}
animate();

function resize() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 800 ? 1.25 : 1.75));
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// Exposed for the frame-matching and performance harness in dev; harmless in
// production and tree-shaken out of nothing since this is the entry module.
window.__salimScene = { scene, camera, renderer, state, samplePath, updateScene, SITE_W };
