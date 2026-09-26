// The owner's flying line, drawn progressively in chapter 2 with a travelling
// light dot. Flown as a smooth arc above the rooftops (it starts from the
// pack's high viewpoint), descending into the Farley ring and ending at the
// guest bay in front of the lobby. Points inside building footprints are
// pushed outside, so the line never lands on a roof.
import * as THREE from 'three';
import { ROUTE_POINTS, ROUTE_END } from '../data/route';
import { insideAnyPolygon } from './spatial';
import { BRAND } from '../config/materials';

function pushOutside(p: THREE.Vector3): THREE.Vector3 {
  if (!insideAnyPolygon(p.x, p.z)) return p;
  for (let r = 2; r < 80; r += 2) {
    for (let a = 0; a < 16; a++) {
      const x = p.x + Math.cos((a / 16) * Math.PI * 2) * r;
      const z = p.z + Math.sin((a / 16) * Math.PI * 2) * r;
      if (!insideAnyPolygon(x, z)) return p.set(x, p.y, z);
    }
  }
  return p;
}

export class RouteLine {
  readonly group = new THREE.Group();
  readonly curve: THREE.CatmullRomCurve3;
  private mat: THREE.ShaderMaterial;
  readonly dot: THREE.Mesh;
  private progress = 0;

  constructor() {
    // Drop the pack's final mini-loop around its (mis-placed) target; end at the door.
    // skip the first leg (it starts under the opening camera, 750 m out)
    const base = ROUTE_POINTS.slice(1, 8).map((p) => pushOutside(p.clone()));
    const n = base.length;
    const pts3 = base.map((p, i) => {
      const t = i / (n - 1);
      // altitude profile: 60 m over the city, easing down to rooftop height
      p.y = 24 - 6 * THREE.MathUtils.smoothstep(t, 0.75, 1);
      return p;
    });
    const approach = ROUTE_END.clone().add(new THREE.Vector3(0, 12, 0));
    pts3.push(approach.clone().lerp(pts3[pts3.length - 1], 0.5).setY(16), approach, ROUTE_END.clone().setY(1.2));
    this.curve = new THREE.CatmullRomCurve3(pts3, false, 'centripetal');
    const tube = new THREE.TubeGeometry(this.curve, 900, 0.9, 8, false);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uProgress: { value: 0 }, uColor: { value: new THREE.Color(BRAND.gold) }, uTime: { value: 0 }, uFade: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main(){
          vUv = uv;
          // keep the line a few pixels wide from 1 km up, 0.9 m at street level
          float dist = length((modelViewMatrix * vec4(position, 1.0)).xyz);
          vec3 p = position + normal * max(0.0, 0.0032 * dist - 0.9);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uProgress; uniform vec3 uColor; uniform float uTime; uniform float uFade; varying vec2 vUv;
        void main(){
          float head = uProgress;
          if (vUv.x > head) discard;
          float tail = smoothstep(head - 0.02, head, vUv.x);
          float pulse = 0.65 + 0.35 * sin((vUv.x - uTime * 0.05) * 160.0);
          float a = (0.55 + 0.45 * tail) * pulse;
          gl_FragColor = vec4(uColor * (1.6 + 2.5 * tail), a * uFade);
        }`,
    });
    const line = new THREE.Mesh(tube, this.mat);
    line.frustumCulled = false;
    line.name = 'route-line';
    line.renderOrder = 8;
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(BRAND.gold).multiplyScalar(4), toneMapped: false, transparent: true, depthWrite: false }));
    this.dot.name = 'route-dot';
    this.group.add(line, this.dot);
  }

  setProgress(p: number, dt: number): void {
    this.progress = p;
    this.mat.uniforms.uProgress.value = p;
    this.mat.uniforms.uTime.value += dt;
    this.group.visible = p > 0.001;
    this.curve.getPointAt(Math.min(0.999, Math.max(0, p)), this.dot.position);
    this.dot.visible = p > 0.001 && p < 0.999;
  }

  setFade(f: number): void {
    this.mat.uniforms.uFade.value = f;
    (this.dot.material as THREE.MeshBasicMaterial).opacity = f;
  }

  get value(): number {
    return this.progress;
  }
}
