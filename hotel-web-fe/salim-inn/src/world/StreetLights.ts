// Street lamps (brief §4.3 far field): single-arm lamps along the main roads
// and tall twin-head lamps in the Farley car park, with warm light pools on
// the ground. Poles and heads are instanced; the pools are one instanced
// additive decal; all fade in with the dusk lights (city lights coming on).
import * as THREE from 'three';
import { site, pts } from '../data/site';
import { POINTS, footprints } from './layout';
import { bufferConvex, convexHull, mergeGeometries } from './geom';
import { insideAnyPolygon, roadClearance } from './spatial';
import { GLOBAL } from './shaders';

const R = 1500;

export class StreetLights {
  readonly group = new THREE.Group();
  readonly poles: THREE.InstancedMesh;
  readonly heads: THREE.InstancedMesh;
  readonly pools: THREE.InstancedMesh;
  count = 0;

  constructor() {
    const lamps: { x: number; z: number; ax: number; az: number; h: number }[] = [];
    const c = POINTS.hotelCentre;
    for (const r of site.roads) {
      if (!['primary', 'secondary', 'tertiary', 'primary_link'].includes(r.c)) continue;
      const line = pts(r.p);
      let carry = 0;
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, az] = line[i], [bx, bz] = line[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        const dx = (bx - ax) / L, dz = (bz - az) / L;
        let s = carry;
        while (s < L) {
          // right-hand kerb of a one-way carriageway, alternating sides on two-way roads
          const side = r.o ? 1 : lamps.length % 2 ? 1 : -1;
          const off = r.w / 2 + 1.1;
          const x = ax + dx * s - dz * off * side, z = az + dz * s + dx * off * side;
          if (Math.hypot(x - c.x, z - c.z) < R && roadClearance(x, z) > 0.4 && !insideAnyPolygon(x, z)) lamps.push({ x, z, ax: dz * side, az: -dx * side, h: 9 });
          s += 34;
        }
        carry = s - L;
      }
    }
    // Farley car park: tall poles every ~30 m along the outer edge of the ring
    const ring = bufferConvex(convexHull(footprints.flatMap((f) => f.outer)), 14, 3);
    const guest = POINTS.guestBay;
    let carryR = 8;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const L = a.distanceTo(b);
      let t = carryR;
      for (; t < L; t += 30) {
        const x = a.x + ((b.x - a.x) * t) / L, z = a.y + ((b.y - a.y) * t) / L;
        // keep the arrival flight in front of Salim Inn clear of poles
        if (Math.hypot(x - guest.x, z - guest.z) < 17) continue;
        if (roadClearance(x, z) > 0.5 && !insideAnyPolygon(x, z)) lamps.push({ x, z, ax: 0, az: 0, h: 12 });
      }
      carryR = t - L;
    }
    this.count = lamps.length;

    // built at 9 m; car-park lamps scale uniformly
    const pole = new THREE.CylinderGeometry(0.075, 0.13, 9, 8).translate(0, 4.5, 0);
    const arm = new THREE.CylinderGeometry(0.045, 0.045, 1.6, 6).rotateZ(Math.PI / 2).translate(0.8, 8.95, 0);
    const poleGeo = mergeGeometries([pole.toNonIndexed(), arm.toNonIndexed()], false)!;
    this.poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x8e9396, roughness: 0.45, metalness: 0.6 }), lamps.length);
    const head = new THREE.BoxGeometry(0.62, 0.12, 0.26);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x55595c, roughness: 0.4, emissive: 0xffc27a, emissiveIntensity: 0 });
    this.heads = new THREE.InstancedMesh(head, headMat, lamps.length);
    const poolMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uLights: GLOBAL.uLights, uColor: { value: new THREE.Color(0xffb866) } },
      vertexShader: /* glsl */ `varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform float uLights; uniform vec3 uColor; varying vec2 vUv;
        void main(){ float d = length(vUv - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - d), 2.2) * uLights * 0.55; gl_FragColor = vec4(uColor * a, a); }`,
    });
    this.pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat, lamps.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    lamps.forEach((l, i) => {
      const yaw = Math.atan2(-l.az, l.ax);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw);
      const k = l.h / 9;
      m.compose(new THREE.Vector3(l.x, 0, l.z), q, new THREE.Vector3(k, k, k));
      this.poles.setMatrixAt(i, m);
      const reach = (l.ax === 0 && l.az === 0 ? 0 : 1.55) * k;
      const hx = l.x + l.ax * reach, hz = l.z + l.az * reach;
      m.compose(new THREE.Vector3(hx, l.h + 0.02, hz), q, new THREE.Vector3(1, 1, 1));
      this.heads.setMatrixAt(i, m);
      const size = l.h > 10 ? 26 : 17;
      m.compose(new THREE.Vector3(hx, 0.14, hz), new THREE.Quaternion(), new THREE.Vector3(size, 1, size));
      this.pools.setMatrixAt(i, m);
    });
    this.poles.castShadow = true;
    this.poles.name = 'lamp-poles';
    this.heads.name = 'lamp-heads';
    this.pools.name = 'lamp-pools';
    this.pools.renderOrder = 3;
    this.pools.frustumCulled = false;
    this.group.add(this.poles, this.heads, this.pools);
  }

  update(lights: number): void {
    (this.heads.material as THREE.MeshStandardMaterial).emissiveIntensity = 6 * lights;
    this.pools.visible = lights > 0.02;
  }
}
