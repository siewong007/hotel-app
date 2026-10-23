// Post chain (brief §5): N8AO → sharpening → depth of field (high tier,
// interiors only) → bloom (high threshold, so only emissive signage / lamps /
// downlights bloom) → AgX tone mapping → SMAA → grade, vignette + fine grain.
// One EffectComposer; effects toggled per chapter and tier.
import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  DepthOfFieldEffect,
  Effect,
  EffectAttribute,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { Tier } from '../config/quality';

/** The grade's shadow tint: the dusk film's cool blue, and NIGHT's emerald.
 *  It is added in linear light, so near black even 0.02 is a strong colour:
 *  the cool tint turned NIGHT's dark town navy (sRGB ≈ 6, 20, 44). */
const COOL_SHADOW = new THREE.Vector3(-0.012, 0.004, 0.022);
const EMERALD_SHADOW = new THREE.Vector3(-0.003, 0.006, 0.0025);

/** Display-referred grade after tone mapping: gentle S-curve, a touch more
 *  saturation, cool shadows / warm highlights (dusk film look). */
class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', /* glsl */ `
      uniform float uContrast; uniform float uSat; uniform vec3 uShadow; uniform vec3 uHigh; uniform float uSplit;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSat);
        // S-curve around mid grey
        c = clamp(0.5 + (c - 0.5) * uContrast, 0.0, 1.0);
        c = c * c * (3.0 - 2.0 * c) * 0.35 + c * 0.65;
        float w = smoothstep(0.0, 1.0, l);
        c += (uShadow * (1.0 - w) + uHigh * w) * uSplit;
        outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
      }`, {
      uniforms: new Map<string, THREE.Uniform>([
        ['uContrast', new THREE.Uniform(1.1)],
        ['uSat', new THREE.Uniform(1.2)],
        ['uShadow', new THREE.Uniform(COOL_SHADOW.clone())],
        ['uHigh', new THREE.Uniform(new THREE.Vector3(0.02, 0.008, -0.014))],
        ['uSplit', new THREE.Uniform(1.0)],
      ]),
    });
  }
}

/** Contrast-adaptive sharpening (after AMD FidelityFX CAS): gives back the
 *  edge contrast an upscaled canvas and SMAA take away, most where the local
 *  contrast is low (window grids, roof edges seen from the air) and little
 *  across strong edges and highlights, so they do not ring. It reads its
 *  neighbours from the scene as drawn (linear, unbounded), so it rides the
 *  tone-mapping pass, first, instead of costing a full-screen pass of its own
 *  after SMAA (~5 % of a frame); the weights come from a tone-mapped copy. */
class SharpenEffect extends Effect {
  constructor() {
    super('SharpenEffect', /* glsl */ `
      uniform float uAmount;
      vec3 casProxy(const in vec3 c) { return c / (1.0 + c); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 e = inputColor.rgb;
        vec3 b = texture2D(inputBuffer, uv - vec2(0.0, texelSize.y)).rgb;
        vec3 d = texture2D(inputBuffer, uv - vec2(texelSize.x, 0.0)).rgb;
        vec3 f = texture2D(inputBuffer, uv + vec2(texelSize.x, 0.0)).rgb;
        vec3 h = texture2D(inputBuffer, uv + vec2(0.0, texelSize.y)).rgb;
        vec3 E = casProxy(e), B = casProxy(b), D = casProxy(d), F = casProxy(f), H = casProxy(h);
        vec3 mn = min(E, min(min(B, D), min(F, H)));
        vec3 mx = max(E, max(max(B, D), max(F, H)));
        vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0));
        vec3 w = -amp / mix(8.0, 5.0, uAmount);
        outputColor = vec4(max((e + (b + d + f + h) * w) / (1.0 + 4.0 * w), 0.0), inputColor.a);
      }`, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([['uAmount', new THREE.Uniform(0.3)]]),
    });
  }
}

/** Above this pixel ratio AO runs at half resolution: at 2× that is still
 *  one sample per CSS pixel, which is all a soft contact shadow needs, and it
 *  takes the pass from ~10 ms to a third of that on a Retina screen. */
const AO_FULL_RES_DPR = 1.25;

export class Post {
  readonly composer: EffectComposer;
  readonly renderPass: RenderPass;
  readonly ao: N8AOPostPass;
  readonly bloom: BloomEffect;
  readonly dof: DepthOfFieldEffect;
  private dofOn = false;
  private dofTier = false;
  private camera: THREE.PerspectiveCamera;
  readonly tone: ToneMappingEffect;
  readonly smaa: SMAAEffect;
  readonly vignette: VignetteEffect;
  readonly noise: NoiseEffect;
  readonly grade: GradeEffect;
  readonly sharpen: SharpenEffect;
  private gradePass: EffectPass;
  private aaPass: EffectPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.ao = new N8AOPostPass(scene, camera, size.x, size.y);
    Object.assign(this.ao.configuration, {
      aoRadius: 3.0,
      distanceFalloff: 1.2,
      intensity: 2.2,
      aoSamples: 16,
      denoiseSamples: 8,
      denoiseRadius: 12,
      halfRes: false,
      gammaCorrection: false,
      screenSpaceRadius: false,
      color: new THREE.Color(0x0b0f14),
    });
    // N8AO found transparent materials in the scene and switched itself to
    // transparency-aware mode, which re-renders the scene twice every frame
    // (and walks it three times) so AO can skip glass and glows. Ours are
    // glazing and additive light cards, where it made no visible difference
    // but cost ~40 draw calls and seconds of main-thread time on a phone.
    this.ao.configuration.transparencyAware = false; // also stops it re-detecting
    const aoTargets = this.ao as unknown as Record<string, THREE.WebGLRenderTarget | undefined>;
    aoTargets.transparencyRenderTargetDWFalse?.dispose();
    aoTargets.transparencyRenderTargetDWTrue?.dispose();
    this.composer.addPass(this.ao);

    // high threshold: only emissive signage, lamps and downlights bloom;
    // mip levels per tier (applyTier)
    this.bloom = new BloomEffect({ luminanceThreshold: 1.15, luminanceSmoothing: 0.25, intensity: 0.9, radius: 0.68, mipmapBlur: true, levels: 5 });
    // off (the low tier), its passes are skipped too, not just hidden
    const bloomUpdate = this.bloom.update.bind(this.bloom);
    this.bloom.update = (r, input, dt) => { if (this.bloom.blendMode.opacity.value > 0) bloomUpdate(r, input, dt); };
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    // interiors and the counter close-up only, shallow and slow (brief §5):
    // focus follows the rig's subject (CameraRig.focus); a wide in-focus range and a gentle
    // bokeh, so what is beyond the subject softens without the lobby's
    // letters or a room's far wall going to mush (a first pass at 3.2 m / 1.6
    // blurred the SALIM INN letters behind the counter)
    this.dof = new DepthOfFieldEffect(camera, { focusDistance: 3, focusRange: 6, bokehScale: 1, resolutionScale: 0.5 });
    this.dof.blendMode.opacity.value = 0;
    const dofUpdate = this.dof.update.bind(this.dof);
    // its blur passes cost a few ms: skip them whenever it is not showing
    this.dof.update = (r, input, dt) => { if (this.dofOn) dofUpdate(r, input, dt); };
    this.sharpen = new SharpenEffect();
    this.gradePass = new EffectPass(camera, this.sharpen, this.dof, this.bloom, this.tone);
    this.composer.addPass(this.gradePass);

    this.smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
    this.vignette = new VignetteEffect({ offset: 0.32, darkness: 0.42 });
    this.noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    this.noise.blendMode.opacity.value = 0.028;
    // perf/posters.ts: the page's still frames go without grain, which JPEG
    // spends most of its bytes on (the chapter-1 poster is in the first paint),
    // and without sharpening, which costs it a third more
    const params = new URLSearchParams(location.search);
    if (params.get('grain') === '0') this.noise.blendMode.opacity.value = 0;
    if (params.get('sharpen') === '0') this.sharpen.blendMode.opacity.value = 0;
    this.grade = new GradeEffect();
    this.aaPass = new EffectPass(camera, this.smaa, this.grade, this.vignette, this.noise);
    // the half-float chain quantises to 8 bits only here: dither it, or the
    // lobby's warm ceiling gradient shows its steps (the grain alone is too
    // faint to hide them in the dark tones)
    this.aaPass.dithering = true;
    this.composer.addPass(this.aaPass);
  }

  setCamera(camera: THREE.PerspectiveCamera): void {
    this.renderPass.mainCamera = camera;
  }

  /** `dpr`: the canvas's pixel ratio (AO_FULL_RES_DPR). */
  applyTier(t: Tier, dpr = 1): void {
    // measurement only (perf/): ?ao=full|half|off and ?dof=0|1 override the tier
    const params = new URLSearchParams(location.search);
    const force = params.get('ao') as Tier['ao'] | null;
    const ao = force ?? t.ao;
    const half = ao === 'half' || (!force && dpr > AO_FULL_RES_DPR);
    if (ao === 'off') this.ao.enabled = false; // (its resolution left as it is: nothing to re-make)
    else if (this.live && half !== this.ao.configuration.halfRes) {
      // a step down while the film runs (high → medium): AO off, not re-made
      // at half resolution, which recompiles its shaders — a 250–300 ms stall
      this.ao.enabled = false;
    } else {
      this.ao.enabled = true;
      this.ao.configuration.halfRes = half;
    }
    this.bloom.blendMode.opacity.value = t.bloom ? 1 : 0;
    // rebuilding the levels makes new targets and recompiles two shaders
    if (t.bloom && !this.live) this.bloom.mipmapBlurPass.levels = t.bloom;
    this.dofTier = params.has('dof') ? params.get('dof') !== '0' : t.dof;
  }

  private live = false;
  /** The film is running: from here a tier change (the governor's step down)
   *  only switches things off. Rebuilding the bloom's levels stalled a step
   *  150 ms, and AO at a new resolution 250–300 ms (perf/probe.ts `act`). */
  goLive(): void {
    this.live = true;
  }

  /** Depth of field weight for this frame (0 outside the interiors) and the
   *  distance to keep sharp (CameraRig.focus). */
  setDof(weight: number, distance: number): void {
    const w = this.dofTier ? weight : 0;
    this.dofOn = w > 0.001;
    this.dof.blendMode.opacity.value = w;
    if (!this.dofOn) return;
    this.dof.cocMaterial.focusDistance = distance;
    // the depth-to-distance mapping takes the camera's near and far planes,
    // which the film moves with altitude (World.update); the effect copies
    // them only when built, and focused nowhere indoors until this
    this.dof.cocMaterial.adoptCameraSettings(this.camera);
  }

  /** Strength of the grade's split toning: 1 is the film's dusk look. */
  setSplit(v: number): void {
    const u = this.grade.uniforms.get('uSplit')!;
    if (u.value !== v) u.value = v;
  }

  /** Cloud and rain take a little colour out of the grade, and NIGHT turns
   *  its shadows from the dusk's blue to deep emerald; rain goes part of the
   *  way, to a cool green-grey (brief: "deep emerald and cool blue-grey"). */
  setWeather(cloud: number, rain: number, night = 0): void {
    const u = this.grade.uniforms.get('uSat')!;
    const v = 1.2 * (1 - 0.12 * cloud - 0.06 * rain);
    if (Math.abs(u.value - v) > 1e-4) u.value = v;
    const toEmerald = Math.max(night, 0.6 * Math.min(1, rain * 1.2));
    (this.grade.uniforms.get('uShadow')!.value as THREE.Vector3).copy(COOL_SHADOW).lerp(EMERALD_SHADOW, toEmerald);
  }

  /** Sharpen to suit the canvas: gently at the screen's own resolution, more
   *  as the canvas is drawn below it and stretched to fit (a Retina screen at
   *  a calibrated 1.25×, say). `upscale` is the screen's pixel ratio over the
   *  canvas's. */
  setSharpen(upscale: number): void {
    this.sharpen.uniforms.get('uAmount')!.value = THREE.MathUtils.clamp(0.3 + 0.5 * (upscale - 1), 0.3, 0.8);
  }

  /** Scale AO to the shot: metres-wide contact shading on the street,
   *  finer in the rooms. */
  setAORadius(r: number): void {
    if (Math.abs(this.ao.configuration.aoRadius - r) > 0.02) this.ao.configuration.aoRadius = r;
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h, false);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }
}
