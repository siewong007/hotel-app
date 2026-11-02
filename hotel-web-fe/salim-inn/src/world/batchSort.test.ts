import { describe, expect, it } from 'vitest';
import { sortNearFirst } from './batchSort';

// The draw list BatchedMesh hands its sort: pooled items, pushed in instance order.
type Item = { start: number; count: number; z: number; index: number };

function list(n: number, seed: number, ties: boolean): Item[] {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return Array.from({ length: n }, (_, i) => ({
    start: i * 3,
    count: 3,
    z: ties ? Math.floor(rand() * 8) - 4 : (rand() - 0.5) * 2000,
    index: i,
  }));
}

describe('sortNearFirst (BatchedMesh.customSort)', () => {
  it.each([0, 1, 2, 15, 16, 17, 31, 33, 100, 257, 1000])('orders %i items exactly as three does', (n) => {
    for (const ties of [false, true]) {
      const ours = list(n, n + 7, ties);
      // three's own: Array.prototype.sort (stable) with (a, b) => a.z - b.z
      const three = [...ours].sort((a, b) => a.z - b.z);
      sortNearFirst(ours);
      expect(ours.map((x) => x.index)).toEqual(three.map((x) => x.index));
    }
  });

  it('keeps equal depths in list order', () => {
    const items = [3, 1, 3, 1, 3].map((z, index) => ({ start: 0, count: 0, z, index }));
    sortNearFirst(items);
    expect(items.map((x) => x.index)).toEqual([1, 3, 0, 2, 4]);
  });

  it('sorts a list shorter than the last one again (shared scratch)', () => {
    const long = list(300, 1, false);
    sortNearFirst(long);
    const short = list(40, 2, false);
    const expected = [...short].sort((a, b) => a.z - b.z).map((x) => x.index);
    sortNearFirst(short);
    expect(short.map((x) => x.index)).toEqual(expected);
    expect(short).toHaveLength(40);
  });
});
