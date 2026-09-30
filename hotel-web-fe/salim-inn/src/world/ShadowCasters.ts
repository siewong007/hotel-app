// Static shadow casters, baked once (brief §8 draw-call budget). The sun's
// shadow map drew every caster every frame, a draw each — 34 of them. All
// but the batched cars and near trees stand still, so their triangles are
// baked into world space and drawn as one mesh per face-culling mode, on a
// layer only the shadow pass sees (experience/Renderer.ts). The originals
// stop casting; they still receive.
import * as THREE from 'three';

/** Seen by the shadow pass only: the renderer enables it on the camera just
 *  for that pass, after the frame's draw list has been built without it. */
export const SHADOW_ONLY_LAYER = 1;

export function bakeShadowCasters(roots: THREE.Object3D[]): THREE.Group {
  const out = new THREE.Group();
  out.name = 'shadow-casters';
  // pass 1: who casts, and how many triangles per culling mode
  type Src = { mesh: THREE.Mesh; count: number };
  const bySide = new Map<string, { side: THREE.Side; shadowSide: THREE.Side | null; srcs: Src[]; verts: number }>();
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.castShadow || (o as THREE.BatchedMesh).isBatchedMesh || o.userData.liveShadow) return;
      const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
      const key = `${mat.side}|${mat.shadowSide}`;
      const g = mesh.geometry;
      const n = g.index ? g.index.count : g.attributes.position.count;
      const count = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1;
      const b = bySide.get(key) ?? { side: mat.side, shadowSide: mat.shadowSide, srcs: [], verts: 0 };
      b.srcs.push({ mesh, count });
      b.verts += n * count;
      bySide.set(key, b);
    });
  }
  // pass 2: bake
  const m4 = new THREE.Matrix4(), mi = new THREE.Matrix4(), v = new THREE.Vector3();
  for (const b of bySide.values()) {
    const pos = new Float32Array(b.verts * 3);
    let w = 0;
    for (const { mesh, count } of b.srcs) {
      const g = mesh.geometry;
      const p = g.attributes.position;
      const idx = g.index;
      const n = idx ? idx.count : p.count;
      const inst = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh) : null;
      for (let k = 0; k < count; k++) {
        if (inst) m4.multiplyMatrices(mesh.matrixWorld, (inst.getMatrixAt(k, mi), mi));
        else m4.copy(mesh.matrixWorld);
        for (let i = 0; i < n; i++) {
          v.fromBufferAttribute(p, idx ? idx.getX(i) : i).applyMatrix4(m4);
          pos[w++] = v.x; pos[w++] = v.y; pos[w++] = v.z;
        }
      }
      mesh.castShadow = false;
      mesh.userData.bakedShadow = true; // (perf/probe.ts A/Bs the bake against the originals)
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.computeBoundingSphere();
    const proxy = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: b.side, shadowSide: b.shadowSide }));
    proxy.name = `shadow-casters-${b.side}`;
    proxy.castShadow = true;
    proxy.layers.set(SHADOW_ONLY_LAYER);
    proxy.matrixAutoUpdate = false;
    out.add(proxy);
  }
  return out;
}
