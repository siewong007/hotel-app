// Pure-logic checks for the Salim Inn landing film: the geo frame, the chapter
// timeline, the converted Earth Studio keyframes and the camera rig's scroll
// mapping. Rendering itself is verified with screenshots, not here.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { bearingToXZ, project, unproject, xzToBearing } from './data/geo';
import { CHAPTERS, Timeline, chapterAt, localProgress } from './experience/Timeline';
import { EXTERIOR_KEYS, FILM_FOV_C3 } from './data/keyframes';
import { POINTS } from './world/layout';
import { CameraRig } from './experience/CameraRig';
import { PATH } from './experience/cameraPath';

describe('geo frame (brief §4.1)', () => {
  it('puts the ring centre at the origin and north at −Z', () => {
    expect(project(2.2655, 111.8625)).toEqual({ x: 0, z: -0 });
    const north = project(2.2665, 111.8625);
    expect(north.x).toBeCloseTo(0, 6);
    expect(north.z).toBeCloseTo(-110.574, 3);
    const east = project(2.2655, 111.8635);
    expect(east.x).toBeCloseTo(111.32 * Math.cos((2.2655 * Math.PI) / 180), 3);
  });

  it('round-trips through unproject', () => {
    const p = project(2.2691, 111.8604);
    const q = unproject(p.x, p.z);
    expect(q.lat).toBeCloseTo(2.2691, 9);
    expect(q.lon).toBeCloseTo(111.8604, 9);
  });

  it('converts compass bearings both ways', () => {
    for (const deg of [0, 45, 90, 181, 326]) {
      const v = bearingToXZ(deg);
      expect(xzToBearing(v.x, v.z)).toBeCloseTo(deg, 6);
    }
  });
});

describe('chapter timeline', () => {
  it('covers 0–1 with contiguous chapters in brief order', () => {
    expect(CHAPTERS.map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(CHAPTERS[0].p0).toBe(0);
    expect(CHAPTERS[CHAPTERS.length - 1].p1).toBe(1);
    for (let i = 1; i < CHAPTERS.length; i++) expect(CHAPTERS[i].p0).toBe(CHAPTERS[i - 1].p1);
  });

  it('maps progress to the right chapter and local progress', () => {
    expect(chapterAt(0).id).toBe(1);
    expect(chapterAt(0.35).id).toBe(3);
    expect(chapterAt(0.999).id).toBe(8);
    expect(chapterAt(1).id).toBe(8);
    const c3 = CHAPTERS[2];
    expect(localProgress((c3.p0 + c3.p1) / 2, c3)).toBeCloseTo(0.5, 9);
    expect(localProgress(-1, c3)).toBe(0);
  });

  it('keeps exposure between the chapter keyframes', () => {
    const t = new Timeline();
    const lo = Math.min(...CHAPTERS.map((c) => c.exposure));
    const hi = Math.max(...CHAPTERS.map((c) => c.exposure));
    for (let p = 0; p <= 1; p += 0.01) {
      t.set(p);
      expect(t.exposure()).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(t.exposure()).toBeLessThanOrEqual(hi + 1e-9);
    }
  });
});

describe('Earth Studio keyframes', () => {
  it('converts all ten keyframes and aims the Salim Inn ones at the block', () => {
    expect(EXTERIOR_KEYS).toHaveLength(10);
    for (const k of EXTERIOR_KEYS.slice(6)) expect(k.target.distanceTo(POINTS.hotelCentre)).toBeLessThan(1e-6);
  });

  it('keeps the pack framing on the lock-on orbit at the film FOV', () => {
    // KF6–9 are pulled in along their view rays: altitude falls with distance,
    // and never below the block's own roof line.
    const alts = EXTERIOR_KEYS.slice(6).map((k) => k.pos.y);
    for (let i = 1; i < alts.length; i++) expect(alts[i]).toBeLessThan(alts[i - 1]);
    expect(alts[3]).toBeGreaterThan(20);
    expect(alts[3]).toBeLessThan(48);
    expect(FILM_FOV_C3).toHaveLength(4);
  });
});

describe('camera rig', () => {
  it('advances monotonically along the path as the page scrolls', () => {
    const rig = new CameraRig(new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1000), PATH);
    let prev = -1;
    for (let i = 0; i <= 2000; i++) {
      const t = rig.paramAt(i / 2000);
      expect(t).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = t;
    }
    expect(rig.paramAt(0)).toBeCloseTo(0, 9);
    expect(rig.paramAt(1)).toBeCloseTo(1, 9);
  });
});
