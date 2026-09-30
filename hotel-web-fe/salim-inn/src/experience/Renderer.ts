// WebGL2 renderer setup (brief §5). Antialiasing comes from the post chain
// (SMAA), so the context is created without MSAA and without a stencil.
import * as THREE from 'three';
import type { Tier } from '../config/quality';
import { MOBILE_DPR_CAP } from '../config/quality';
import { SHADOW_ONLY_LAYER } from '../world/ShadowCasters';

/** measurement only (perf/): ?dpr= fixes the pixel ratio */
const FORCE_DPR = Number(new URLSearchParams(location.search).get('dpr')) || 0;

export function isMobileLike(): boolean {
  return matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
}

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  width = 1;
  height = 1;
  dpr = 1;
  /** Ceiling from the start-up calibration (film.ts). */
  maxDpr = Infinity;

  constructor(canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    const gl = this.gl;
    gl.outputColorSpace = THREE.SRGBColorSpace;
    // Tone mapping is applied once, at the end of the post chain (AgX).
    gl.toneMapping = THREE.NoToneMapping;
    gl.toneMappingExposure = 0.9;
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFShadowMap; // r186: PCFSoft removed; softness via shadow.radius
    gl.shadowMap.autoUpdate = true;
    gl.info.autoReset = false;
    // three reads every program's compile and link logs on its first use:
    // three blocking calls into the GPU process per shader, which added up to
    // ~80 ms in the frame the interior appeared. Kept for ?debug=1.
    gl.debug.checkShaderErrors = new URLSearchParams(location.search).has('debug');
    // the baked shadow casters (world/ShadowCasters.ts) are on a layer the
    // camera sees only during the shadow pass; three builds the frame's draw
    // list before that pass, so they never reach the screen
    const shadows = gl.shadowMap;
    const renderShadows = shadows.render.bind(shadows);
    shadows.render = (lights, scene, camera) => {
      camera.layers.enable(SHADOW_ONLY_LAYER);
      renderShadows(lights, scene, camera);
      camera.layers.disable(SHADOW_ONLY_LAYER);
    };
  }

  resize(tier: Tier): void {
    const w = Math.max(1, Math.floor(innerWidth));
    const h = Math.max(1, Math.floor(innerHeight));
    const cap = Math.min(tier.dprCap, isMobileLike() ? MOBILE_DPR_CAP : tier.dprCap);
    this.dpr = FORCE_DPR || Math.min(window.devicePixelRatio || 1, cap, this.maxDpr);
    this.width = w;
    this.height = h;
    this.gl.setPixelRatio(this.dpr);
    this.gl.setSize(w, h, false);
  }
}
