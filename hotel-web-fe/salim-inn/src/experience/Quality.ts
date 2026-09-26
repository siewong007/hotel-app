// Quality tier selection (detect-gpu, benchmarks self-hosted) plus the runtime
// FPS governor: if the 2 s average drops below 45 fps the tier goes down one
// step. It never climbs back mid-session (brief §8).
import { getGPUTier } from 'detect-gpu';
import { GOVERNOR, TIERS, type Tier, type TierName } from '../config/quality';

const ORDER: TierName[] = ['high', 'medium', 'low'];

export async function detectTier(): Promise<{ tier: Tier; gpu: string; reason: string }> {
  const forced = new URLSearchParams(location.search).get('quality') as TierName | null;
  if (forced && forced in TIERS) return { tier: TIERS[forced], gpu: 'forced', reason: 'url' };
  try {
    const r = await getGPUTier({ benchmarksURL: new URL('assets/benchmarks', document.baseURI).href.replace(/\/$/, '') });
    const gpu = r.gpu ?? 'unknown';
    // detect-gpu tiers: 0 (blocklisted) … 3 (fast)
    const name: TierName = r.tier >= 3 ? 'high' : r.tier === 2 ? (r.isMobile ? 'medium' : 'high') : r.tier === 1 ? 'medium' : 'low';
    return { tier: TIERS[name], gpu, reason: `detect-gpu tier ${r.tier}${r.isMobile ? ' (mobile)' : ''}` };
  } catch {
    return { tier: TIERS.medium, gpu: 'unknown', reason: 'detect-gpu failed' };
  }
}

export class FpsGovernor {
  private samples: number[] = [];
  private sum = 0;
  private elapsed = 0;
  private sinceChange = 0;
  onDrop: ((t: Tier) => void) | null = null;

  tier: Tier;

  constructor(tier: Tier) {
    this.tier = tier;
  }

  frame(dt: number): void {
    this.elapsed += dt;
    this.sinceChange += dt;
    if (document.hidden || dt > 0.5) return; // tab switches / stalls aren't load
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
