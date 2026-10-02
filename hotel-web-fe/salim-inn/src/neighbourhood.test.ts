// The neighbourhood (brief §3 ch. 2 and 7): only confirmed places reach the
// page, the copy is built from them, and walking times follow the brief's
// formula unless the hotel publishes its own.
import { describe, expect, it } from 'vitest';
import raw from './data/neighbourhood.json';
import { DISH_KEYS, PLACE_KINDS, dishes, displayName, groupsWith, neighbourhoodTitle, places, ringRadius, walkLabel, walkMinutes } from './data/neighbourhood';
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
    // the two from the first pass, then the owner's confirmations of 3 Oct 2026
    expect(confirmed).toEqual([
      'Farley Sibu supermarket', 'Farley cafe.cafe',
      'Farley Old Food Court', 'Farley New Food Court', '二鱼粮食站', 'Secret Recipe', 'Farley Bakery',
      'Alpro Pharmacy', 'Sunlight Pharmacy', 'Watsons', 'Klinik Pergigian Dr Ho', 'Klinik Komuniti Sentosa', 'Low Medical Clinic',
      'Ekoway Hardware', 'Hair Story',
    ]);
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
    // four categories: the first two, then "and more" (all four ran to six lines)
    expect(neighbourhoodTitle(places(), en.neighbourhood)).toBe('The Farley supermarket, kopitiams and more — steps from your door.');
    expect(en.chapters.find((c) => c.id === 2)!.title).toBe(neighbourhoodTitle(places(), en.neighbourhood));
    // two categories are named in full, from what is in them
    expect(neighbourhoodTitle(places().slice(0, 2), en.neighbourhood)).toBe('The Farley supermarket and a café downstairs — steps from your door.');
    const eat = places().filter((p) => p.group === 'groceries' || p.group === 'food');
    expect(neighbourhoodTitle(eat, en.neighbourhood)).toBe('The Farley supermarket and kopitiams, cafés and a bakery — steps from your door.');
    const care = places().filter((p) => p.group === 'health' || p.group === 'services');
    expect(neighbourhoodTitle(care, en.neighbourhood)).toBe('Pharmacies and clinics and everyday services — steps from your door.');
    const all = places({ includeUnverified: true });
    expect(neighbourhoodTitle(all.filter((p) => p.group === 'food'), en.neighbourhood)).toBe('Kopitiams, cafés and bakeries — steps from your door.');
    expect(groupsWith(places()).map((g) => g.key)).toEqual(['groceries', 'food', 'health', 'services']);
  });

  it('builds the same title in each language, from its own words', () => {
    expect(zh.chapters.find((c) => c.id === 2)!.title).toBe('Farley超市、咖啡店等——出门即达。');
    expect(zhTW.chapters.find((c) => c.id === 2)!.title).toBe('Farley超市、咖啡店等——出門即達。');
    expect(ms.chapters.find((c) => c.id === 2)!.title).toBe('Pasar raya Farley, kopitiam dan banyak lagi — hanya beberapa langkah dari pintu anda.');
    expect(neighbourhoodTitle(places().slice(0, 2), zh.neighbourhood)).toBe('Farley超市和楼下的咖啡馆——出门即达。');
    expect(neighbourhoodTitle([], zh.neighbourhood)).toBe(zh.neighbourhood.titleEmpty);
  });
});

describe('what the cards say', () => {
  it('describes every confirmed place in the visitor’s language, never with the file’s research notes', () => {
    for (const p of places()) expect(p.kind, p.name).toBeDefined();
    for (const p of raw.places) if ('kind' in p) expect(PLACE_KINDS as readonly string[], p.name).toContain(p.kind);
    for (const bundle of [en, ms, zh, zhTW]) {
      for (const k of PLACE_KINDS) expect(bundle.neighbourhood.kinds[k], k).toBeTruthy();
    }
  });

  it('lists the must-try dishes the owner confirmed, their picks first', () => {
    expect(dishes().map((d) => d.key)).toEqual(['kampua', 'kompia', 'redWineMeeSua', 'dimSum', 'redKoloMee']);
    // a dish from reviews needs the owner: one flagged in the file stays off the page
    const flagged = raw.dishes.filter((d) => d.verify_before_launch).map((d) => d.key);
    expect(dishes().filter((d) => flagged.includes(d.key))).toEqual([]);
    expect(raw.dishes.map((d) => d.key)).toEqual([...DISH_KEYS]);
    for (const bundle of [en, ms, zh, zhTW]) {
      for (const k of DISH_KEYS) {
        expect(bundle.neighbourhood.mustTry.dishes[k].name, k).toBeTruthy();
        expect(bundle.neighbourhood.mustTry.dishes[k].note, k).toBeTruthy();
      }
    }
  });

  it('says which dishes contain pork or alcohol, in every language', () => {
    expect(en.neighbourhood.mustTry.dishes.kampua.note).toMatch(/pork/);
    expect(en.neighbourhood.mustTry.dishes.kompia.note).toMatch(/pork/);
    expect(en.neighbourhood.mustTry.dishes.redWineMeeSua.note).toMatch(/wine/);
    expect(ms.neighbourhood.mustTry.dishes.kampua.note).toMatch(/babi/);
    expect(ms.neighbourhood.mustTry.dishes.kompia.note).toMatch(/babi/);
    expect(ms.neighbourhood.mustTry.dishes.redWineMeeSua.note).toMatch(/wain/);
    expect(zh.neighbourhood.mustTry.dishes.kampua.note).toMatch(/猪肉/);
    expect(zhTW.neighbourhood.mustTry.dishes.kompia.note).toMatch(/豬肉/);
  });
});

describe('walking times', () => {
  it('uses the brief’s formula: straight line × 1.3 at 80 m a minute', () => {
    expect(walkMinutes(80 / 1.3)).toBeCloseTo(1, 9);
    expect(ringRadius(5)).toBeCloseTo((5 * 80) / 1.3, 9);
    expect(walkLabel({}, 100, en.neighbourhood)).toBe('approx. 2 min walk');
    expect(walkLabel({}, 20, en.neighbourhood)).toBe('next door');
    expect(walkLabel({}, 50, en.neighbourhood)).toBe('approx. 1 min walk'); // under a minute, but not next door
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
    expect(matchPoi('Secret Recipe')?.n).toBe('Secret Recipe');
    expect(matchPoi('Klinik Komuniti Sentosa')?.n).toBe('Klinik Komuniti Sentosa');
    // no pin: "old" and "new" are distinctive, and a Chinese name has no Latin words
    expect(matchPoi('Farley Old Food Court')).toBeNull();
    expect(matchPoi('Farley New Food Court')).toBeNull();
    expect(matchPoi('二鱼粮食站')).toBeNull();
  });

  it('pins a shop the map knows by another name to that point, and the clinic beside it there too', () => {
    const ekoway = places().find((p) => p.name === 'Ekoway Hardware')!;
    expect(matchPoi(ekoway.name)).toBeNull();
    expect(placeAnchor(ekoway)).not.toBeNull();
    expect(ekoway.osm).toBe('Eco Hardware');
    const low = places().find((p) => p.name === 'Low Medical Clinic')!;
    expect(placeAnchor(low)).toEqual(placeAnchor(ekoway));
  });

  it('puts every pinned place within a short walk of the door', () => {
    const door = POINTS.lobbyDoor;
    const pinned = places().map((p) => [p.name, placeAnchor(p)] as const).filter(([, w]) => w);
    expect(pinned.map(([n]) => n)).toEqual(['Farley Sibu supermarket', 'Farley cafe.cafe', 'Secret Recipe', 'Farley Bakery', 'Klinik Komuniti Sentosa', 'Low Medical Clinic', 'Ekoway Hardware']);
    for (const [name, w] of pinned) expect(walkMinutes(Math.hypot(w!.x - door.x, w!.z - door.z)), name).toBeLessThan(6);
  });

  it('puts cafe.cafe on the hotel’s own ground floor, and the supermarket a few minutes away', () => {
    const [market, cafe] = places().slice(0, 2).map((p) => placeAnchor(p)!);
    const door = POINTS.lobbyDoor;
    const d = (w: { x: number; z: number }) => Math.hypot(w.x - door.x, w.z - door.z);
    expect(d(cafe)).toBeLessThan(20);
    expect(walkMinutes(d(market))).toBeGreaterThan(1.5);
    expect(walkMinutes(d(market))).toBeLessThan(6);
  });
});
