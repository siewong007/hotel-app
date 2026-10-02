// Salim Inn · From Skyview to Stay — the film (loaded by main.ts once the
// poster has painted). One pinned canvas, HTML chapters above it; smoothed
// scroll → one master timeline → camera rig + scene state + DOM.
import * as THREE from 'three';
import Lenis from 'lenis';
import { Renderer } from './experience/Renderer';
import { CameraRig } from './experience/CameraRig';
import { PATH } from './experience/cameraPath';
import { Timeline, CHAPTERS, chapterAt } from './experience/Timeline';
import { Post } from './experience/Post';
import { Preloader, nextFrame } from './experience/Preloader';
import { detectTier, FpsGovernor, lowerTier } from './experience/Quality';
import { DOOR_OPEN, World, yieldToMain } from './world/World';
import { LOOK } from './world/Sky';
import { salimLocal } from './world/layout';
import { Chapters } from './ui/Chapters';
import { Configurator } from './ui/Configurator';
import { BookingPanel } from './ui/BookingPanel';
import { Neighbourhood } from './ui/Neighbourhood';
import { startFallback } from './ui/Fallback';
import { wireBookingCtas } from './ui/StickyCta';
import { ROOM_VIEWS, viewToWorld } from './interiors/roomViews';
import { ROOM_ORDER } from './interiors/roomLayouts';
import { neighbourhoodTitle, places } from './data/neighbourhood';
import { copy } from './content';
import type { BuildStep } from './content/en';
import { placeAnchor } from './world/placeAnchors';
import { POINTS } from './world/layout';
import type { Tier } from './config/quality';
import type { RoomCode } from './config/site';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const NO_POST = params.get('post') === '0';
// measurement only (perf/): hold the starting tier
const NO_GOVERNOR = params.get('governor') === '0';
/** A tier or pixel ratio fixed in the URL (perf/ tooling) skips the calibration. */
const FORCED_QUALITY = params.has('quality') || params.has('dpr');
/** Depth of field: the counter close-up (ch. 5) and the rooms (ch. 6). */
const dofWeight = (p: number) => THREE.MathUtils.smoothstep(p, 0.6, 0.63) * (1 - THREE.MathUtils.smoothstep(p, 0.86, 0.88));
/** The grade's cool shadows (Post) lift black to navy — the dusk look outside,
 *  but indoors they turned the black granite counter and the burgundy stair
 *  carpet blue. Eased off from the lobby door to the room door; the rooms keep
 *  the film's grade. */
const gradeSplit = (p: number) => 1 - 0.8 * THREE.MathUtils.smoothstep(p, 0.565, 0.585) * (1 - THREE.MathUtils.smoothstep(p, DOOR_OPEN[0], DOOR_OPEN[1] + 0.012));
// Reduced motion (brief §6.9): no camera flights — each chapter holds its
// settled frame and chapters cross-fade (400 ms) when the scroll crosses them.
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const FORCE_FALLBACK = params.get('fallback') === '1';
// the owner's preview of unconfirmed places (badged); never on the live page
const PREVIEW_PLACES = DEBUG && params.get('places') === 'all';
if (params.get('ui') === '0') document.documentElement.classList.add('no-ui');

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

/** Set once the page's DOM parts exist: switches to the still version. */
let toStill: ((why: string) => void) | null = null;

async function boot(): Promise<void> {
  const pre = new Preloader();
  const chapters = new Chapters();
  pre.set(0.04, copy.preloader.loading);
  // short tasks from here on: the page is on screen and should stay responsive
  await yieldToMain();

  // The DOM-only parts come first: the still version uses them too.
  const el = (id: string) => document.getElementById(id)!;
  const placeList = places({ includeUnverified: PREVIEW_PLACES });
  const nb = new Neighbourhood(placeList, { ch2: el('nb-ch2'), ch7: el('nb-ch7'), ch2Title: el('chapter-2-title') }, {
    door: POINTS.lobbyDoor,
    anchorOf: placeAnchor,
    titleFor: PREVIEW_PLACES ? (list) => neighbourhoodTitle(list, copy.neighbourhood) : undefined,
  });
  await yieldToMain();
  const panel = new BookingPanel(el('book'));
  const still = (why: string) => {
    startFallback(chapters, (code) => panel.preselect(code, true));
    wireBookingCtas((room) => {
      if (room) panel.preselect(room, true);
      el('book').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' });
      panel.focus();
      panel.seen();
    }, () => panel.read().room);
    document.documentElement.dataset.still = why;
    pre.done();
  };
  toStill = still;

  // no WebGL 2, a low-memory device, or asked for (?fallback=1)
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (FORCE_FALLBACK || !webglAvailable() || (memory !== undefined && memory <= 1)) {
    still(FORCE_FALLBACK ? 'url' : !webglAvailable() ? 'no-webgl2' : 'low-memory');
    return;
  }

  const { tier: detected, gpu, reason, blocked } = await detectTier();
  if (blocked) {
    still('gpu-blocklisted');
    return;
  }
  let tier: Tier = detected;
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const renderer = new Renderer(canvas);
  renderer.resize(tier);
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 50000);
  const timeline = new Timeline();
  const world = new World();

  performance.mark('salim:build-start');
  await world.build(renderer.gl, tier, async (label, f) => {
    performance.mark(`salim:build:${label}`); // perf/run.ts reads these
    pre.set(0.08 + f * 0.72, copy.preloader.steps[label as BuildStep] ?? label);
    await nextFrame();
  });

  const rig = new CameraRig(camera);
  rig.setViewport(innerWidth, innerHeight);
  // the room configurator (chapter 6) arrives with the interior, below
  let cfg: Configurator | null = null;
  const post = new Post(renderer.gl, world.scene, camera);
  post.applyTier(tier);
  post.setSize(renderer.width, renderer.height);

  // Smooth scroll: Lenis drives the page; one requestAnimationFrame loop
  // drives Lenis, the timeline, the scene and the DOM (the frame loop below).
  const lenis = new Lenis({ lerp: REDUCED ? 1 : 0.085, smoothWheel: !REDUCED, wheelMultiplier: 0.9, touchMultiplier: 1.2 });

  const progressFromScroll = () => {
    const y = lenis.animatedScroll - chapters.storyTop;
    return Math.min(1, Math.max(0, y / chapters.scrollLength));
  };
  const scrollForProgress = (p: number) => chapters.storyTop + p * chapters.scrollLength;

  // Chapter jumps, and every Book button: to chapter 8's booking panel with
  // the configurator's room type pre-selected (a room card brings its own)
  const ease = (t: number) => 1 - Math.pow(1 - t, 4);
  chapters.onJump = (p) => lenis.scrollTo(scrollForProgress(p), { duration: 2.4, easing: ease, immediate: REDUCED });
  const c8 = CHAPTERS[CHAPTERS.length - 1];
  wireBookingCtas((room?: RoomCode) => {
    panel.preselect(room ?? world.room?.code ?? 'DLX', !!room);
    lenis.scrollTo(scrollForProgress(c8.settle), { duration: 3.2, easing: ease, immediate: REDUCED, onComplete: () => panel.focus() });
    if (REDUCED) panel.focus();
  }, () => world.room?.code ?? 'DLX');

  // Play film: auto-scrub the whole timeline in ~60 s.
  const playBtn = document.getElementById('play') as HTMLButtonElement;
  let playing = false;
  const setPlaying = (v: boolean) => {
    playing = v;
    playBtn.textContent = v ? copy.nav.pause : timeline.progress > 0.99 ? copy.nav.replay : copy.nav.play;
    playBtn.setAttribute('aria-pressed', String(v));
  };
  // Lenis keeps its target on the animated value while it plays a scroll, so
  // an immediate scrollTo to where the page already is returns early and the
  // scroll runs on: stop() halts it where it is, and start() hands it back.
  const pause = () => {
    lenis.stop();
    lenis.start();
    setPlaying(false);
  };
  playBtn.addEventListener('click', () => {
    if (playing) {
      pause();
      return;
    }
    const from = timeline.progress > 0.99 ? 0 : timeline.progress;
    if (from === 0) lenis.scrollTo(scrollForProgress(0), { immediate: true });
    setPlaying(true);
    lenis.scrollTo(scrollForProgress(1), { duration: 60 * (1 - from), easing: (t) => t, lock: false, onComplete: () => setPlaying(false) });
  });
  window.addEventListener('wheel', () => playing && setPlaying(false), { passive: true });
  // A touch on the button itself is not the visitor taking over the scroll:
  // its click pauses. Counting it here would mark the film stopped first, and
  // that click would then start it again. Anywhere else a touch pauses, and has
  // to halt the scroll itself: Lenis leaves a tap alone and stops only a drag.
  window.addEventListener('touchstart', (e) => {
    if (playing && !playBtn.contains(e.target as Node)) pause();
  }, { passive: true });

  // Resize
  const onResize = () => {
    renderer.resize(tier);
    rig.setViewport(innerWidth, innerHeight);
    post.setSize(renderer.width, renderer.height);
    chapters.layout();
    lenis.resize();
  };
  window.addEventListener('resize', onResize);

  // Adaptive quality
  const governor = new FpsGovernor(tier);
  /** A tier change, whole (start-up calibration, which times the result at once). */
  const applyTier = (t: Tier) => {
    tier = t;
    renderer.resize(tier);
    post.applyTier(tier);
    post.setSize(renderer.width, renderer.height);
    world.applyTier(tier);
    renderer.gl.shadowMap.needsUpdate = true; // a new resolution drops the old map, indoors too
  };
  // The governor's step down sheds the effects (AO, bloom, depth of field,
  // level of detail) and keeps the pixel ratio. A new one resizes the canvas,
  // and the browser first finishes every frame still queued on the GPU: at a
  // step down that queue is at its deepest, and the main thread stalled
  // 120–190 ms, then ~100 ms more reallocating the render targets from a 2×
  // ratio (perf/probe.ts `stepdown`). Low's ratio of 1 applies when the film
  // starts on it (calibration, applyTier).
  governor.onDrop = (t) => {
    tier = t;
    post.applyTier(tier);
    world.applyTier(tier);
    renderer.gl.shadowMap.needsUpdate = true;
  };

  // Precompile every material before the preloader leaves (no first-use hitches).
  pre.set(0.84, copy.preloader.warming);
  rig.update(0, 0);
  world.update(0, 0, camera, rig.lookTarget, tier);
  performance.mark('salim:precompile');
  await world.precompile(renderer.gl, camera, post.composer.inputBuffer);
  performance.mark('salim:textures');
  pre.set(0.9, copy.preloader.almost);
  await world.uploadTextures(renderer.gl);
  performance.mark('salim:warm-up');
  await world.warmUp(renderer.gl, camera, post.composer.inputBuffer);
  performance.mark('salim:calibrate');

  /** n frames back to back and one readback (the only real sync point): ms
   *  per frame on the GPU, or the CPU if that is slower. */
  const benchFrames = (n: number) => {
    const gl = renderer.gl.getContext(), px = new Uint8Array(4);
    const sync = () => { renderer.gl.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    sync();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) post.render(1 / 60);
    sync();
    return (performance.now() - t0) / n;
  };
  const stateAt = (p: number) => {
    timeline.set(p);
    rig.snap();
    rig.subject = world.subject(p);
    rig.update(p, 1 / 60);
    world.update(p, 1 / 60, camera, rig.lookTarget, tier);
    renderer.gl.toneMappingExposure = timeline.exposure();
    post.setDof(dofWeight(p), rig.focus);
    post.setSplit(gradeSplit(p));
  };
  // Start-up calibration (brief §8 tiers): detect-gpu names a tier from a
  // benchmark table; before the preloader leaves, that tier is timed on the
  // film's two heaviest exterior frames. Over budget, the pixel ratio comes down by the square root of
  // the overrun — the cost here is per pixel, ~4–5 ms a megapixel on an
  // M4 — and where that would take the high tier below 1.5, the tier steps
  // down instead: half-res AO costs the picture less than a soft one does.
  // The budget is 11 ms, not a frame's 16.7: the timing runs on a cool GPU,
  // and a fanless laptop (this M4 Air; the brief's M1) slows once warm — at
  // 13 ms this one held 60 fps for two plays of the film and dropped to
  // 30 fps in the third minute (perf/run.ts, three loops). The interiors are built after it, and on high they cost ~1.4× these
  // frames (full-resolution AO and depth of field indoors; perf/bench.ts), so
  // that tier's timing counts 1.4× — or it passes here and drops to 30 fps
  // in the lobby, where the governor's step down costs a 100 ms stall.
  // The result is kept per device and screen (localStorage), so a return
  // visit skips the timing; each timing is a few short tasks, not one long one.
  const calibration: string[] = [];
  const CAL_KEY = 'salim-inn:quality:v2';
  const calId = `${gpu}|${reason}|${window.devicePixelRatio}|${innerWidth >= 760 ? 'wide' : 'narrow'}`;
  const applyCalibrated = (name: Tier['name'], dpr: number) => {
    while (tier.name !== name && lowerTier(tier)) applyTier(lowerTier(tier)!);
    if (dpr < renderer.dpr) { renderer.maxDpr = dpr; onResize(); }
  };
  let stored: { id: string; tier: Tier['name']; dpr: number } | null = null;
  try { stored = JSON.parse(localStorage.getItem(CAL_KEY) ?? 'null'); } catch { stored = null; }
  if (!FORCED_QUALITY && stored?.id === calId) {
    applyCalibrated(stored.tier, stored.dpr);
    calibration.push(`kept ${stored.tier}@${stored.dpr}`);
  } else if (!FORCED_QUALITY) {
    pre.set(0.95, copy.preloader.tuning);
    const budget = 11;
    const indoors = (t: Tier) => (t.name === 'high' ? 1.4 : 1);
    const timeAt = async (p: number) => {
      stateAt(p);
      benchFrames(2);
      await nextFrame();
      const ms = benchFrames(4);
      await nextFrame();
      return ms;
    };
    for (let step = 0; step < 4; step++) {
      // the ring from above and the pull-back over it: the heaviest frames
      // without the interior, which is built after the first frame
      const ms = Math.max(await timeAt(0.26), await timeAt(0.94));
      const est = ms * indoors(tier);
      calibration.push(`${tier.name}@${renderer.dpr.toFixed(2)} ${ms.toFixed(1)} ms${est > ms ? ` (${est.toFixed(1)} indoors)` : ''}`);
      if (est <= budget) break;
      const fit = renderer.dpr * Math.sqrt(budget / est);
      const down = lowerTier(tier);
      if (fit >= (tier.name === 'high' ? 1.5 : 1) || !down) {
        renderer.maxDpr = Math.max(1, Math.floor(fit * 8) / 8);
        onResize();
        calibration.push(`dpr ${renderer.dpr.toFixed(2)}`);
        break;
      }
      applyTier(down);
      await nextFrame();
    }
    try { localStorage.setItem(CAL_KEY, JSON.stringify({ id: calId, tier: tier.name, dpr: renderer.dpr })); } catch { /* private mode: time it again next visit */ }
  }
  governor.tier = tier;
  post.goLive();
  stateAt(0);
  renderer.gl.shadowMap.needsUpdate = true; // the warm-up drew it piecemeal
  performance.mark('salim:ui');

  // Debug overlay (dynamic import keeps stats-gl / three-mesh-bvh out of the main bundle).
  let debug: import('./experience/Debug').Debug | null = null;
  if (DEBUG) {
    const mod = await import('./experience/Debug');
    debug = new mod.Debug(renderer.gl);
    debug.extra.tier = `${tier.name} @${renderer.dpr} (${reason}; ${gpu}${calibration.length ? `; ${calibration.join(' → ')}` : ''})`;
  }

  // Frame loop
  let booking = false;
  let held = 1; // reduced motion: the chapter whose frame is on screen
  let cutting = false;
  let last = performance.now();
  let frameCalls = { calls: 0, triangles: 0 };
  let filmPast = false;
  let ticks = 0;
  const tick = () => {
    ticks++;
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
    const pScroll = progressFromScroll();
    const reading = chapterAt(pScroll); // the copy always follows the scroll
    chapters.setActive(reading.id);
    if (document.documentElement.dataset.chapter !== String(reading.id)) document.documentElement.dataset.chapter = String(reading.id);
    // phones: the booking bar from the first screen until chapter 8's own panel
    document.getElementById('mobile-cta')?.classList.toggle('is-visible', pScroll < 0.95);
    // chapter 8: the booking panel slides in over a dimmed scene
    if ((reading.id === 8) !== booking) {
      booking = reading.id === 8;
      document.documentElement.classList.toggle('is-booking', booking);
      if (booking) panel.seen();
    }
    // reduced motion: the camera holds each chapter's settled frame; crossing
    // into another chapter fades the canvas out and back in (2 × 200 ms)
    let p = pScroll;
    if (REDUCED) {
      if (reading.id !== held && !cutting) {
        cutting = true;
        canvas.classList.add('is-cut');
        window.setTimeout(() => {
          held = chapterAt(progressFromScroll()).id;
          rig.snap();
          canvas.classList.remove('is-cut');
          cutting = false;
        }, 200);
      }
      p = CHAPTERS.find((c) => c.id === held)!.settle;
    }
    timeline.set(p);

    // chapter 6 hold: the configurator is live and the camera sits at the
    // selected type's photo-matched view; it hands back to the path for
    // chapter 7, which leaves through the window — so an inside room (the
    // Family Suite) swaps back to the last type with a window first
    const cfgW = cfg ? THREE.MathUtils.smoothstep(p, 0.815, 0.835) * (1 - THREE.MathUtils.smoothstep(p, 0.872, 0.884)) : 0;
    if (cfg && world.room) {
      cfg.setActive(cfgW > 0.02);
      cfg.update(dt);
      if (p > 0.874 && !world.room.current.window && !world.room.transitioning) cfg.select(cfg.lastWindowed);
    }
    rig.view = cfg && world.room && cfgW > 0 ? cfg.worldView(world.room.group, innerWidth, innerHeight) : null;
    rig.viewWeight = cfgW;

    // Indoors the sun is a sliver and nothing outside moves: the shadow map
    // keeps the frame it had at the door instead of being redrawn each frame.
    // The low tier's map is drawn once (at start and at a tier change) and kept;
    // the page names the tier so a scrim can stand in for the shadows it misses
    // (main.css, chapter 4).
    renderer.gl.shadowMap.autoUpdate = tier.shadowMap > 0 && !(p > 0.6 && p < 0.87);
    if (document.documentElement.dataset.tier !== tier.name) document.documentElement.dataset.tier = tier.name;

    const idle = REDUCED ? 0 : THREE.MathUtils.smoothstep(p, 0.965, 1);
    rig.subject = world.subject(p);
    rig.update(p, dt, idle);
    world.update(p, dt, camera, rig.lookTarget, tier);
    nb.update(camera, p, innerWidth, innerHeight, { centre: POINTS.lobbyDoor, radii: world.walkRings.radii, look: rig.lookTarget });
    renderer.gl.toneMappingExposure = timeline.exposure();
    const h = camera.position.y;
    post.setAORadius(h > 150 ? 8 : h > 20 ? 3.2 : p > 0.56 && p < 0.9 ? 0.7 : 1.6);
    post.setDof(dofWeight(p), rig.focus);
    post.setSplit(gradeSplit(p));

    debug?.begin();
    renderer.gl.info.reset();
    if (NO_POST) {
      renderer.gl.toneMapping = THREE.AgXToneMapping;
      renderer.gl.render(world.scene, camera);
    } else post.render(dt);
    frameCalls = { calls: renderer.gl.info.render.calls, triangles: renderer.gl.info.render.triangles };
    debug?.end(timeline, camera, frameCalls);
    if (!NO_GOVERNOR) governor.frame(dt);
  };
  performance.mark('salim:loop');
  const loop = () => {
    tick();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // Two frames under the preloader: the post chain and the shadow map compile
  // their shaders on first use, and that should not be the first frame seen.
  while (ticks < 2) await nextFrame();
  canvas.classList.add('is-live');
  performance.mark('salim:first-frame');
  pre.done();

  // The interior — lobby, corridor, rooms — is built in the gaps between
  // frames while chapters 1–3 play (World.buildInterior). It starts when the
  // visitor first scrolls, taps or presses a key, or after 3 s on the opening
  // shot: nothing indoors is on screen before then, and a phone that is only
  // showing the first frame should not also be building a lobby. A visitor
  // who gets near the door first (p > 0.38) has it finished at once.
  await new Promise<void>((resolve) => {
    const events = ['scroll', 'wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    const go = () => {
      window.clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, go);
      resolve();
    };
    const timer = window.setTimeout(go, 3000);
    for (const e of events) window.addEventListener(e, go, { passive: true });
  });
  governor.hold(true);
  await world.buildInterior(renderer.gl, camera, post.composer.inputBuffer, () => timeline.progress > 0.38);
  governor.hold(false);
  performance.mark('salim:interior');
  const room = world.room!;
  const configurator = new Configurator(room, document.getElementById('configurator')!);
  configurator.onPick = (code) => panel.preselect(code);
  cfg = configurator;

  if (debug && DEBUG) {
    const mod = await import('./experience/Debug');
    const clip = params.get('clip') !== '0'; // perf/ tooling skips it: it rebuilds the room
    // every room type, with the room door and the curtains as the camera
    // meets them (open), plus each type's configurator view; the Family Suite
    // never takes the chapter-7 exit (no window — the film switches type first)
    const path = mod.pathSamples(rig);
    const initial = room.code;
    const report: import('./experience/Debug').ClipReport = { samples: 0, minDistance: Infinity, hits: [] };
    const merge = (r: import('./experience/Debug').ClipReport, tag: string) => {
      report.samples += r.samples;
      report.minDistance = Math.min(report.minDistance, r.minDistance);
      report.hits.push(...r.hits.map((h) => ({ ...h, mesh: `${tag} ${h.mesh}` })));
    };
    for (const code of clip ? ROOM_ORDER : []) {
      room.select(code, true);
      room.setDoor(1);
      room.openCurtainsForExit(1);
      merge(mod.clipCheck(path.filter((q) => code !== 'FS' || q.p < 0.874), world.solids), code);
      const view = ROOM_VIEWS[code];
      room.cutawayFor(new THREE.Vector3(...view.pos)); // the Family Room view stands outside
      merge(mod.clipCheck([{ p: -1, pos: viewToWorld(view, room.group).pos, label: 'view' }], world.solids), code);
      room.cutawayFor(null);
    }
    if (clip) room.select(initial, true);
    const worst = report.hits.slice(0, 20).map((h) => `p=${h.p.toFixed(4)} d=${h.d.toFixed(3)} ${h.mesh}`);
    console.info('[clip-check]', { samples: report.samples, minDistance: report.minDistance, hits: report.hits.length, worst });
    debug.extra.clip = `${report.hits.length} hits (<0.3 m) · min ${report.minDistance.toFixed(2)} m over ${report.samples} samples`;
    (window as unknown as Record<string, unknown>).__clip = report;
  }

  // Test / screenshot hook: jump to a timeline position and settle.
  (window as unknown as Record<string, unknown>).__salim = {
    goto: async (p: number, frames = 45) => {
      lenis.scrollTo(scrollForProgress(p), { immediate: true, force: true });
      rig.snap();
      for (let i = 0; i < frames; i++) await nextFrame();
      return { progress: timeline.progress, chapter: timeline.chapter.id, calls: frameCalls.calls, triangles: frameCalls.triangles };
    },
    info: () => ({ tier: tier.name, gpu, reason, calibration: calibration.join(' → '), dpr: renderer.dpr, progress: timeline.progress, ...frameCalls }),
    /** perf/: n frames back to back and one readback — ms per frame on the GPU (or CPU, whichever is slower). */
    bench: (n = 24) => benchFrames(n),
    /** How the start-up calibration settled the tier. */
    calibration,
    /** The film at a fixed speed, start to end (perf/run.ts; also what Play does). */
    play: (seconds = 60) => new Promise<void>((resolve) => {
      lenis.scrollTo(scrollForProgress(0), { immediate: true, force: true });
      rig.snap();
      lenis.scrollTo(scrollForProgress(1), { duration: seconds, easing: (t) => t, force: true, onComplete: () => resolve() });
    }),
    ...(DEBUG
      ? {
          three: THREE,
          world,
          renderer: renderer.gl,
          camera,
          post,
          rig,
          /** perf/probe.ts `stepdown`: the governor's step down, on demand. */
          stepDown: () => {
            const t = lowerTier(tier);
            if (t) { governor.tier = t; governor.onDrop?.(t); }
            return tier.name;
          },
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
          room: (code: string, instant = true) => { room.select(code as never, instant); },
          /** Pin the camera to a room type's photo-matched view (side-by-sides). */
          roomShot: async (code: string, frames = 50) => {
            configurator.jump(code as never);
            const v = ROOM_VIEWS[code as keyof typeof ROOM_VIEWS];
            const w = viewToWorld(v, room.group);
            rig.override = { pos: w.pos, target: w.target, fov: v.vfov, noShift: true, roll: v.roll };
            for (let i = 0; i < frames; i++) await nextFrame();
            return { fov: v.vfov, roll: v.roll };
          },
          configurator,
          look: LOOK,
          chapters: CHAPTERS,
        }
      : {}),
    ready: true,
  };
}

boot().catch((err) => {
  // a 3D start-up that fails still leaves a working page: the still version
  console.error(err);
  if (toStill) toStill('error');
  else document.getElementById('preloader')?.classList.add('is-done');
});
