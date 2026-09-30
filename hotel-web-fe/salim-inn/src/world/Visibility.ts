// Per-mesh visibility along the camera path (brief §8 draw calls). The
// camera is on rails, so which meshes can reach the screen at each point of
// the film can be measured once, offline: perf/probe.ts `pvs` renders an ID
// buffer at every 0.001 of the timeline, at five screen shapes, from every
// room type's configurator view and across the chapter-8 idle swing, and
// writes config/visibility.json. At runtime a mesh outside its spans moves to
// a layer the camera does not draw; module code that shows and hides parts
// through `visible` is untouched. The file carries a signature of the scene
// it measured: any other scene, or a screen shape it did not measure, turns
// the culling off rather than hide the wrong mesh.
import * as THREE from 'three';
import data from '../config/visibility.json';

/** Meshes culled for this frame. The camera draws layer 0 only (and the
 *  shadow pass adds 1, see ShadowCasters.ts). */
export const CULLED_LAYER = 2;

type Span = [number, number];
const ASPECTS: [number, number] = [0.4, 2.5]; // the audit's narrowest and widest screens
/** Screens at least this wide for their height use the landscape spans. */
const LANDSCAPE = 1.2;

/** Every drawable mesh, in scene order — the order the audit measured them
 *  in — leaving out subtrees rebuilt at runtime (the room's furniture). */
export function pvsMeshes(scene: THREE.Scene, skip: THREE.Object3D[]): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  const skipped = new Set(skip);
  const visit = (o: THREE.Object3D) => {
    if (skipped.has(o)) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && !(o as THREE.BatchedMesh).isBatchedMesh && o.layers.isEnabled(0)) out.push(m);
    for (const c of o.children) visit(c);
  };
  visit(scene);
  return out;
}

export function pvsSignature(meshes: THREE.Mesh[]): string {
  let h = 5381;
  for (const m of meshes) {
    const s = `${m.name}:${m.geometry.getAttribute('position')?.count ?? 0};`;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return `${meshes.length}-${h.toString(36)}`;
}

export class Visibility {
  readonly meshes: THREE.Mesh[];
  readonly signature: string;
  /** Whether the measured spans fit this scene. */
  readonly active: boolean;
  private list: { mesh: THREE.Mesh; wide: Span[] | null; tall: Span[] | null; on: boolean }[] = [];

  /** `part`: the exterior alone (before the interior is built, whose meshes
   *  come last in scene order) or the whole scene. */
  constructor(meshes: THREE.Mesh[], part: 'exterior' | 'full' = 'full') {
    this.meshes = meshes;
    this.signature = pvsSignature(meshes);
    const d = data as unknown as { signature: string; exteriorSignature?: string; exteriorCount?: number; spans: { landscape: Record<string, Span[]>; portrait: Record<string, Span[]> } };
    this.active = part === 'full' ? d.signature === this.signature : d.exteriorSignature === this.signature;
    if (!this.active) return;
    const upTo = part === 'full' ? Infinity : d.exteriorCount ?? 0;
    // spans measured on landscape screens and on portrait ones; a mesh with no
    // entry for a class is seen throughout on it
    const ids = new Set([...Object.keys(d.spans.landscape), ...Object.keys(d.spans.portrait)]);
    for (const i of ids) {
      const mesh = Number(i) < upTo ? meshes[Number(i)] : undefined;
      if (mesh) this.list.push({ mesh, wide: d.spans.landscape[i] ?? null, tall: d.spans.portrait[i] ?? null, on: true });
    }
  }

  /** perf/pvs.ts: the signature of the first n meshes (the exterior's). */
  signatureOfFirst(n: number): string {
    return pvsSignature(this.meshes.slice(0, n));
  }

  /** perf/pvs.ts verifies the spans by comparing frames with it off. */
  enabled = true;

  get culling(): number {
    return this.list.length;
  }

  /** Every mesh back on the drawn layer — before a successor takes over
   *  (World.buildInterior): it measures the scene by that layer and starts
   *  out believing everything is shown. */
  reset(): void {
    for (const e of this.list) {
      if (!e.on) e.mesh.layers.set(0);
      e.on = true;
    }
  }

  update(p: number, aspect: number): void {
    const enabled = this.enabled && aspect >= ASPECTS[0] && aspect <= ASPECTS[1];
    const wide = aspect >= LANDSCAPE;
    p = Math.min(1, Math.max(0, p));
    for (const e of this.list) {
      const spans = wide ? e.wide : e.tall;
      const on = !enabled || !spans || spans.some(([a, b]) => p >= a && p <= b);
      if (on !== e.on) {
        e.on = on;
        e.mesh.layers.set(on ? 0 : CULLED_LAYER);
      }
    }
  }
}
