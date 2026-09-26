// Salim Inn · From Skyview to Stay — entry point.
// One pinned canvas, HTML chapters above it; smoothed scroll → one master
// timeline → camera rig + scene state + DOM.
import './styles/main.css';
import './styles/sections.css';
import * as THREE from 'three';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Renderer } from './experience/Renderer';
import { CameraRig } from './experience/CameraRig';
import { PATH } from './experience/cameraPath';
import { Timeline, CHAPTERS } from './experience/Timeline';
import { Post } from './experience/Post';
import { Preloader, nextFrame } from './experience/Preloader';
import { detectTier, FpsGovernor } from './experience/Quality';
import { World } from './world/World';
import { LOOK } from './world/Sky';
import { salimLocal } from './world/layout';
import { Chapters } from './ui/Chapters';
import type { Tier } from './config/quality';

gsap.registerPlugin(ScrollTrigger);

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const NO_POST = params.get('post') === '0';
if (params.get('ui') === '0') document.documentElement.classList.add('no-ui');

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  const pre = new Preloader();
  const chapters = new Chapters();
  pre.set(0.04, 'Loading the neighbourhood');

  if (!webglAvailable()) {
    // Milestone 4 replaces this with the full poster-frame fallback page.
    document.documentElement.classList.add('no-webgl');
    pre.done();
    return;
  }

  const { tier: detected, gpu, reason } = await detectTier();
  let tier: Tier = detected;
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const renderer = new Renderer(canvas);
  renderer.resize(tier);
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 50000);
  const timeline = new Timeline();
  const world = new World();

  await world.build(renderer.gl, tier, async (label, f) => {
    pre.set(0.08 + f * 0.72, label);
    await nextFrame();
  });

  const rig = new CameraRig(camera);
  rig.setAspect(innerWidth / innerHeight);
  const post = new Post(renderer.gl, world.scene, camera);
  post.applyTier(tier);
  post.setSize(renderer.width, renderer.height);

  // Smooth scroll: Lenis drives the page, GSAP's ticker drives everything.
  const lenis = new Lenis({ lerp: 0.085, smoothWheel: true, wheelMultiplier: 0.9, touchMultiplier: 1.2 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.lagSmoothing(0);

  const progressFromScroll = () => {
    const y = lenis.animatedScroll - chapters.storyTop;
    return Math.min(1, Math.max(0, y / chapters.scrollLength));
  };
  const scrollForProgress = (p: number) => chapters.storyTop + p * chapters.scrollLength;

  // Chapter jumps and the sticky Book CTA.
  chapters.onJump = (p) => lenis.scrollTo(scrollForProgress(p), { duration: 2.4, easing: (t) => 1 - Math.pow(1 - t, 4) });
  const toBook = (e: Event) => {
    e.preventDefault();
    const c8 = CHAPTERS[CHAPTERS.length - 1];
    lenis.scrollTo(scrollForProgress(c8.p0 + 0.02), { duration: 3.2, easing: (t) => 1 - Math.pow(1 - t, 4) });
  };
  document.querySelectorAll<HTMLAnchorElement>('a[href="#book"]').forEach((a) => a.addEventListener('click', toBook));

  // Play film: auto-scrub the whole timeline in ~60 s.
  const playBtn = document.getElementById('play') as HTMLButtonElement;
  let playing = false;
  const setPlaying = (v: boolean) => {
    playing = v;
    playBtn.textContent = v ? 'Pause film' : timeline.progress > 0.99 ? 'Replay film' : 'Play film';
    playBtn.setAttribute('aria-pressed', String(v));
  };
  playBtn.addEventListener('click', () => {
    if (playing) {
      lenis.scrollTo(lenis.animatedScroll, { immediate: true });
      setPlaying(false);
      return;
    }
    const from = timeline.progress > 0.99 ? 0 : timeline.progress;
    if (from === 0) lenis.scrollTo(scrollForProgress(0), { immediate: true });
    setPlaying(true);
    lenis.scrollTo(scrollForProgress(1), { duration: 60 * (1 - from), easing: (t) => t, lock: false, onComplete: () => setPlaying(false) });
  });
  window.addEventListener('wheel', () => playing && setPlaying(false), { passive: true });
  window.addEventListener('touchstart', () => playing && setPlaying(false), { passive: true });

  // Resize
  const onResize = () => {
    renderer.resize(tier);
    rig.setAspect(innerWidth / innerHeight);
    post.setSize(renderer.width, renderer.height);
    chapters.layout();
    lenis.resize();
  };
  window.addEventListener('resize', onResize);

  // Adaptive quality
  const governor = new FpsGovernor(tier);
  governor.onDrop = (t) => {
    tier = t;
    renderer.resize(tier);
    post.applyTier(tier);
    post.setSize(renderer.width, renderer.height);
    world.applyTier(tier);
  };

  // Precompile every material before the preloader leaves (no first-use hitches).
  pre.set(0.84, 'Warming up the lights');
  rig.update(0, 0);
  world.update(0, 0, camera, rig.lookTarget, tier);
  world.interior.visible = true;
  await renderer.gl.compileAsync(world.scene, camera);
  pre.set(0.95, 'Almost there');

  // Debug overlay (dynamic import keeps stats-gl / three-mesh-bvh out of the main bundle).
  let debug: import('./experience/Debug').Debug | null = null;
  if (DEBUG) {
    const mod = await import('./experience/Debug');
    debug = new mod.Debug(renderer.gl);
    debug.extra.tier = `${tier.name} (${reason}; ${gpu})`;
    const report = mod.clipCheck(rig, world.solids);
    const worst = report.hits.slice(0, 20).map((h) => `p=${h.p.toFixed(4)} d=${h.d.toFixed(3)} ${h.mesh}`);
    console.info('[clip-check]', { samples: report.samples, minDistance: report.minDistance, hits: report.hits.length, worst });
    debug.extra.clip = `${report.hits.length} hits (<0.3 m) · min ${report.minDistance.toFixed(2)} m over ${report.samples} samples`;
    (window as unknown as Record<string, unknown>).__clip = report;
  }

  // Frame loop
  let last = performance.now();
  let frameCalls = { calls: 0, triangles: 0 };
  let filmPast = false;
  const tick = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    lenis.raf(now);
    // Past the film the page's own sections cover the canvas: stop drawing
    // (and let the fixed film layers step aside) until the visitor scrolls back.
    const past = lenis.animatedScroll >= chapters.storyTop + chapters.storyHeight - 2;
    if (past !== filmPast) {
      filmPast = past;
      document.documentElement.classList.toggle('film-past', past);
    }
    if (past) return;
    const p = progressFromScroll();
    timeline.set(p);
    chapters.setActive(timeline.chapter.id);
    document.getElementById('mobile-cta')?.classList.toggle('is-visible', p > 0.02 && p < 0.95);

    const idle = THREE.MathUtils.smoothstep(p, 0.965, 1);
    rig.update(p, dt, idle);
    world.update(p, dt, camera, rig.lookTarget, tier);
    renderer.gl.toneMappingExposure = timeline.exposure();
    const h = camera.position.y;
    post.setAORadius(h > 150 ? 8 : h > 20 ? 3.2 : p > 0.56 && p < 0.9 ? 0.7 : 1.6);

    debug?.begin();
    renderer.gl.info.reset();
    if (NO_POST) {
      renderer.gl.toneMapping = THREE.AgXToneMapping;
      renderer.gl.render(world.scene, camera);
    } else post.render(dt);
    frameCalls = { calls: renderer.gl.info.render.calls, triangles: renderer.gl.info.render.triangles };
    debug?.end(timeline, camera, frameCalls);
    governor.frame(dt);
  };
  gsap.ticker.add(tick);

  canvas.classList.add('is-live');
  pre.done();

  // Test / screenshot hook: jump to a timeline position and settle.
  (window as unknown as Record<string, unknown>).__salim = {
    goto: async (p: number, frames = 45) => {
      lenis.scrollTo(scrollForProgress(p), { immediate: true, force: true });
      rig.snap();
      for (let i = 0; i < frames; i++) await nextFrame();
      return { progress: timeline.progress, chapter: timeline.chapter.id, calls: frameCalls.calls, triangles: frameCalls.triangles };
    },
    info: () => ({ tier: tier.name, gpu, reason, progress: timeline.progress, ...frameCalls }),
    ...(DEBUG
      ? {
          three: THREE,
          world,
          renderer: renderer.gl,
          camera,
          post,
          rig,
          /** Pin the camera in Salim-block local metres (x along the facade, y up, z out). */
          setCameraLocal: async (pos: number[], target: number[], fov: number, frames = 20) => {
            rig.override = { pos: salimLocal(pos[0], pos[1], pos[2]), target: salimLocal(target[0], target[1], target[2]), fov, noShift: true };
            for (let i = 0; i < frames; i++) await nextFrame();
          },
          clearCamera: () => { rig.override = null; },
          /** Timeline progress at which the camera passes chapter c's k-th path point. */
          pAtPoint: (c: number, k: number) => {
            let idx = 0;
            for (const ch of PATH) { if (ch.id === c) { idx += k; break; } idx += ch.points.length; }
            const t = idx / (rig.posCurve.points.length - 1);
            const def = CHAPTERS.find((d) => d.id === c)!;
            let best = def.p0, bd = Infinity;
            for (let i = 0; i <= 4000; i++) {
              const p = def.p0 + ((def.p1 - def.p0) * i) / 4000;
              const d = Math.abs(rig.paramAt(p) - t);
              if (d < bd) { bd = d; best = p; }
            }
            return best;
          },
          setDusk: (d: number | null) => { world.duskOverride = d; },
          look: LOOK,
          chapters: CHAPTERS,
        }
      : {}),
    ready: true,
  };
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('preloader')?.classList.add('is-done');
});
