// One continuous camera (brief §6): position and look-target each follow
// their own centripetal Catmull-Rom spline through the path's control points,
// re-parameterised by (perceptually weighted) arc length so speed is even
// within a chapter. Chapters ease in and out of their beats; the look-target
// trails the spline through a critically damped spring.
import * as THREE from 'three';
import { PATH, type PathChapter } from './cameraPath';
import { CHAPTERS } from './Timeline';

const SAMPLES_PER_SEG = 96;
const DESIGN_ASPECT = 16 / 9;

interface ChapterMap {
  id: number;
  p0: number;
  p1: number;
  t0: number;
  t1: number;
  ts: Float64Array; // curve parameter samples
  cum: Float64Array; // cumulative weighted length (normalised 0..1)
  holdIn: number;
  holdOut: number;
}

// Share of each chapter's scroll spent holding still at its start / end, so
// copy can be read and the configurator/booking UI can be used.
const HOLDS: Record<number, [number, number]> = {
  1: [0.0, 0.18],
  2: [0.04, 0.06],
  3: [0.03, 0.22],
  4: [0.04, 0.05],
  5: [0.03, 0.3],
  6: [0.02, 0.38],
  7: [0.05, 0.18],
  8: [0.05, 0.5],
};

/** Velocity-trapezoid ease: sine ramps over `r` at each end, linear between. */
function trapezoid(u: number, r = 0.3): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const vmax = 1 / (1 - r);
  if (u < r) return vmax * (u / 2 - (r / (2 * Math.PI)) * Math.sin((Math.PI * u) / r));
  if (u > 1 - r) {
    const w = 1 - u;
    return 1 - vmax * (w / 2 - (r / (2 * Math.PI)) * Math.sin((Math.PI * w) / r));
  }
  return vmax * (r / 2 + (u - r));
}

export interface RigFrame {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
  roll: number;
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly posCurve: THREE.CatmullRomCurve3;
  readonly tgtCurve: THREE.CatmullRomCurve3;
  private fovs: number[] = [];
  private rolls: number[] = [];
  private maps: ChapterMap[] = [];
  private n: number;

  // spring state
  private look = new THREE.Vector3();
  private lookVel = new THREE.Vector3();
  private primed = false;
  smoothTime = 0.32;

  // idle orbit (chapter 8)
  private idleTime = 0;

  readonly frame: RigFrame = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 50, roll: 0 };
  private aspect = 16 / 9;
  private vw = 1600;
  private vh = 900;
  private tmp = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, chapters: PathChapter[] = PATH) {
    this.camera = camera;
    const pos: THREE.Vector3[] = [];
    const tgt: THREE.Vector3[] = [];
    const ends: number[] = [];
    for (const ch of chapters) {
      for (const p of ch.points) {
        pos.push(p.pos);
        tgt.push(p.target);
        this.fovs.push(p.fov);
        this.rolls.push(p.roll ?? 0);
      }
      ends.push(pos.length - 1);
    }
    this.n = pos.length;
    this.posCurve = new THREE.CatmullRomCurve3(pos, false, 'centripetal');
    this.tgtCurve = new THREE.CatmullRomCurve3(tgt, false, 'centripetal');

    let prevEnd = 0;
    chapters.forEach((ch, k) => {
      const def = CHAPTERS.find((c) => c.id === ch.id)!;
      const i0 = k === 0 ? 0 : prevEnd;
      const i1 = ends[k];
      prevEnd = i1;
      const t0 = i0 / (this.n - 1);
      const t1 = i1 / (this.n - 1);
      const segs = Math.max(1, i1 - i0);
      const count = segs * SAMPLES_PER_SEG + 1;
      const ts = new Float64Array(count);
      const cum = new Float64Array(count);
      let prev = this.posCurve.getPoint(t0);
      for (let s = 0; s < count; s++) {
        const t = t0 + ((t1 - t0) * s) / (count - 1);
        ts[s] = t;
        if (s === 0) continue;
        const p = this.posCurve.getPoint(t);
        const d = p.distanceTo(prev);
        const y = (p.y + prev.y) / 2;
        const w = ch.weight === 'altitude' ? 1 / Math.pow(Math.max(y, 0) + 8, 0.72) : 1;
        cum[s] = cum[s - 1] + d * w;
        prev = p;
      }
      const total = cum[count - 1] || 1;
      for (let s = 0; s < count; s++) cum[s] /= total;
      const [holdIn, holdOut] = HOLDS[ch.id] ?? [0, 0];
      this.maps.push({ id: ch.id, p0: def.p0, p1: def.p1, t0, t1, ts, cum, holdIn, holdOut });
    });
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
    this.vw = 1000 * aspect;
    this.vh = 1000;
  }

  /** Viewport size in CSS pixels (the projection works in these units). */
  setViewport(w: number, h: number): void {
    this.aspect = w / h;
    this.vw = w;
    this.vh = h;
  }

  /** A pose to blend toward (the room configurator's photo-matched view):
   *  world-space camera and target, the screen rectangle (CSS px) the photo
   *  frame occupies, and the photo's vertical FOV. */
  view: { pos: THREE.Vector3; target: THREE.Vector3; rect: { x: number; y: number; w: number; h: number }; vfov: number; roll?: number } | null = null;
  viewWeight = 0;

  /** Curve parameter for a timeline progress value. */
  paramAt(p: number): number {
    const m = this.maps.find((c) => p < c.p1) ?? this.maps[this.maps.length - 1];
    let u = (p - m.p0) / (m.p1 - m.p0);
    u = Math.min(1, Math.max(0, u));
    const span = 1 - m.holdIn - m.holdOut;
    u = Math.min(1, Math.max(0, (u - m.holdIn) / span));
    const s = trapezoid(u, 0.3);
    // binary search s in cum
    const { cum, ts } = m;
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < s) lo = mid;
      else hi = mid;
    }
    const f = cum[hi] - cum[lo] > 1e-12 ? (s - cum[lo]) / (cum[hi] - cum[lo]) : 0;
    return ts[lo] + (ts[hi] - ts[lo]) * f;
  }

  private scalarAt(values: number[], t: number): number {
    const x = t * (this.n - 1);
    const i = Math.min(this.n - 2, Math.max(0, Math.floor(x)));
    const f = x - i;
    const s = f * f * (3 - 2 * f);
    return values[i] + (values[i + 1] - values[i]) * s;
  }

  /** Evaluate the rig without touching the camera (used by the clip check). */
  evaluate(p: number, out: RigFrame = this.frame): RigFrame {
    const t = this.paramAt(p);
    this.posCurve.getPoint(t, out.pos);
    this.tgtCurve.getPoint(t, out.target);
    out.fov = this.scalarAt(this.fovs, t);
    out.roll = this.scalarAt(this.rolls, t);
    return out;
  }

  effectiveFov(designFov: number): number {
    const a = this.aspect;
    if (a >= DESIGN_ASPECT) return designFov;
    const k = a >= 1 ? 0.3 : 0.4;
    const f = Math.pow(DESIGN_ASPECT / a, k);
    const fov = (2 * Math.atan(Math.tan((designFov * Math.PI) / 360) * f) * 180) / Math.PI;
    return Math.min(fov, a >= 1 ? 80 : 72);
  }

  /** Snap the spring (after a jump, or before a screenshot). */
  snap(): void {
    this.primed = false;
    this.focusPrimed = false;
  }

  /** Where the camera is pointed this frame. */
  readonly aim = new THREE.Vector3();
  /** What depth of field keeps sharp where that is not the aim, set before
   *  update: in the room the path looks toward the window and the beds sit
   *  to one side, 4–6 m nearer than the aim (World.subject). */
  subject: THREE.Vector3 | null = null;
  /** Distance to the subject (or the aim), pulled to it over about a third
   *  of a second: brief §5 "shallow and slow". */
  focus = 5;
  private focusPrimed = false;

  private pullFocus(dt: number): void {
    const d = this.camera.position.distanceTo(this.subject ?? this.aim);
    this.focus = this.focusPrimed ? THREE.MathUtils.damp(this.focus, d, 3, Math.min(dt, 0.1)) : d;
    this.focusPrimed = true;
  }

  /** Debug/calibration: pin the camera (world space), bypassing the path. */
  override: { pos: THREE.Vector3; target: THREE.Vector3; fov: number; noShift?: boolean; roll?: number } | null = null;

  update(progress: number, dt: number, idleWeight = 0): void {
    if (this.override) {
      const o = this.override;
      const cam = this.camera;
      cam.position.copy(o.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(o.target);
      if (o.roll) cam.rotateZ(THREE.MathUtils.degToRad(o.roll));
      this.look.copy(o.target);
      this.aim.copy(o.target);
      this.focusPrimed = false;
      this.pullFocus(dt);
      if (o.noShift) this.applyPrincipal(this.vw / 2, this.vh / 2, this.vh / (2 * Math.tan((o.fov * Math.PI) / 360)));
      else {
        const [cx, cy, k] = this.pathPrincipal(o.fov);
        this.applyPrincipal(cx, cy, k);
      }
      return;
    }
    const f = this.evaluate(progress);
    const cam = this.camera;

    // Chapter-8 idle orbit: a slow ±9° swing about the look-target.
    this.idleTime += dt;
    if (idleWeight > 0.001) {
      const ang = Math.sin(this.idleTime * ((2 * Math.PI) / 70)) * THREE.MathUtils.degToRad(9) * idleWeight;
      const rel = this.tmp.copy(f.pos).sub(f.target);
      rel.applyAxisAngle(THREE.Object3D.DEFAULT_UP, ang);
      f.pos.copy(f.target).add(rel);
    }

    cam.position.copy(f.pos);

    // Critically damped spring on the look-target (SmoothDamp form).
    if (!this.primed) {
      this.look.copy(f.target);
      this.lookVel.set(0, 0, 0);
      this.primed = true;
    } else {
      const omega = 2 / this.smoothTime;
      const x = omega * Math.min(dt, 0.1);
      const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
      const change = this.tmp.copy(this.look).sub(f.target);
      const temp = this.lookVel.clone().addScaledVector(change, omega).multiplyScalar(Math.min(dt, 0.1));
      this.lookVel.addScaledVector(temp, -omega).multiplyScalar(exp);
      this.look.copy(f.target).add(change.add(temp).multiplyScalar(exp));
    }
    // blend toward the configurator's view (position, aim, roll, projection)
    const w = this.view ? THREE.MathUtils.clamp(this.viewWeight, 0, 1) : 0;
    const aim = this.tmp.copy(this.look);
    if (w > 0) {
      cam.position.lerp(this.view!.pos, w);
      aim.lerp(this.view!.target, w);
    }
    cam.up.set(0, 1, 0);
    cam.lookAt(aim);
    this.aim.copy(aim);
    this.pullFocus(dt);
    const roll = f.roll * (1 - w) + (this.view?.roll ?? 0) * w;
    if (Math.abs(roll) > 1e-3) cam.rotateZ(THREE.MathUtils.degToRad(roll));

    const [cx, cy, k] = this.pathPrincipal(this.effectiveFov(f.fov));
    if (w > 0) {
      const r = this.view!.rect;
      const kv = r.h / (2 * Math.tan((this.view!.vfov * Math.PI) / 360));
      this.applyPrincipal(
        THREE.MathUtils.lerp(cx, r.x + r.w / 2, w),
        THREE.MathUtils.lerp(cy, r.y + r.h / 2, w),
        Math.exp(THREE.MathUtils.lerp(Math.log(k), Math.log(kv), w)),
      );
    } else this.applyPrincipal(cx, cy, k);
  }

  /** The path's principal point (CSS px) and scale (px per unit tangent):
   *  on portrait screens the principal point sits above centre (subject clear
   *  of the bottom copy panel), on landscape right of centre (copy column on
   *  the left) — a lens shift, so verticals stay vertical. */
  private pathPrincipal(fov: number): [number, number, number] {
    const a = this.aspect, W = this.vw, H = this.vh;
    const sy = a < 0.8 ? 0.11 : a < 1.2 ? 0.05 : 0;
    const sx = a >= 1.2 ? this.shiftX : 0;
    return [W / 2 + sx * W, H / 2 - sy * H, H / (2 * Math.tan((fov * Math.PI) / 360))];
  }

  /** Projection with the principal point at (cx, cy) CSS px and scale k:
   *  a virtual frame centred on the principal point, of which the canvas is
   *  one window (THREE's view offset). */
  private applyPrincipal(cx: number, cy: number, k: number): void {
    const cam = this.camera;
    const W = this.vw, H = this.vh;
    const hx = Math.max(cx, W - cx), hy = Math.max(cy, H - cy);
    cam.aspect = hx / hy;
    cam.fov = (2 * Math.atan(hy / k) * 180) / Math.PI;
    if (Math.abs(hx - W / 2) < 0.5 && Math.abs(hy - H / 2) < 0.5) {
      if (cam.view) cam.clearViewOffset();
    } else cam.setViewOffset(2 * hx, 2 * hy, hx - cx, hy - cy, W, H);
    cam.updateProjectionMatrix();
  }

  /** Horizontal principal-point shift as a fraction of width (desktop). */
  shiftX = 0.12;

  get lookTarget(): THREE.Vector3 {
    return this.look;
  }

  get chapterMaps(): readonly ChapterMap[] {
    return this.maps;
  }
}
