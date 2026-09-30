// Quality tier selection (detect-gpu, benchmarks self-hosted) plus the runtime
// FPS governor: if the 2 s average drops below 45 fps the tier goes down one
// step. It never climbs back mid-session (brief §8).
import { getGPUTier } from 'detect-gpu';
import { GOVERNOR, TIERS, type Tier, type TierName } from '../config/quality';

const ORDER: TierName[] = ['high', 'medium', 'low'];

/** `blocked`: detect-gpu put the GPU at tier 0 (blocklisted, or no usable
 *  WebGL) — the page shows its still version instead (ui/Fallback.ts). */
export async function detectTier(): Promise<{ tier: Tier; gpu: string; reason: string; blocked: boolean }> {
  const forced = new URLSearchParams(location.search).get('quality') as TierName | null;
  if (forced && forced in TIERS) return { tier: TIERS[forced], gpu: 'forced', reason: 'url', blocked: false };
  try {
    const r = await getGPUTier({ benchmarksURL: new URL('assets/benchmarks', document.baseURI).href.replace(/\/$/, '') });
    const gpu = r.gpu ?? 'unknown';
    // detect-gpu tiers: 0 (blocklisted) … 3 (fast)
    const name: TierName = r.tier >= 3 ? 'high' : r.tier === 2 ? (r.isMobile ? 'medium' : 'high') : r.tier === 1 ? 'medium' : 'low';
    return { tier: TIERS[name], gpu, reason: `detect-gpu tier ${r.tier}${r.isMobile ? ' (mobile)' : ''}${r.fps ? `, ~${Math.round(r.fps)} fps` : ''}`, blocked: r.tier === 0 };
  } catch {
    return { tier: TIERS.medium, gpu: 'unknown', reason: 'detect-gpu failed', blocked: false };
  }
}

/** The next tier down, or null at the bottom. */
export function lowerTier(t: Tier): Tier | null {
  const i = ORDER.indexOf(t.name);
  return i < ORDER.length - 1 ? TIERS[ORDER[i + 1]] : null;
}

export class FpsGovernor {
  private samples: number[] = [];
  private sum = 0;
  private elapsed = 0;
  private sinceChange = 0;
  private held = false;
  onDrop: ((t: Tier) => void) | null = null;

  tier: Tier;

  constructor(tier: Tier) {
    this.tier = tier;
  }

  /** Main-thread work the film does on purpose (the interior's build, in
   *  slices between frames) is not GPU load: while held, frames don't count,
   *  and on release the grace period starts over. On a phone the build's
   *  slower frames otherwise read as overload, and the tier never climbs
   *  back. */
  hold(on: boolean): void {
    this.held = on;
    if (on) return;
    this.samples = [];
    this.sum = 0;
    this.sinceChange = 0;
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
    if (fps < GOVERNOR.dropBelowFps) {
      const i = ORDER.indexOf(this.tier.name);
      if (i < ORDER.length - 1) {
        this.tier = TIERS[ORDER[i + 1]];
        this.sinceChange = 0;
        this.samples = [];
        this.sum = 0;
        this.onDrop?.(this.tier);
      }
    }
  }

  get fps(): number {
    return this.sum > 0 ? this.samples.length / this.sum : 0;
  }
}
