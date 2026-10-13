// Falling rain (atmosphere/index.ts `look.rain`): thin streaks in a box that
// rides with the camera, each drop fixed in the world and wrapped round as the
// camera moves (so the rain does not travel with it), animated entirely in the
// vertex shader — no per-frame work on the CPU and one draw call. Lines, not
// quads: one pixel wide whatever the screen, which reads as fine rain rather
// than hail. The share of drops drawn follows the amount of rain; none are
// drawn at all when it is dry, under reduced motion, or on the low tier
// (the overcast light carries the weather there).
import * as THREE from 'three';

const BOX = new THREE.Vector3(46, 34, 46); // metres round the camera
const SPEED = 9.5; // m/s, typical for rain
const STREAK = 0.055; // seconds of fall each streak spans (its length)

const VERT = /* glsl */ `
  attribute vec4 seed;   // x, z in the box (0–1), phase (0–1), which drops (0–1)
  attribute float tail;  // 0 the head, 1 the tail
  uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform vec2 uWind;
  uniform float uAmount;
  varying float vFade;
  void main(){
    if (seed.w > uAmount) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vFade = 0.0; return; } // beyond the far plane
    vec3 vel = vec3(uWind.x, -${SPEED.toFixed(1)}, uWind.y);
    // fixed in the world, wrapped into the box centred on the camera
    vec2 xz = uCam.xz + mod(seed.xy * uBox.xz - uCam.xz, uBox.xz) - 0.5 * uBox.xz;
    float y = uCam.y + mod(seed.z * uBox.y + uTime * vel.y, uBox.y) - 0.5 * uBox.y;
    vec3 p = vec3(xz.x, y, xz.y) - vel * ${STREAK.toFixed(3)} * tail;
    vec4 view = viewMatrix * vec4(p, 1.0);
    // none in the camera's face, and thinning out towards the box's edge
    float d = length(view.xyz);
    vFade = smoothstep(1.2, 3.5, d) * (1.0 - smoothstep(0.32 * uBox.x, 0.5 * uBox.x, d));
    gl_Position = projectionMatrix * view;
  }`;

const FRAG = /* glsl */ `
  uniform vec3 uColor; uniform float uOpacity;
  varying float vFade;
  void main(){
    if (vFade <= 0.0) discard;
    gl_FragColor = vec4(uColor, uOpacity * vFade);
    #include <colorspace_fragment>
  }`;

export class Rain {
  readonly lines: THREE.LineSegments;
  /** Off when the governor drops to the low tier (World.applyTier). */
  enabled = true;
  private mat: THREE.ShaderMaterial;
  private drops: number;

  constructor(drops: number) {
    this.drops = drops;
    const seed = new Float32Array(drops * 2 * 4);
    const tail = new Float32Array(drops * 2);
    const pos = new Float32Array(drops * 2 * 3); // unused by the shader; bounds only
    // a fixed sequence, so every visit sees the same rain
    let s = 7;
    const r = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < drops; i++) {
      const v = [r(), r(), r(), r()];
      for (let k = 0; k < 2; k++) {
        seed.set(v, (i * 2 + k) * 4);
        tail[i * 2 + k] = k;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    g.setAttribute('tail', new THREE.BufferAttribute(tail, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uBox: { value: BOX.clone() },
        uWind: { value: new THREE.Vector2(0.6, -0.35) },
        uAmount: { value: 0 },
        uColor: { value: new THREE.Color(0.78, 0.82, 0.88) },
        uOpacity: { value: 0.32 },
      },
    });
    this.lines = new THREE.LineSegments(g, this.mat);
    this.lines.name = 'rain';
    this.lines.frustumCulled = false; // it is always round the camera
    this.lines.renderOrder = 8;
    this.lines.visible = false;
  }

  /** `amount` 0–1 (atmosphere look.rain × outdoors). */
  update(dt: number, camera: THREE.Camera, amount: number): void {
    const on = this.enabled && this.drops > 0 && amount > 0.01;
    this.lines.visible = on;
    if (!on) return;
    const u = this.mat.uniforms;
    u.uTime.value = (u.uTime.value + dt) % 3600;
    u.uCam.value.copy(camera.position);
    // light rain shows a third of the drops, a downpour all of them; heavier
    // rain is also a little brighter against the dim light it brings
    u.uAmount.value = Math.min(1, 0.12 + amount * 0.95);
    u.uOpacity.value = 0.22 + amount * 0.14;
  }
}
