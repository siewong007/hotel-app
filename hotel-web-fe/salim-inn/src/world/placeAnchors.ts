// Where each neighbourhood place is, for its hotspot and walking label.
// neighbourhood.json carries no coordinates, so a place is anchored to the
// modelled cafe.cafe (it is on the hotel's own ground floor) or to the
// OpenStreetMap point (ODbL, already in data/site.json) whose name matches it.
// A place with no match still appears in the cards, just without a label.
import * as THREE from 'three';
import { site, type Poi } from '../data/site';
import { DIM } from '../config/dimensions';
import { salimLocal } from './layout';
import type { Place } from '../data/neighbourhood';

const STOP = new Set(['sibu', 'sdn', 'bhd', 'the', 'and', 'co', 'trading', 'older', 'frontage', 'services', 'service', 'parts', 'salim', 'lorong', 'jalan']);
/** Words that name a kind of shop, not a particular one. */
const GENERIC = new Set(['farley', 'pharmacy', 'cafe', 'bakery', 'supermarket', 'restaurant', 'clinic', 'klinik', 'centre', 'center', 'shop', 'food', 'court', 'mart', 'fresh', 'auto']);
const tokens = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t) => t.length > 1 && !STOP.has(t));

/** Search radius around the ring centre (the Farley block), metres. */
const NEAR = { x: 55, z: -52, r: 220 };

/** The OpenStreetMap point that matches a place's name. A distinctive word
 *  (not "farley", not a kind of shop) must match and at least half the words
 *  overall; a name made only of generic words must match word for word. */
export function matchPoi(name: string, pois: Poi[] = site.pois): Poi | null {
  const want = tokens(name);
  if (!want.length) return null;
  const distinctive = want.filter((t) => !GENERIC.has(t));
  let best: Poi | null = null;
  let bestScore = 0;
  for (const p of pois) {
    if (!p.n || Math.hypot(p.x - NEAR.x, p.z - NEAR.z) > NEAR.r) continue;
    const have = new Set(tokens(p.n));
    const score = want.filter((t) => have.has(t)).length / want.length;
    const ok = distinctive.length ? distinctive.some((t) => have.has(t)) && score >= 0.5 : score === 1;
    if (ok && score > bestScore) { best = p; bestScore = score; }
  }
  return best;
}

/** World position for a place's label, or null if it cannot be placed. */
export function placeAnchor(p: Place): THREE.Vector3 | null {
  if (/cafe\.cafe/i.test(p.name)) {
    const l = DIM.salim.cafeLetters;
    return salimLocal((l.x0 + l.x1) / 2, 6.2, 0.6); // just above its letters on the canopy
  }
  const poi = matchPoi(p.name);
  if (!poi) return null;
  const h = /supermarket/i.test(p.name) ? DIM.supermarket.height + 2.5 : 9;
  return new THREE.Vector3(poi.x, h, poi.z);
}
