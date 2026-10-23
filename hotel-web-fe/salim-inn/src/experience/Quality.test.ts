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

describe('FpsGovernor floor', () => {
  it('asks for fewer pixels once the lowest tier is still too slow', async () => {
    const { FpsGovernor } = await import('./Quality');
    const { TIERS } = await import('../config/quality');
    const g = new FpsGovernor(TIERS.low);
    const onDrop = vi.fn();
    const onFloor = vi.fn();
    g.onDrop = onDrop;
    g.onFloor = onFloor;
    for (let i = 0; i < 200; i++) g.frame(1 / 30);
    expect(onDrop).not.toHaveBeenCalled();
    expect(onFloor).toHaveBeenCalled();
  });
});
