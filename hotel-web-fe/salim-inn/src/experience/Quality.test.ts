import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGPUTier } from 'detect-gpu';
import { detectTier } from './Quality';

vi.mock('detect-gpu', () => ({ getGPUTier: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('landing GPU benchmarks', () => {
  it.each(['/', '/salim-inn/index.html'])('loads the same benchmarks from %s', async (path) => {
    window.history.replaceState(null, '', path);
    vi.mocked(getGPUTier).mockResolvedValue({ tier: 2, type: 'BENCHMARK', gpu: 'test' });
    await detectTier();
    expect(getGPUTier).toHaveBeenCalledWith({
      benchmarksURL: `${window.location.origin}/salim-inn/assets/benchmarks`,
    });
  });
});

describe('FpsGovernor', () => {
  const make = async () => {
    const { FpsGovernor } = await import('./Quality');
    const { TIERS } = await import('../config/quality');
    const g = new FpsGovernor(TIERS.high);
    const slow = vi.fn(() => true);
    const fast = vi.fn(() => true);
    g.onSlow = slow;
    g.onFast = fast;
    return { g, slow, fast };
  };
  const run = (g: { frame: (dt: number) => void }, fps: number, seconds: number, jitter = 0) => {
    for (let t = 0, i = 0; t < seconds; i++) { const dt = 1 / fps + (i % 2 ? jitter : -jitter); g.frame(dt); t += dt; }
  };

  it('ignores a short hitch, steps down on a sustained drop', async () => {
    const { g, slow } = await make();
    run(g, 60, 6);
    run(g, 20, 1);
    run(g, 60, 6);
    expect(slow).not.toHaveBeenCalled();
    run(g, 35, 10, 0.006);
    expect(slow).toHaveBeenCalledWith(false);
  });

  it('flags a dire drop', async () => {
    const { g, slow } = await make();
    run(g, 18, 12, 0.01);
    expect(slow).toHaveBeenCalledWith(true);
  });

  it('leaves a steady 30 fps cap (Low Power Mode) alone', async () => {
    const { g, slow } = await make();
    run(g, 30, 30);
    expect(slow).not.toHaveBeenCalled();
  });

  it('recovers upward when steady and fast', async () => {
    const { g, fast } = await make();
    run(g, 60, 20);
    expect(fast).toHaveBeenCalled();
  });

  it('stops raising once a raise drops straight back', async () => {
    const { g, fast, slow } = await make();
    run(g, 60, 14); // a raise
    const raises = fast.mock.calls.length;
    run(g, 35, 10, 0.006); // and straight back down
    expect(slow).toHaveBeenCalled();
    run(g, 60, 40);
    expect(fast.mock.calls.length).toBe(raises);
  });
});
