// Room configurator (brief §3 ch. 6): five tabs, one per room type; a panel
// with beds, size, guests, extra bed and price; and "See the real room",
// which lays the owner's photo over the render in a frame matched to the
// camera. The camera eases to each type's photo-matched view (roomViews.ts);
// the room itself reconfigures in RoomBuilder.
import * as THREE from 'three';
import type { RoomBuilder } from '../interiors/RoomBuilder';
import { ROOM_ORDER, type RoomLayout } from '../interiors/roomLayouts';
import { BED_SIZE } from '../interiors/roomProps';
import { ROOM_VIEWS, type RoomView } from '../interiors/roomViews';
import { SHOW_PRICES, WEB_RATES, type RoomCode } from '../config/site';
import { copy, count, fill, roomName } from '../content';

const DUR = 0.85;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function bedsLine(l: RoomLayout): string {
  const c = copy.configurator;
  const beds = new Map<keyof typeof c.bed, number>();
  for (const b of l.beds) beds.set(b as keyof typeof c.bed, (beds.get(b as keyof typeof c.bed) ?? 0) + 1);
  return [...beds].map(([b, n]) => {
    const [w, len] = BED_SIZE[b];
    return fill(c.bedSize, { bed: count(c.bed[b], n), w: Math.round(w * 100), l: Math.round(len * 100) });
  }).join(c.bedJoin);
}

/** A room type's facts panel (shared with the fallback page's room picker). */
export function roomFactsHtml(l: RoomLayout): string {
  const c = copy.configurator;
  const facts: [string, string][] = [
    [c.beds, bedsLine(l)],
    [c.size, `${l.sizeSqm} m²${l.sizeFlag ? ' *' : ''}`],
    [c.sleeps, fill(c.upTo, { n: l.maxGuests })],
    [c.extraBed, l.extraBed ? fill(c.extraBedYes, { charge: l.extraBedCharge }) : c.extraBedNo],
  ];
  if (SHOW_PRICES) facts.push([c.from, fill(c.rate, { rate: WEB_RATES[l.code] })]);
  return `<dl class="cfg-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`
    + (l.window ? '' : `<p class="cfg-note">${c.noWindow}</p>`)
    + (l.sizeFlag ? `<p class="cfg-flag">* ${c.sizeFlag}.</p>` : '');
}

export class Configurator {
  private host: HTMLElement;
  private tabs: HTMLButtonElement[] = [];
  private panel: HTMLElement;
  private realBtn: HTMLButtonElement;
  private frame: HTMLElement;
  private img: HTMLImageElement;
  private caption: HTMLElement;
  private room: RoomBuilder;
  private from: RoomView;
  private to: RoomView;
  private t = 1;
  private real = false;
  active = false;
  /** Last type with a window (chapter 7 leaves through it). */
  lastWindowed: RoomCode;
  /** A visitor picked a type (tabs only — not the film's own switches). */
  onPick: ((code: RoomCode) => void) | null = null;
  private tmpPos = new THREE.Vector3();
  private tmpTgt = new THREE.Vector3();
  private tmpLocal = new THREE.Vector3();

  constructor(room: RoomBuilder, host: HTMLElement) {
    this.room = room;
    this.host = host;
    this.from = this.to = ROOM_VIEWS[room.code];
    this.lastWindowed = room.current.window ? room.code : 'DLX';

    const tablist = document.createElement('div');
    tablist.className = 'cfg-tabs';
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', copy.configurator.tabsAria);
    for (const code of ROOM_ORDER) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cfg-tab';
      b.id = `cfg-tab-${code}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', 'cfg-panel');
      b.textContent = roomName(code);
      b.addEventListener('click', () => this.pick(code));
      b.addEventListener('keydown', (e) => this.onKey(e, code));
      tablist.appendChild(b);
      this.tabs.push(b);
    }
    this.panel = document.createElement('div');
    this.panel.className = 'cfg-panel';
    this.panel.id = 'cfg-panel';
    this.panel.setAttribute('role', 'tabpanel');
    this.panel.setAttribute('aria-live', 'polite');
    this.realBtn = document.createElement('button');
    this.realBtn.type = 'button';
    this.realBtn.className = 'pill cfg-real';
    this.realBtn.setAttribute('aria-pressed', 'false');
    this.realBtn.textContent = copy.configurator.seeReal;
    this.realBtn.addEventListener('click', () => this.setReal(!this.real));
    host.append(tablist, this.panel, this.realBtn);

    // the photo frame: fixed over the canvas, placed where the camera draws the photo
    this.frame = document.createElement('div');
    this.frame.className = 'real-room';
    // its own labelled region: it sits outside the chapter's copy (it is fixed over the canvas)
    this.frame.setAttribute('role', 'region');
    this.frame.setAttribute('aria-label', copy.configurator.photoAria);
    this.img = document.createElement('img');
    this.img.decoding = 'async';
    this.caption = document.createElement('p');
    this.caption.className = 'real-room__caption';
    this.frame.append(this.img, this.caption);
    document.body.appendChild(this.frame);

    room.onChange = (code) => this.render(code);
    this.render(room.code);
  }

  private onKey(e: KeyboardEvent, code: RoomCode): void {
    const i = ROOM_ORDER.indexOf(code);
    let j = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % ROOM_ORDER.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i + ROOM_ORDER.length - 1) % ROOM_ORDER.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = ROOM_ORDER.length - 1;
    if (j < 0) return;
    e.preventDefault();
    this.pick(ROOM_ORDER[j]);
    this.tabs[j].focus();
  }

  private pick(code: RoomCode): void {
    this.select(code);
    this.onPick?.(code);
  }

  /** Switch without the transition (screenshots, reduced motion). */
  jump(code: RoomCode): void {
    this.room.select(code, true);
    this.from = this.to = ROOM_VIEWS[code];
    this.t = 1;
    if (this.room.current.window) this.lastWindowed = code;
    this.render(code);
  }

  select(code: RoomCode): void {
    if (code === this.room.code && !this.room.transitioning) return;
    const now = this.view();
    this.from = { ...now };
    this.to = ROOM_VIEWS[code];
    this.t = 0;
    this.room.select(code);
    if (this.room.current.window) this.lastWindowed = code;
    this.render(code);
  }

  private render(code: RoomCode): void {
    const l = this.room.layouts[code];
    this.tabs.forEach((b, i) => {
      const on = ROOM_ORDER[i] === code;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    this.panel.setAttribute('aria-labelledby', `cfg-tab-${code}`);
    this.panel.innerHTML = roomFactsHtml(l);
    const v = ROOM_VIEWS[code];
    if (v.photo) {
      this.img.src = v.photo;
      this.img.alt = `${copy.configurator.photo}: ${roomName(code)}`;
    }
    this.caption.textContent = `${copy.configurator.photo} · ${l.photoFlag ? copy.configurator.photoFlag : roomName(code)}`;
    this.realBtn.hidden = !v.photo;
  }

  setReal(on: boolean): void {
    this.real = on;
    this.realBtn.setAttribute('aria-pressed', String(on));
    this.realBtn.textContent = on ? copy.configurator.back3d : copy.configurator.seeReal;
    this.frame.classList.toggle('is-on', on && this.active);
  }

  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    if (!on) this.room.cutawayFor(null);
    this.host.classList.toggle('is-active', on);
    this.frame.classList.toggle('is-on', on && this.real);
    if (!on) this.tabs.forEach((b) => b.blur());
  }

  update(dt: number): void {
    if (this.t < 1) this.t = Math.min(1, this.t + dt / DUR);
    // the photo only makes sense once the camera has arrived
    this.frame.classList.toggle('is-moving', this.t < 1);
  }

  /** The current (interpolated) view, room-local. */
  view(): RoomView {
    if (this.t >= 1) return this.to;
    const e = ease(this.t);
    const lerp3 = (a: number[], b: number[]) => a.map((x, i) => THREE.MathUtils.lerp(x, b[i], e)) as [number, number, number];
    return {
      pos: lerp3(this.from.pos, this.to.pos),
      target: lerp3(this.from.target, this.to.target),
      vfov: THREE.MathUtils.lerp(this.from.vfov, this.to.vfov, e),
      aspect: THREE.MathUtils.lerp(this.from.aspect, this.to.aspect, e),
      roll: THREE.MathUtils.lerp(this.from.roll, this.to.roll, e),
      photo: this.to.photo,
    };
  }

  /** Where the photo frame sits on screen (CSS px): right of the copy column
   *  on landscape screens, above the bottom panel on portrait ones. */
  rect(W: number, H: number, aspect: number): { x: number; y: number; w: number; h: number } {
    if (W / H >= 1.1) {
      const top = 84, bottom = 40;
      let h = H - top - bottom;
      let w = h * aspect;
      const left = Math.max(W * 0.46, 560), right = W - 70;
      if (w > right - left) { w = right - left; h = w / aspect; }
      return { x: left + (right - left - w) / 2, y: top + (H - top - bottom - h) / 2, w, h };
    }
    const top = 72, maxH = H * 0.5;
    let w = W - 32;
    let h = w / aspect;
    if (h > maxH) { h = maxH; w = h * aspect; }
    return { x: (W - w) / 2, y: top, w, h };
  }

  /** World-space view for the camera rig, and the photo frame's placement. */
  worldView(roomGroup: THREE.Object3D, W: number, H: number): { pos: THREE.Vector3; target: THREE.Vector3; rect: { x: number; y: number; w: number; h: number }; vfov: number; roll: number } {
    const v = this.view();
    this.room.cutawayFor(this.tmpLocal.set(...v.pos));
    roomGroup.updateMatrixWorld(true);
    const pos = this.tmpPos.set(...v.pos).applyMatrix4(roomGroup.matrixWorld);
    const target = this.tmpTgt.set(...v.target).applyMatrix4(roomGroup.matrixWorld);
    const rect = this.rect(W, H, v.aspect);
    const s = this.frame.style;
    s.left = `${rect.x}px`;
    s.top = `${rect.y}px`;
    s.width = `${rect.w}px`;
    s.height = `${rect.h}px`;
    return { pos, target, rect, vfov: v.vfov, roll: v.roll };
  }
}
