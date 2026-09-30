// The neighbourhood (brief §3 ch. 2 and 7): only confirmed places reach the
// page, the copy is built from them, and walking times follow the brief's
// formula unless the hotel publishes its own.
import { describe, expect, it } from 'vitest';
import raw from './data/neighbourhood.json';
import { displayName, groupsWith, neighbourhoodTitle, places, ringRadius, walkLabel, walkMinutes } from './data/neighbourhood';
import { matchPoi, placeAnchor } from './world/placeAnchors';
import { POINTS } from './world/layout';
import { en } from './content/en';
import { ms } from './content/ms';
import { zh } from './content/zh';
import { zhTW } from './content/zhTW';

describe('which places show', () => {
  it('shows only the confirmed entries unless the owner previews the rest', () => {
    const confirmed = raw.places.filter((p) => !p.verify_before_launch).map((p) => displayName(p.name));
    expect(places().map((p) => p.name)).toEqual(confirmed);
    expect(confirmed).toEqual(['Farley Sibu supermarket', 'Farley cafe.cafe']);
    expect(places({ includeUnverified: true })).toHaveLength(raw.places.length);
  });

  it('never names an unconfirmed place in the page copy', () => {
    for (const bundle of [en, ms, zh, zhTW]) {
      const copy = JSON.stringify(bundle);
      for (const p of raw.places.filter((q) => q.verify_before_launch)) {
        expect(copy.includes(displayName(p.name)), p.name).toBe(false);
      }
    }
  });

  it('builds chapter 2’s title from what is confirmed, and grows with it', () => {
    expect(neighbourhoodTitle(places(), en.neighbourhood)).toBe('The Farley supermarket and a café downstairs — steps from your door.');
    expect(en.chapters.find((c) => c.id === 2)!.title).toBe(neighbourhoodTitle(places(), en.neighbourhood));
    const all = neighbourhoodTitle(places({ includeUnverified: true }), en.neighbourhood);
    expect(all).toMatch(/bakeries/);
    expect(all).toMatch(/pharmacies/);
    expect(all).toMatch(/everyday services/);
    expect(groupsWith(places()).map((g) => g.key)).toEqual(['groceries', 'food']);
  });

  it('builds the same title in each language, from its own words', () => {
    expect(zh.chapters.find((c) => c.id === 2)!.title).toBe('Farley超市和楼下的咖啡馆——出门即达。');
    expect(zhTW.chapters.find((c) => c.id === 2)!.title).toBe('Farley超市和樓下的咖啡館——出門即達。');
    expect(ms.chapters.find((c) => c.id === 2)!.title).toBe('Pasar raya Farley dan kafe di tingkat bawah — hanya beberapa langkah dari pintu anda.');
    expect(neighbourhoodTitle([], zh.neighbourhood)).toBe(zh.neighbourhood.titleEmpty);
  });
});

describe('walking times', () => {
  it('uses the brief’s formula: straight line × 1.3 at 80 m a minute', () => {
    expect(walkMinutes(80 / 1.3)).toBeCloseTo(1, 9);
    expect(ringRadius(5)).toBeCloseTo((5 * 80) / 1.3, 9);
    expect(walkLabel({}, 100, en.neighbourhood)).toBe('approx. 2 min walk');
    expect(walkLabel({}, 20, en.neighbourhood)).toBe('next door');
    expect(walkLabel({}, 100, zh.neighbourhood)).toBe('步行约2分钟（估算）');
  });

  it('prefers a time the hotel publishes, so the page never contradicts itself', () => {
    const market = places().find((p) => /supermarket/.test(p.name))!;
    expect(market.walkStated).toBe(5);
    expect(walkLabel(market, 165, en.neighbourhood)).toBe('about 5 min walk');
  });
});

describe('where places sit', () => {
  it('matches OpenStreetMap names on a distinctive word, not a kind of shop', () => {
    expect(matchPoi('Farley Sibu supermarket')?.n).toBe('Farley Supermarket');
    expect(matchPoi('Bread Sense Bakery')?.n).toBe('Bread Sense Farley');
    expect(matchPoi('Farley Cafe older frontage')?.n).toBe('Farley Cafe');
    expect(matchPoi('Sunlight Pharmacy')).toBeNull(); // not the other pharmacy
    expect(matchPoi('Watsons')).toBeNull();
  });

  it('puts cafe.cafe on the hotel’s own ground floor, and the supermarket a few minutes away', () => {
    const [market, cafe] = places().map((p) => placeAnchor(p)!);
    const door = POINTS.lobbyDoor;
    const d = (w: { x: number; z: number }) => Math.hypot(w.x - door.x, w.z - door.z);
    expect(d(cafe)).toBeLessThan(20);
    expect(walkMinutes(d(market))).toBeGreaterThan(1.5);
    expect(walkMinutes(d(market))).toBeLessThan(6);
  });
});
