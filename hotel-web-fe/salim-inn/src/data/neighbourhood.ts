// The neighbourhood (brief §3 ch. 2 and 7): places around Farley from
// neighbourhood.json. Only confirmed entries reach the page — the file's
// own rule is that anything marked verify_before_launch must be checked on
// site or with the owner first — so the chapter copy, the hotspot cards and
// the walking labels are all built from what is confirmed, and grow as the
// owner clears entries. `?debug=1&places=all` previews the rest, badged.
import raw from './neighbourhood.json';

export type PlaceGroup = 'groceries' | 'food' | 'health' | 'services';

/** The words the neighbourhood's generated copy is built from, one set per
 *  language (content/*.ts): chapter 2's title and the walking labels. */
export interface NeighbourhoodWords {
  /** Chapter 2's title: `{{list}}` is the categories shown, joined. */
  title: string;
  titleEmpty: string;
  /** Between the listed categories, and before the last. */
  listComma: string;
  listAnd: string;
  phrases: {
    supermarket: string;
    groceries: string;
    cafeDownstairs: string;
    cafesBakeriesEat: string;
    bakeries: string;
    cafesEat: string;
    cafe: string;
    pharmaciesClinic: string;
    pharmacy: string;
    services: string;
  };
  /** The hotel's own published time, `{{min}}`. */
  walkStated: string;
  /** The estimate, `{{min}}`. */
  walkApprox: string;
  nextDoor: string;
}

const withMin = (template: string, min: number) => template.replace('{{min}}', String(min));

/** The brief's four hotspot categories, in display order (labels: the
 *  English defaults; the page shows content's `neighbourhood.groups`). */
export const GROUPS: { key: PlaceGroup; label: string }[] = [
  { key: 'groceries', label: 'Groceries' },
  { key: 'food', label: 'Food & cafés' },
  { key: 'health', label: 'Pharmacies & clinic' },
  { key: 'services', label: 'Everyday services' },
];

const GROUP_OF: Record<string, PlaceGroup> = {
  'Groceries & daily needs': 'groceries',
  Cafe: 'food',
  Food: 'food',
  Bakery: 'food',
  'Pharmacy & health': 'health',
  'Everyday services': 'services',
  Shopping: 'services',
};

export interface Place {
  name: string; // as displayed ("Farley Sibu supermarket")
  category: string;
  group: PlaceGroup;
  detail?: string; // role or note from the file
  hours?: string;
  phone?: string;
  address?: string;
  /** A walking time the hotel itself publishes (minutes), if any. */
  walkStated?: number;
  verified: boolean;
}

interface RawPlace {
  name: string;
  category: string;
  role?: string;
  note?: string;
  hours?: string;
  phone?: string;
  address?: string;
  walk_note?: string;
  verify_before_launch: boolean;
}

/** "Farley Sibu (supermarket)" → "Farley Sibu supermarket". */
export function displayName(name: string): string {
  return name.replace(/\s*\(([^)]+)\)\s*$/, ' $1').trim();
}

function fromRaw(p: RawPlace): Place | null {
  const group = GROUP_OF[p.category];
  if (!group) return null;
  const stated = p.walk_note?.match(/(\d+)-minute walk/);
  return {
    name: displayName(p.name),
    category: p.category,
    group,
    detail: p.role ?? p.note,
    hours: p.hours?.replace(/\s*\(per [^)]*\)/, ''),
    phone: p.phone,
    address: p.address,
    walkStated: stated ? Number(stated[1]) : undefined,
    verified: !p.verify_before_launch,
  };
}

/** Places for the page: confirmed only, unless the owner preview asks for all. */
export function places(opts: { includeUnverified?: boolean } = {}): Place[] {
  return (raw.places as RawPlace[])
    .map(fromRaw)
    .filter((p): p is Place => p !== null && (p.verified || !!opts.includeUnverified));
}

/** The hotspot categories that have at least one place to show. */
export function groupsWith(list: Place[]): { key: PlaceGroup; label: string; places: Place[] }[] {
  return GROUPS.map((g) => ({ ...g, places: list.filter((p) => p.group === g.key) })).filter((g) => g.places.length > 0);
}

// ---------------------------------------------------------------- walking time
/** Brief §3 ch. 7: straight-line distance × 1.3 for the street grid, walked at 80 m a minute. */
export const WALK = { detour: 1.3, metresPerMinute: 80 } as const;

export function walkMinutes(straightMetres: number): number {
  return (straightMetres * WALK.detour) / WALK.metresPerMinute;
}

/** Radius (straight-line metres) of a walking-time ring. */
export function ringRadius(minutes: number): number {
  return (minutes * WALK.metresPerMinute) / WALK.detour;
}

/** The walking label for a place: the hotel's own published time where it
 *  has one (so the page never contradicts itself), otherwise the estimate. */
export function walkLabel(p: Pick<Place, 'walkStated'>, straightMetres: number, w: NeighbourhoodWords): string {
  if (p.walkStated) return withMin(w.walkStated, p.walkStated);
  const m = walkMinutes(straightMetres);
  if (m < 1) return w.nextDoor;
  return withMin(w.walkApprox, Math.round(m));
}

// ---------------------------------------------------------------- copy
type Phrase = keyof NeighbourhoodWords['phrases'];
const PHRASE: Record<PlaceGroup, (list: Place[]) => Phrase> = {
  groceries: (l) => (l.some((p) => /supermarket/i.test(p.name)) ? 'supermarket' : 'groceries'),
  food: (l) => {
    const bakery = l.some((p) => p.category === 'Bakery');
    const eat = l.filter((p) => p.category !== 'Bakery');
    if (eat.length === 1 && /cafe\.cafe/i.test(eat[0].name) && !bakery) return 'cafeDownstairs';
    return bakery && eat.length ? 'cafesBakeriesEat' : bakery ? 'bakeries' : eat.length > 1 ? 'cafesEat' : 'cafe';
  },
  health: (l) => (l.length > 1 ? 'pharmaciesClinic' : 'pharmacy'),
  services: () => 'services',
};

function sentenceList(parts: string[], w: NeighbourhoodWords): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(w.listComma)}${w.listAnd}${parts[parts.length - 1]}`;
}

/** Chapter 2's title, from the categories actually shown, in `w`'s language. */
export function neighbourhoodTitle(list: Place[], w: NeighbourhoodWords): string {
  const parts = groupsWith(list).map((g) => w.phrases[PHRASE[g.key](g.places)]);
  if (!parts.length) return w.titleEmpty;
  const s = sentenceList(parts, w);
  return w.title.replace('{{list}}', `${s.charAt(0).toUpperCase()}${s.slice(1)}`);
}
