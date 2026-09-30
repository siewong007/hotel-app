// The still version of the page (brief §9): for browsers without WebGL 2, a
// blocklisted GPU or a low-memory device — and on ?fallback=1. The same
// chapters and copy in reading order, each over its settled frame rendered as
// a poster; the owner's photos stand in for the 3D rooms; the same
// neighbourhood cards and the same booking panel. Nothing here needs WebGL.
import { CHAPTERS } from '../experience/Timeline';
import { ROOM_ORDER, roomLayouts } from '../interiors/roomLayouts';
import { ROOM_VIEWS } from '../interiors/roomViews';
import { roomFactsHtml } from './Configurator';
import { copy, roomName } from '../content';
import type { Chapters } from './Chapters';
import type { RoomCode } from '../config/site';

/** Each chapter's settled frame, rendered at the film's two layouts without
 *  the UI (perf/posters.ts): ch{n}-wide.jpg 1440×900, ch{n}-tall.jpg 780×1688. */
export const POSTER_DIR = '/salim-inn/posters';

export function startFallback(chapters: Chapters, onPick: (code: RoomCode) => void): void {
  const root = document.documentElement;
  root.classList.add('is-fallback');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  chapters.sections.forEach((sec, i) => {
    const id = CHAPTERS[i].id;
    sec.style.height = '';
    sec.classList.add('is-active');
    const fig = document.createElement('figure');
    fig.className = 'fb-poster';
    fig.innerHTML = `<picture><source media="(max-width: 760px)" srcset="${POSTER_DIR}/ch${id}-tall.jpg"><img src="${POSTER_DIR}/ch${id}-wide.jpg" alt="${copy.fallback.alts[id - 1]}" loading="${id === 1 ? 'eager' : 'lazy'}" decoding="async"></picture>`;
    sec.prepend(fig);
  });
  const note = document.createElement('p');
  note.className = 'fb-note';
  note.textContent = copy.fallback.note;
  chapters.sections[0]?.querySelector('.chapter__copy')?.appendChild(note);

  // chapter dots scroll to their section; the section in view is the active one
  chapters.onJump = (p) => {
    const i = CHAPTERS.findIndex((c) => p >= c.p0 && p < c.p1 + 1e-6);
    chapters.sections[i]?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) chapters.setActive(Number((e.target as HTMLElement).dataset.chapter));
  }, { rootMargin: '-45% 0px -45% 0px' });
  chapters.sections.forEach((s) => io.observe(s));

  // chapter 6: the owner's photos stand in for the 3D rooms
  const host = document.getElementById('configurator');
  if (host) roomPicker(host, onPick);
}

function roomPicker(host: HTMLElement, onPick: (code: RoomCode) => void): void {
  const layouts = roomLayouts();
  host.classList.add('is-active');
  host.innerHTML = `
    <div class="cfg-tabs" role="tablist" aria-label="${copy.configurator.tabsAria}">${ROOM_ORDER.map((c) => `<button type="button" class="cfg-tab" role="tab" id="fb-tab-${c}" aria-controls="fb-room">${roomName(c)}</button>`).join('')}</div>
    <div class="fb-room" id="fb-room" role="tabpanel">
      <figure class="fb-room__photo"><img alt="" decoding="async"><figcaption></figcaption></figure>
      <div class="cfg-panel"></div>
    </div>`;
  const tabs = [...host.querySelectorAll<HTMLButtonElement>('.cfg-tab')];
  const img = host.querySelector('img')!;
  const cap = host.querySelector('figcaption')!;
  const panel = host.querySelector('.cfg-panel')!;
  const room = host.querySelector('.fb-room')!;
  const show = (code: RoomCode, user: boolean) => {
    const l = layouts[code];
    tabs.forEach((b, i) => {
      const on = ROOM_ORDER[i] === code;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    room.setAttribute('aria-labelledby', `fb-tab-${code}`);
    const photo = ROOM_VIEWS[code].photo;
    if (photo) img.src = photo;
    img.alt = `${copy.configurator.photo}: ${roomName(code)}`;
    cap.textContent = `${copy.configurator.photo} · ${l.photoFlag ? copy.configurator.photoFlag : roomName(code)}`;
    panel.innerHTML = roomFactsHtml(l);
    if (user) onPick(code);
  };
  tabs.forEach((b, i) => {
    b.addEventListener('click', () => show(ROOM_ORDER[i], true));
    b.addEventListener('keydown', (e) => {
      const n = ROOM_ORDER.length;
      const j = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % n : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
      if (j < 0) return;
      e.preventDefault();
      show(ROOM_ORDER[j], true);
      tabs[j].focus();
    });
  });
  show('DLX', false);
}
