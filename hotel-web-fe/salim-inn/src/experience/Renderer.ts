// WebGL2 renderer setup (brief §5). Antialiasing comes from the post chain
// (SMAA), so the context is created without MSAA and without a stencil.
import * as THREE from 'three';
import type { Tier } from '../config/quality';
import { MOBILE_DPR_CAP } from '../config/quality';

export function isMobileLike(): boolean {
  return matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
}

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  width = 1;
  height = 1;
  dpr = 1;

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
  }

  resize(tier: Tier): void {
    const w = Math.max(1, Math.floor(innerWidth));
    const h = Math.max(1, Math.floor(innerHeight));
    const cap = Math.min(tier.dprCap, isMobileLike() ? MOBILE_DPR_CAP : tier.dprCap);
    this.dpr = Math.min(window.devicePixelRatio || 1, cap);
    this.width = w;
    this.height = h;
    this.gl.setPixelRatio(this.dpr);
    this.gl.setSize(w, h, false);
  }
}
