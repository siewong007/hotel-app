// Post chain (brief §5): N8AO → bloom (high threshold, so only emissive
// signage / lamps / downlights bloom) → AgX tone mapping → SMAA → vignette +
// fine grain. One EffectComposer; effects toggled per chapter and tier.
import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
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
  readonly tone: ToneMappingEffect;
  readonly smaa: SMAAEffect;
  readonly vignette: VignetteEffect;
  readonly noise: NoiseEffect;
  readonly grade: GradeEffect;
  private gradePass: EffectPass;
  private aaPass: EffectPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
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
    this.composer.addPass(this.ao);

    // high threshold: only emissive signage, lamps and downlights bloom
    this.bloom = new BloomEffect({ luminanceThreshold: 1.15, luminanceSmoothing: 0.25, intensity: 0.9, radius: 0.68, mipmapBlur: true });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.gradePass = new EffectPass(camera, this.bloom, this.tone);
    this.composer.addPass(this.gradePass);

    this.smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
    this.vignette = new VignetteEffect({ offset: 0.32, darkness: 0.42 });
    this.noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    this.noise.blendMode.opacity.value = 0.028;
    this.grade = new GradeEffect();
    this.aaPass = new EffectPass(camera, this.smaa, this.grade, this.vignette, this.noise);
    this.composer.addPass(this.aaPass);
  }

  setCamera(camera: THREE.PerspectiveCamera): void {
    this.renderPass.mainCamera = camera;
  }

  applyTier(t: Tier): void {
    this.ao.enabled = t.ao !== 'off';
    this.ao.configuration.halfRes = t.ao === 'half';
    this.bloom.blendMode.opacity.value = t.bloom ? 1 : 0;
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
