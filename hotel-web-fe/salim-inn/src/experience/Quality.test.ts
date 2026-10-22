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
