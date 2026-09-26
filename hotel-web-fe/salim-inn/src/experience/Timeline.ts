// The master timeline: one progress value (0–1), driven by the smoothed scroll
// position, split into the brief's chapters (§3).
export interface ChapterDef {
  id: number;
  key: string;
  p0: number;
  p1: number;
  exposure: number; // tone-mapping exposure at the chapter's settled frame
}

export const CHAPTERS: ChapterDef[] = [
  { id: 1, key: 'establish', p0: 0.0, p1: 0.12, exposure: 1.2 },
  { id: 2, key: 'community', p0: 0.12, p1: 0.35, exposure: 1.18 },
  { id: 3, key: 'reveal', p0: 0.35, p1: 0.48, exposure: 1.18 },
  { id: 4, key: 'arrive', p0: 0.48, p1: 0.58, exposure: 1.16 },
  { id: 5, key: 'reception', p0: 0.58, p1: 0.72, exposure: 1.1 },
  { id: 6, key: 'rooms', p0: 0.72, p1: 0.88, exposure: 1.0 },
  { id: 7, key: 'footsteps', p0: 0.88, p1: 0.95, exposure: 1.05 },
  { id: 8, key: 'book', p0: 0.95, p1: 1.0, exposure: 1.02 },
];

export function chapterAt(p: number): ChapterDef {
  for (const c of CHAPTERS) if (p < c.p1) return c;
  return CHAPTERS[CHAPTERS.length - 1];
}

export function localProgress(p: number, c: ChapterDef): number {
  return Math.min(1, Math.max(0, (p - c.p0) / (c.p1 - c.p0)));
}

type Listener = (p: number) => void;

export class Timeline {
  progress = 0; // smoothed (what the camera reads)
  target = 0; // raw scroll target
  private listeners = new Set<Listener>();
  chapter = CHAPTERS[0];

  set(p: number): void {
    this.progress = Math.min(1, Math.max(0, p));
    this.chapter = chapterAt(this.progress);
    for (const l of this.listeners) l(this.progress);
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Exposure blended between chapter centres. */
  exposure(): number {
    const p = this.progress;
    const mids = CHAPTERS.map((c) => ({ m: (c.p0 + c.p1) / 2, e: c.exposure }));
    if (p <= mids[0].m) return mids[0].e;
    for (let i = 0; i < mids.length - 1; i++) {
      const a = mids[i], b = mids[i + 1];
      if (p <= b.m) {
        const t = (p - a.m) / (b.m - a.m);
        const s = t * t * (3 - 2 * t);
        return a.e + (b.e - a.e) * s;
      }
    }
    return mids[mids.length - 1].e;
  }
}
