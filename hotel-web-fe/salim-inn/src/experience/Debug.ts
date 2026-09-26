// ?debug=1 overlay (brief §8): stats-gl (FPS / CPU / GPU) + renderer.info
// (draw calls, triangles, geometries, textures, programs) + timeline and
// camera readouts, and the camera-clip check (§6.7): the whole camera path is
// sampled and tested against the scene with three-mesh-bvh; any sample closer
// than 0.3 m to geometry is logged. Loaded only in debug mode.
import * as THREE from 'three';
import Stats from 'stats-gl';
import { MeshBVH } from 'three-mesh-bvh';
import type { CameraRig } from './CameraRig';
import type { Timeline } from './Timeline';

export interface ClipReport {
  samples: number;
  minDistance: number;
  hits: { p: number; d: number; pos: [number, number, number]; mesh: string }[];
}

export class Debug {
  private stats: Stats;
  private el: HTMLElement;
  private last = 0;
  extra: Record<string, string | number> = {};

  private renderer: THREE.WebGLRenderer;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.stats = new Stats({ trackGPU: true, horizontal: true, logsPerSecond: 4, samplesLog: 60 });
    void this.stats.init(renderer);
    this.stats.dom.style.cssText += ';position:fixed;left:12px;top:84px;z-index:61';
    document.body.appendChild(this.stats.dom);
    this.el = document.getElementById('debug')!;
    this.el.hidden = false;
    if (new URLSearchParams(location.search).get('hud') === '0') {
      this.el.style.display = 'none';
      this.stats.dom.style.display = 'none';
    }
  }

  begin(): void {
    this.stats.begin();
  }

  end(timeline: Timeline, camera: THREE.PerspectiveCamera, calls: { calls: number; triangles: number }): void {
    this.stats.end();
    this.stats.update();
    const now = performance.now();
    if (now - this.last < 250) return;
    this.last = now;
    const info = this.renderer.info;
    const p = camera.position;
    const lines = [
      `progress  ${timeline.progress.toFixed(4)}   chapter ${timeline.chapter.id} (${timeline.chapter.key})`,
      `calls     ${calls.calls}   tris ${(calls.triangles / 1000).toFixed(1)}k`,
      `geoms     ${info.memory.geometries}   textures ${info.memory.textures}   programs ${info.programs?.length ?? 0}`,
      `camera    ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}   fov ${camera.fov.toFixed(1)}   near ${camera.near.toFixed(2)} far ${camera.far.toFixed(0)}`,
      ...Object.entries(this.extra).map(([k, v]) => `${k.padEnd(9)} ${v}`),
    ];
    this.el.textContent = lines.join('\n');
  }
}

/** Sample the whole path and report samples within `threshold` of geometry. */
export function clipCheck(rig: CameraRig, solids: THREE.Object3D[], samples = 3000, threshold = 0.3): ClipReport {
  const frames: THREE.Vector3[] = [];
  const f = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 0, roll: 0 };
  for (let i = 0; i <= samples; i++) {
    rig.evaluate(i / samples, f);
    frames.push(f.pos.clone());
  }
  // only geometry near the ground-level part of the path matters
  const low = frames.filter((v) => v.y < 60);
  const box = new THREE.Box3().setFromPoints(low.length ? low : frames).expandByScalar(40);

  const positions: number[] = [];
  const owners: string[] = [];
  const tmp = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const addGeo = (geo: THREE.BufferGeometry, matrix: THREE.Matrix4, name: string) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const pos = g.getAttribute('position');
    const gb = new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute).applyMatrix4(matrix);
    if (!gb.intersectsBox(box)) return;
    for (let i = 0; i < pos.count; i += 3) {
      const tri: number[] = [];
      let keep = false;
      for (let k = 0; k < 3; k++) {
        tmp.fromBufferAttribute(pos, i + k).applyMatrix4(matrix);
        if (box.containsPoint(tmp)) keep = true;
        tri.push(tmp.x, tmp.y, tmp.z);
      }
      if (!keep) continue;
      positions.push(...tri);
      owners.push(name);
    }
  };
  for (const root of solids) {
    root.updateWorldMatrix(true, true);
    const proxies = root.userData.clipProxies as { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; name: string }[] | undefined;
    if (proxies) {
      for (const p of proxies) addGeo(p.geometry, p.matrix.clone().premultiply(root.matrixWorld), p.name);
      continue;
    }
    root.traverse((o) => {
      if (!o.visible) return;
      if ((o as THREE.InstancedMesh).isInstancedMesh) {
        const im = o as THREE.InstancedMesh;
        for (let i = 0; i < im.count; i++) {
          im.getMatrixAt(i, m);
          m.premultiply(im.matrixWorld);
          addGeo(im.geometry, m, `${im.name}#${i}`);
        }
      } else if ((o as THREE.Mesh).isMesh) {
        const mesh = o as THREE.Mesh;
        const mat = mesh.material as THREE.Material;
        if (mat.transparent && (mat as THREE.MeshStandardMaterial).opacity < 0.5) return;
        addGeo(mesh.geometry, mesh.matrixWorld, mesh.name || mesh.parent?.name || 'mesh');
      }
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // indirect: keep the original triangle order so faceIndex maps to `owners`
  const bvh = new MeshBVH(geo, { indirect: true });
  const hits: ClipReport['hits'] = [];
  let minD = Infinity;
  const hit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  frames.forEach((pos, i) => {
    const r = bvh.closestPointToPoint(pos, hit as never, 0, 5);
    if (!r) return;
    const d = r.distance;
    if (d < minD) minD = d;
    if (d < threshold) hits.push({ p: i / samples, d, pos: [pos.x, pos.y, pos.z], mesh: owners[r.faceIndex] ?? '?' });
  });
  geo.dispose();
  return { samples: frames.length, minDistance: minD, hits };
}
