// Post chain (brief §5): N8AO → depth of field (high tier, interiors only) →
// bloom (high threshold, so only emissive signage / lamps / downlights bloom)
// → AgX tone mapping → SMAA → vignette + fine grain. One EffectComposer;
// effects toggled per chapter and tier.
import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  DepthOfFieldEffect,
  Effect,
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
        ['uShadow', new THREE.Uniform(new THREE.Vector3(-0.012, 0.004, 0.022))],
        ['uHigh', new THREE.Uniform(new THREE.Vector3(0.02, 0.008, -0.014))],
        ['uSplit', new THREE.Uniform(1.0)],
      ]),
    });
  }
}

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
    this.gradePass = new EffectPass(camera, this.dof, this.bloom, this.tone);
    this.composer.addPass(this.gradePass);

    this.smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
    this.vignette = new VignetteEffect({ offset: 0.32, darkness: 0.42 });
    this.noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    this.noise.blendMode.opacity.value = 0.028;
    // perf/posters.ts: the page's still frames go without grain, which JPEG
    // spends most of its bytes on (the chapter-1 poster is in the first paint)
    if (new URLSearchParams(location.search).get('grain') === '0') this.noise.blendMode.opacity.value = 0;
    this.grade = new GradeEffect();
    this.aaPass = new EffectPass(camera, this.smaa, this.grade, this.vignette, this.noise);
    this.composer.addPass(this.aaPass);
  }

  setCamera(camera: THREE.PerspectiveCamera): void {
    this.renderPass.mainCamera = camera;
  }

  applyTier(t: Tier): void {
    // measurement only (perf/): ?ao=full|half|off and ?dof=0|1 override the tier
    const params = new URLSearchParams(location.search);
    const force = params.get('ao') as Tier['ao'] | null;
    const ao = force ?? t.ao;
    if (ao === 'off') this.ao.enabled = false; // (its resolution left as it is: nothing to re-make)
    else if (this.live && (ao === 'half') !== this.ao.configuration.halfRes) {
      // a step down while the film runs (high → medium): AO off, not re-made
      // at half resolution, which recompiles its shaders — a 250–300 ms stall
      this.ao.enabled = false;
    } else {
      this.ao.enabled = true;
      this.ao.configuration.halfRes = ao === 'half';
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
