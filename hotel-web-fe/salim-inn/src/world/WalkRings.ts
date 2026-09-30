// Chapter 7's walking-time rings (brief §3): they expand from the hotel door
// to 1, 3 and 5 minutes' walk — straight-line radius at the brief's 80 m a
// minute with a 1.3 street factor, so they are labelled "approx." (the UI
// does the labels). One ground-hugging quad, all three rings drawn in its
// fragment shader, additive gold so the tallest things still stand in front.
import * as THREE from 'three';
import { BRAND } from '../config/materials';
import { ringRadius } from '../data/neighbourhood';

export const RING_MINUTES = [1, 3, 5] as const;

export class WalkRings {
  readonly group = new THREE.Group();
  private mat: THREE.ShaderMaterial;
  /** Current radii (metres), for the UI's labels. */
  readonly radii = [0, 0, 0];

  constructor(centre: THREE.Vector3) {
    const R = ringRadius(RING_MINUTES[RING_MINUTES.length - 1]) + 12;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uRadii: { value: new THREE.Vector3() },
        uAlpha: { value: 0 },
        uColor: { value: new THREE.Color(BRAND.gold).multiplyScalar(1.6) },
      },
      vertexShader: /* glsl */ `varying vec2 vP;
        void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform vec3 uRadii; uniform float uAlpha; uniform vec3 uColor; varying vec2 vP;
        float ring(float d, float r, float w){ return r < 0.5 ? 0.0 : exp(-pow((d - r) / w, 2.0)); }
        void main(){
          float d = length(vP);
          // a crisp line in a soft glow; the fill inside the first ring is barely there
          float a = 0.0;
          for (int i = 0; i < 3; i++) {
            float r = uRadii[i];
            a += ring(d, r, 0.9) * 0.9 + ring(d, r, 5.0) * 0.22;
          }
          a += 0.05 * (1.0 - smoothstep(0.0, max(uRadii.x, 0.001), d)) * step(0.5, uRadii.x);
          gl_FragColor = vec4(uColor, a * uAlpha);
        }`,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(R * 2, R * 2).rotateX(-Math.PI / 2), this.mat);
    quad.position.set(centre.x, 0.45, centre.z);
    quad.renderOrder = 5;
    quad.frustumCulled = false;
    quad.name = 'walk-rings';
    this.group.add(quad);
    this.group.visible = false;
  }

  /** Chapter 7: rings grow one after another as the camera climbs away. */
  setProgress(p: number): void {
    const grow = THREE.MathUtils.smoothstep(p, 0.9, 0.938);
    const alpha = THREE.MathUtils.smoothstep(p, 0.895, 0.91) * (1 - THREE.MathUtils.smoothstep(p, 0.95, 0.958));
    this.group.visible = alpha > 0.002;
    RING_MINUTES.forEach((m, i) => {
      const t = THREE.MathUtils.clamp(grow * 1.6 - i * 0.3, 0, 1);
      this.radii[i] = ringRadius(m) * (1 - Math.pow(1 - t, 3));
    });
    this.mat.uniforms.uRadii.value.set(this.radii[0], this.radii[1], this.radii[2]);
    this.mat.uniforms.uAlpha.value = alpha;
  }
}
