// Quality tier selection (detect-gpu, benchmarks self-hosted) plus the runtime
// FPS governor: a sustained drop (4 s under 40 fps) sheds a step — pixel
// ratio first, down to its floor, then the tier — and a steady 55+ fps gives
// one back, never above where the film started.
import { getGPUTier } from 'detect-gpu';
import { GOVERNOR, TIERS, type Tier, type TierName } from '../config/quality';

const ORDER: TierName[] = ['high', 'medium', 'low'];

/** `blocked`: detect-gpu put the GPU at tier 0 (blocklisted, or no usable
 *  WebGL) — the page shows its still version instead (ui/Fallback.ts). */
export async function detectTier(): Promise<{ tier: Tier; gpu: string; reason: string; blocked: boolean }> {
  const forced = new URLSearchParams(location.search).get('quality') as TierName | null;
  if (forced && forced in TIERS) return { tier: TIERS[forced], gpu: 'forced', reason: 'url', blocked: false };
  try {
    const r = await getGPUTier({ benchmarksURL: new URL('/salim-inn/assets/benchmarks', document.baseURI).href.replace(/\/$/, '') });
    const gpu = r.gpu ?? 'unknown';
    // detect-gpu tiers: 0 (blocklisted) … 3 (fast)
    // Tier 2 and up start on high, phones included: an iPhone's Safari names
    // only "Apple GPU", so detect-gpu guesses from the screen and rarely says
    // 3, and the medium tier's half-res AO, missing depth of field and 1K
    // textures read as blurry on a Retina screen. The start-up calibration
    // and the governor (film.ts) take it down if this device can't hold it.
    const name: TierName = r.tier >= 2 ? 'high' : r.tier === 1 ? 'medium' : 'low';
    return { tier: TIERS[name], gpu, reason: `detect-gpu tier ${r.tier}${r.isMobile ? ' (mobile)' : ''}${r.fps ? `, ~${Math.round(r.fps)} fps` : ''}`, blocked: r.tier === 0 };
  } catch {
    return { tier: TIERS.medium, gpu: 'unknown', reason: 'detect-gpu failed', blocked: false };
  }
}

/** The next tier down, or null at the bottom. */
/** The next tier up, or null at the top. */
export function higherTier(t: Tier): Tier | null {
  const i = ORDER.indexOf(t.name);
  return i > 0 ? TIERS[ORDER[i - 1]] : null;
}

export function lowerTier(t: Tier): Tier | null {
  const i = ORDER.indexOf(t.name);
  return i < ORDER.length - 1 ? TIERS[ORDER[i + 1]] : null;
}

export class FpsGovernor {
  private samples: number[] = [];
  private sum = 0;
  private elapsed = 0;
  private sinceChange = 0;
  private fastFor = 0;
  private lastRaise = -Infinity;
  /** a raise that dropped straight back: no more raises this session */
  private raiseLocked = false;
  private held = false;
  /** Sustained below GOVERNOR.dropBelowFps: shed something (film.ts — the
   *  pixel ratio down to its floor first, then the tier). `dire` when under
   *  GOVERNOR.direFps. Returns whether anything changed. */
  onSlow: ((dire: boolean) => boolean) | null = null;
  /** Steady above GOVERNOR.raiseAboveFps: give one step back. */
  onFast: (() => boolean) | null = null;

  tier: Tier;

  constructor(tier: Tier) {
    this.tier = tier;
  }

  /** Main-thread work the film does on purpose (the interior's build, in
   *  slices between frames) is not GPU load: while held, frames don't count,
   *  and on release the grace period starts over. */
  hold(on: boolean): void {
    this.held = on;
    if (on) return;
    this.reset();
  }

  private reset(): void {
    this.samples = [];
    this.sum = 0;
    this.sinceChange = 0;
    this.fastFor = 0;
  }

  /** A browser holding the page at a steady 30 (iOS Low Power Mode, a
   *  throttled background-ish tab) is not overloaded: fewer pixels would
   *  only cost picture. */
  private capped(fps: number): boolean {
    if (fps < 27 || fps > 33) return false;
    const mean = this.sum / this.samples.length;
    let v = 0;
    for (const x of this.samples) v += (x - mean) ** 2;
    return Math.sqrt(v / this.samples.length) < 0.004;
  }

  frame(dt: number): void {
    this.elapsed += dt;
    this.sinceChange += dt;
    if (this.held || document.hidden || dt > 0.5) return; // tab switches / stalls aren't load
    this.samples.push(dt);
    this.sum += dt;
    while (this.sum > GOVERNOR.windowSeconds && this.samples.length > 1) this.sum -= this.samples.shift()!;
    if (this.sinceChange < GOVERNOR.graceSeconds || this.sum < GOVERNOR.windowSeconds * 0.95) return;
    const fps = this.samples.length / this.sum;
    if (fps < GOVERNOR.dropBelowFps && !this.capped(fps)) {
      if (this.elapsed - this.lastRaise < GOVERNOR.raiseSeconds + GOVERNOR.windowSeconds + GOVERNOR.graceSeconds) this.raiseLocked = true;
      this.onSlow?.(fps < GOVERNOR.direFps);
      this.reset();
      return;
    }
    if (fps > GOVERNOR.raiseAboveFps && !this.raiseLocked) {
      this.fastFor += dt;
      if (this.fastFor >= GOVERNOR.raiseSeconds) {
        if (this.onFast?.()) this.lastRaise = this.elapsed;
        this.reset();
      }
    } else this.fastFor = 0;
  }

  get fps(): number {
    return this.sum > 0 ? this.samples.length / this.sum : 0;
  }
}
