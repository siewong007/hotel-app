// BatchedMesh's near-to-far sort of its draw list, without the garbage.
// three re-sorts the list on every render of a batch — twice a frame for the
// trees and the cars (the camera, then the sun's shadow pass) — through
// Array.prototype.sort and an (a, b) => a.z - b.z comparator, and every
// comparison hands the sort builtin a freshly boxed number: about 3 MB a
// second while scrolling the film, the frame loop's largest source of garbage
// (perf: sampled allocations), and the young-generation collections that come
// with it. This is the same stable ascending order — ties keep their list
// order, as Array.prototype.sort does — so the batch draws exactly as before.
// For opaque batches only (three sorts transparent ones far to near).

type Item = { z: number };

let aux: Item[] = [];
const RUN = 16;

/** Sorts `list` by ascending z, stably, in place (BatchedMesh.customSort). */
export function sortNearFirst(list: Item[]): void {
  const n = list.length;
  if (n < 2) return;
  if (aux.length < n) aux = new Array<Item>(n);
  // insertion-sorted runs, then merged pairwise (bottom-up merge sort)
  for (let lo = 0; lo < n; lo += RUN) {
    const hi = Math.min(lo + RUN, n);
    for (let i = lo + 1; i < hi; i++) {
      const item = list[i];
      const z = item.z;
      let j = i - 1;
      while (j >= lo && list[j].z > z) {
        list[j + 1] = list[j];
        j--;
      }
      list[j + 1] = item;
    }
  }
  let src = list;
  let dst = aux;
  for (let width = RUN; width < n; width *= 2) {
    for (let lo = 0; lo < n; lo += 2 * width) {
      const mid = Math.min(lo + width, n);
      const hi = Math.min(lo + 2 * width, n);
      let i = lo, j = mid, k = lo;
      while (i < mid && j < hi) dst[k++] = src[j].z < src[i].z ? src[j++] : src[i++];
      while (i < mid) dst[k++] = src[i++];
      while (j < hi) dst[k++] = src[j++];
    }
    const t = src;
    src = dst;
    dst = t;
  }
  if (src !== list) for (let i = 0; i < n; i++) list[i] = src[i];
}
