// Settled frames. Once the visitor stops scrolling, the film keeps drawing at
// the display's rate while nothing in the scene moves: the scene is a function
// of the timeline, the camera and a few eased values, and they have all come
// to rest. Such a frame need not draw the scene, its shadows, AO, bloom and
// depth of field again — the graded image is still in the post chain's buffer
// — and only the final pass (SMAA, grade, vignette and the live grain) runs
// over it again (Post.renderSettled). On a phone that is most of a frame's GPU
// time saved while the visitor reads, which is what keeps it cool enough to
// hold the full resolution through the next scroll.
//
// film.ts keys each frame on what it draws; a frame whose key equals the last
// drawn frame's, exactly, is settled. Exactly, because no change is too small
// to show: the camera turning by a ten-millionth of a radian, or the shadow
// frustum growing by a millimetre, moved SMAA's edges and the sun's shadow
// texels by up to 99 levels in places (film.ts settleCheck, the pixel check).
// The eased values therefore finish their last, invisible step at once
// (CameraRig, World.update, Atmosphere.update), so a film at rest is exactly
// at rest. Whatever moves on its own (the cloud deck, rain, a room type
// changing over) must stop settling (World.animating), and a change made
// outside the frame loop must count itself here (sceneEdits).

const SIZE = 128;

/** A frame's inputs as numbers, compared with the last frame drawn in full. */
export class FrameKey {
  private readonly cur = new Float64Array(SIZE);
  private readonly last = new Float64Array(SIZE);
  private n = 0;
  private lastN = -1;

  /** Start this frame's key. */
  begin(): this {
    this.n = 0;
    return this;
  }

  add(v: number): this {
    if (this.n < SIZE) this.cur[this.n] = v;
    this.n++;
    return this;
  }

  addAll(values: ArrayLike<number>): this {
    for (let i = 0; i < values.length; i++) this.add(values[i]);
    return this;
  }

  /** This frame draws what the last drawn one did. */
  matches(): boolean {
    if (this.n !== this.lastN || this.n > SIZE) return false;
    for (let i = 0; i < this.n; i++) if (!(this.cur[i] === this.last[i])) return false;
    return true;
  }

  /** perf/ (film.ts settleCheck): this frame's key and the last drawn one's. */
  values(): { cur: number[]; last: number[] } {
    return { cur: Array.from(this.cur.subarray(0, Math.min(this.n, SIZE))), last: Array.from(this.last.subarray(0, Math.max(0, Math.min(this.lastN, SIZE)))) };
  }

  /** This frame was drawn in full: later frames compare with it. */
  commit(): void {
    this.lastN = this.n;
    if (this.n <= SIZE) this.last.set(this.cur.subarray(0, this.n));
  }
}

/** Scene changes made outside the frame loop — a room type picked, a texture
 *  that finished loading, a tier change: each bumps the count, and the next
 *  frame is drawn in full. */
export const sceneEdits = {
  count: 0,
  bump(): void {
    this.count++;
  },
};
