// The neighbourhood on screen (brief §3 ch. 2 and 7).
//   Chapter 2 — a chip per hotspot category in the copy (buttons, in reading
//   order) opens a card listing its confirmed places; the same categories
//   float over the buildings as markers that open the same card.
//   Chapter 7 — "Getting here" chips and each place's walking time in the
//   copy; floating labels on the places and on the walking rings.
//   Both — the hotel's own marker (its brand mark and name) over the hotel,
//   placed first so the others give way to it.
// Everything a marker or label says is also in the copy, so the floating
// layer is aria-hidden and pointer-only. A category's marker carries its icon;
// while its card is open the other markers step back.
import * as THREE from 'three';
import { groupsWith, openingText, walkLabel, type Dish, type Place, type PlaceGroup } from '../data/neighbourhood';
import { RING_MINUTES } from '../world/WalkRings';
import { copy, count, fill } from '../content';

interface Placed { place: Place; world: THREE.Vector3 | null; walk: string }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// 24 px line icons for the category markers, drawn, not fetched
const ICONS: Record<PlaceGroup, string> = {
  groceries: '<path d="M4 9.5h16l-1.6 9.5H5.6z"/><path d="M8.5 9.5 11 4.5M15.5 9.5 13 4.5"/>',
  food: '<path d="M5 10h11v3.5a5.5 5.5 0 0 1-5.5 5.5A5.5 5.5 0 0 1 5 13.5z"/><path d="M16 11.2h1.3a2.4 2.4 0 0 1 0 4.8h-1.7"/><path d="M8.5 4.5V7M12 4.5V7"/>',
  health: '<path d="M10 4.5h4V10h5.5v4H14v5.5h-4V14H4.5v-4H10z"/>',
  services: '<path d="M15 4.6a4.2 4.2 0 0 0-5.2 5.3l-5.3 5.3 2.8 2.8 5.3-5.3a4.2 4.2 0 0 0 5.3-5.2l-2.6 2.6-2.4-.6-.6-2.4z"/>',
};
const icon = (paths: string) => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
/** The brand mark's house and S (index.html's logo), for the hotel's pin. */
const BRAND_MARK = '<svg viewBox="4 3 64 78" width="18" height="22" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 26 36 7l28 19"/><path d="M19 23v54h36V23M36 7v70"/><path d="M26 43c0-9 20-9 20 0s-20 8-20 17 20 9 20 0"/><path d="M12 76h48"/></svg>';

type Box = { x0: number; x1: number; y0: number; y1: number };
const overlaps = (a: Box, list: Box[]) => list.some((b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1);
const telOf = (phone: string) => `+60${phone.replace(/\D/g, '').replace(/^0/, '')}`;

export interface NeighbourhoodHosts { ch2: HTMLElement; ch7: HTMLElement; ch2Title?: HTMLElement | null }

/** Where things are: `door` measures the walks, `hotel` (over the roof) holds
 *  the hotel's marker. */
export interface NeighbourhoodGeo { door: THREE.Vector3; hotel?: THREE.Vector3; anchorOf: (p: Place) => THREE.Vector3 | null; titleFor?: (list: Place[]) => string }

export class Neighbourhood {
  private placed: Placed[];
  private groups: { key: PlaceGroup; label: string; places: Placed[]; world: THREE.Vector3 | null }[];
  private chips = new Map<PlaceGroup, HTMLButtonElement>();
  private markers = new Map<PlaceGroup, HTMLElement>();
  private card: HTMLElement;
  private layer: HTMLElement;
  private placeLabels: { el: HTMLElement; world: THREE.Vector3 }[] = [];
  private ringLabels: HTMLElement[] = [];
  private hotel: { el: HTMLElement; world: THREE.Vector3; size?: { w: number; h: number } } | null = null;
  private open: PlaceGroup | null = null;
  private v = new THREE.Vector3();
  private widths = new WeakMap<HTMLElement, number>();
  private menu: Dish[];
  /** Top of chapter 2's copy on a phone (markers stay above it): measured
   *  when the layout changes, never per frame. */
  private copyTop = Infinity;
  private copyStale = true;

  /** `menu`: the must-try dishes, listed under the food card's places. */
  constructor(list: Place[], hosts: NeighbourhoodHosts, geo: NeighbourhoodGeo, menu: Dish[] = []) {
    this.menu = menu;
    const c = copy.neighbourhood;
    this.placed = list.map((place) => {
      const world = geo.anchorOf(place);
      const d = world ? Math.hypot(world.x - geo.door.x, world.z - geo.door.z) : NaN;
      return { place, world, walk: world || place.walkStated ? walkLabel(place, d, c) : '' };
    });
    this.groups = groupsWith(list).map((g) => {
      const ps = this.placed.filter((x) => x.place.group === g.key);
      const at = ps.map((x) => x.world).filter((w): w is THREE.Vector3 => !!w);
      const world = at.length ? at.reduce((s, w) => s.add(w), new THREE.Vector3()).divideScalar(at.length) : null;
      if (world) world.y = Math.max(...at.map((w) => w.y));
      return { key: g.key, label: c.groups[g.key], places: ps, world };
    });
    if (hosts.ch2Title && geo.titleFor) hosts.ch2Title.textContent = geo.titleFor(list);

    // ---------------------------------------------------------------- chapter 2 copy: chips + card
    hosts.ch2.innerHTML = `
      <div class="nb-chips" role="group" aria-label="${c.chipsLabel}">
        ${this.groups.map((g) => `<button type="button" class="nb-chip" data-group="${g.key}" aria-expanded="false" aria-controls="nb-card">${esc(g.label)} <span>${count([c.placeOne, c.placeMany], g.places.length)}</span></button>`).join('')}
      </div>
      <div class="nb-card" id="nb-card" role="region" aria-live="polite" aria-labelledby="nb-card-title" tabindex="0" data-lenis-prevent hidden></div>`;
    this.card = hosts.ch2.querySelector('.nb-card')!;
    hosts.ch2.querySelectorAll<HTMLButtonElement>('.nb-chip').forEach((b) => {
      const key = b.dataset.group as PlaceGroup;
      this.chips.set(key, b);
      b.addEventListener('click', () => this.toggle(key));
    });
    hosts.ch2.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.open) { const k = this.open; this.toggle(k); this.chips.get(k)?.focus(); } });
    window.addEventListener('resize', () => { this.fitCard(); this.copyStale = true; });

    // ---------------------------------------------------------------- chapter 7 copy: getting here + walking times
    const walkers = this.placed.filter((x) => x.walk);
    hosts.ch7.innerHTML = `
      ${walkers.length ? `<p class="nb-sub">${c.walkLabel}</p><ul class="nb-walk">${walkers.map((x) => `<li><strong>${esc(x.place.name)}</strong> <span>${x.walk}</span>${x.place.verified ? '' : ` <em class="nb-badge">${c.unverified}</em>`}</li>`).join('')}</ul>` : ''}
      <p class="nb-sub">${c.gettingHere}</p>
      <ul class="nb-getting"><li>${c.airport}</li><li>${c.city}</li></ul>`;

    // ---------------------------------------------------------------- floating layer (pointer-only)
    this.layer = document.createElement('div');
    this.layer.className = 'nb-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    if (geo.hotel) {
      // label above, pin below, its tip on the point
      const el = document.createElement('div');
      el.className = 'nb-hotel';
      el.innerHTML = `<div class="nb-hotel__in"><span class="nb-hotel__label">${esc(c.hotel)}</span><span class="nb-hotel__pin">${BRAND_MARK}</span></div>`;
      this.layer.appendChild(el);
      this.hotel = { el, world: geo.hotel.clone() };
    }
    for (const g of this.groups) {
      if (!g.world) continue;
      const m = document.createElement('button');
      m.type = 'button';
      m.tabIndex = -1;
      m.className = 'nb-marker';
      m.dataset.group = g.key;
      m.innerHTML = `<span class="nb-marker__dot">${icon(ICONS[g.key])}</span><span class="nb-marker__label">${esc(g.label)}</span>`;
      m.addEventListener('click', () => this.toggle(g.key));
      this.layer.appendChild(m);
      this.markers.set(g.key, m);
    }
    for (const x of walkers) {
      if (!x.world) continue;
      const el = document.createElement('div');
      el.className = 'nb-label';
      el.innerHTML = `<strong>${esc(x.place.name)}</strong><span>${x.walk}</span>`;
      this.layer.appendChild(el);
      this.placeLabels.push({ el, world: x.world });
    }
    for (const m of RING_MINUTES) {
      const el = document.createElement('div');
      el.className = 'nb-ring';
      el.textContent = fill(c.ring, { min: m });
      this.layer.appendChild(el);
      this.ringLabels.push(el);
    }
    document.body.appendChild(this.layer);
  }

  private toggle(key: PlaceGroup): void {
    this.open = this.open === key ? null : key;
    const c = copy.neighbourhood;
    for (const [k, b] of this.chips) b.setAttribute('aria-expanded', String(k === this.open));
    for (const [k, m] of this.markers) m.classList.toggle('is-open', k === this.open);
    this.layer.classList.toggle('has-open', this.open !== null);
    const g = this.groups.find((x) => x.key === this.open);
    this.card.hidden = !g;
    this.copyStale = true;
    if (!g) return;
    const badge = (verified: boolean) => (verified ? '' : ` <em class="nb-badge">${c.unverified}</em>`);
    const hoursOf = (p: Place) => (p.opening ? openingText(p.opening, c, copy.booking.dateLocale) : p.hours);
    // the must-try dishes lead the food card (they are its draw), then its places
    const dishes = g.key === 'food' && this.menu.length ? `
      <h4 class="nb-card__sub">${esc(c.mustTry.title)}</h4>
      <ul class="nb-dishes">${this.menu.map((d) => `
        <li><strong>${esc(c.mustTry.dishes[d.key].name)}</strong>${badge(d.verified)}<span>${esc(c.mustTry.dishes[d.key].note)}</span></li>`).join('')}
      </ul>` : '';
    this.card.scrollTop = 0;
    this.card.innerHTML = `<h3 class="nb-card__title" id="nb-card-title">${esc(g.label)}</h3>${dishes}<ul${dishes ? ' class="nb-places"' : ''}>${g.places.map(({ place: p, walk }) => `
      <li>
        <strong>${esc(p.name)}</strong>${badge(p.verified)}
        ${p.kind ? `<span>${esc(c.kinds[p.kind])}</span>` : p.detail ? `<span>${esc(p.detail)}</span>` : ''}
        ${[walk, hoursOf(p) ? `${c.open} ${esc(hoursOf(p)!)}` : '', p.phone ? `<a href="tel:${telOf(p.phone)}">${c.call} ${esc(p.phone)}</a>` : ''].filter(Boolean).map((t) => `<span class="nb-meta">${t}</span>`).join('')}
      </li>`).join('')}</ul>`;
    this.fitCard();
  }

  private measureCopy(): void {
    this.copyStale = false;
    const col = this.card.closest<HTMLElement>('.chapter__copy');
    const tops = col ? [...col.children].map((c) => c.getBoundingClientRect()).filter((r) => r.height > 0).map((r) => r.top) : [];
    this.copyTop = tops.length ? Math.min(...tops) : Infinity;
  }

  /** The open card takes the room the copy column has left, and scrolls on
   *  its own past that: the food card with its dishes outgrew the screen, and
   *  the centred column then ran off its top. */
  private fitCard(): void {
    if (this.card.hidden) return;
    const col = this.card.closest<HTMLElement>('.chapter__copy');
    this.card.style.maxHeight = '';
    if (!col) return;
    // measured from the content itself: a bottom-aligned column (phones)
    // overflows off its top, which scrollHeight never sees
    const cs = getComputedStyle(col);
    const room = col.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const boxes = [...col.children].map((c) => c.getBoundingClientRect()).filter((r) => r.height > 0);
    const used = Math.max(...boxes.map((r) => r.bottom)) - Math.min(...boxes.map((r) => r.top));
    const over = used - room;
    if (over > 0) this.card.style.maxHeight = `${Math.max(160, this.card.offsetHeight - over - 4)}px`;
  }

  /** The hotel's marker, centred over its point with the pin's tip on it;
   *  its box, or null when it is not on screen. */
  private placeHotel(camera: THREE.PerspectiveCamera, a: number, W: number, H: number, top: number, bottom: number, left: number): Box | null {
    const h = this.hotel;
    if (!h) return null;
    const el = h.el;
    if (a < 0.01) { el.style.opacity = '0'; el.style.visibility = 'hidden'; return null; }
    this.v.copy(h.world).project(camera);
    const x = ((this.v.x + 1) / 2) * W, y = ((1 - this.v.y) / 2) * H;
    const inner = el.firstElementChild as HTMLElement;
    const size = h.size ?? (h.size = { w: inner.offsetWidth, h: inner.offsetHeight }); // measured once: no layout per frame
    const box = { x0: x - size.w / 2, x1: x + size.w / 2, y0: y - size.h, y1: y };
    const on = this.v.z < 1 && box.x0 > left && box.x1 < W - 8 && box.y0 > top && y < bottom;
    el.style.visibility = on ? 'visible' : 'hidden';
    if (!on) return null;
    el.style.opacity = a.toFixed(3);
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    return box;
  }

  /** Project the markers and labels; chapter windows decide what shows. */
  update(camera: THREE.PerspectiveCamera, p: number, W: number, H: number, rings: { centre: THREE.Vector3; radii: readonly number[]; look: THREE.Vector3 }): void {
    const ch2 = THREE.MathUtils.smoothstep(p, 0.15, 0.18) * (1 - THREE.MathUtils.smoothstep(p, 0.325, 0.345));
    const ch7 = THREE.MathUtils.smoothstep(p, 0.915, 0.93) * (1 - THREE.MathUtils.smoothstep(p, 0.95, 0.956));
    this.layer.classList.toggle('is-live', ch2 > 0.01 || ch7 > 0.01);
    // keep clear of the top bar and of the copy: the lower part of a phone,
    // the left column on wider screens
    const phone = W < 760;
    const top = phone ? 120 : 110;
    const bottom = phone ? H * 0.52 : H - 40;
    // (on a phone the dot must be on screen: a label whose dot is not points nowhere)
    const left = phone ? 6 : Math.min(640, W * 0.54) * 0.92;
    const put = (el: HTMLElement, w: THREE.Vector3, a: number, below = bottom): { x: number; y: number; width: number } | null => {
      if (a < 0.01) { el.style.opacity = '0'; el.style.visibility = 'hidden'; return null; }
      this.v.copy(w).project(camera);
      const x = ((this.v.x + 1) / 2) * W, y = ((1 - this.v.y) / 2) * H;
      const on = this.v.z < 1 && x > left && x < W + 40 && y > top && y < below;
      el.style.visibility = on ? 'visible' : 'hidden';
      if (!on) return null;
      el.style.opacity = a.toFixed(3);
      // a label that would run off the right edge slides back in (its dot stays put)
      let width = this.widths.get(el);
      if (width === undefined) this.widths.set(el, (width = el.offsetWidth)); // measured once: no layout per frame
      const shift = Math.min(0, W - 12 - (x + width));
      el.style.setProperty('--shift', `${shift.toFixed(1)}px`);
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      return { x: x + shift, y, width };
    };
    // phones: the markers stay above the copy, and step aside while a card
    // is open (it fills the screen); a marker that would cover one placed
    // before it stays hidden (its chip is in the copy)
    if (phone && ch2 > 0.01 && this.copyStale) this.measureCopy();
    const markerBottom = phone ? Math.min(bottom, this.copyTop - 12) : bottom;
    // the hotel first, in both chapters: whatever would cover it gives way
    const hotelBox = this.placeHotel(camera, phone && this.open ? 0 : Math.max(ch2, ch7), W, H, top, ch2 >= ch7 ? markerBottom : bottom, left);
    const taken: Box[] = hotelBox ? [hotelBox] : [];
    for (const g of this.groups) {
      const m = this.markers.get(g.key);
      if (!m || !g.world) continue;
      const at = put(m, g.world, phone && this.open ? 0 : ch2, markerBottom);
      if (!at) continue;
      const box = { x0: at.x - 13, x1: at.x + at.width, y0: at.y - 18, y1: at.y + 18 };
      if (overlaps(box, taken)) m.style.visibility = 'hidden';
      else taken.push(box);
    }
    // chapter 7's labels: one that would cover a label placed before it stays
    // hidden (a clinic shares the hardware shop's point; the list has both)
    const labelled: Box[] = hotelBox ? [hotelBox] : [];
    for (const l of this.placeLabels) {
      const at = put(l.el, l.world, ch7);
      if (!at) continue;
      const box = { x0: at.x, x1: at.x + at.width, y0: at.y - 24, y1: at.y + 24 };
      if (overlaps(box, labelled)) l.el.style.visibility = 'hidden';
      else labelled.push(box);
    }
    // ring labels sit on each ring, on the side facing the view
    const dx = rings.look.x - rings.centre.x, dz = rings.look.z - rings.centre.z;
    const len = Math.hypot(dx, dz) || 1;
    this.ringLabels.forEach((el, i) => {
      const r = rings.radii[i];
      put(el, new THREE.Vector3(rings.centre.x + (dx / len) * r, 1, rings.centre.z + (dz / len) * r), r > 5 ? ch7 : 0);
    });
    if (ch2 < 0.01 && this.open) this.toggle(this.open); // close the card when chapter 2 ends
  }
}
