// Chapter sections (real DOM copy, in reading order), the chapter dots, and
// the scroll geometry that maps page scroll to the master timeline.
import { en } from '../content/en';
import { CHAPTERS, type ChapterDef } from '../experience/Timeline';
import { SITE, SHOW_PRICES, WEB_RATES } from '../config/site';

const LABELS: Record<number, string> = { 1: 'Farley', 2: 'Neighbourhood', 3: 'Salim Inn', 4: 'Arrival', 5: 'Reception', 6: 'Rooms', 7: 'Footsteps', 8: 'Book' };

export class Chapters {
  readonly sections: HTMLElement[] = [];
  readonly dots: HTMLButtonElement[] = [];
  private story = document.getElementById('story')!;
  /** Scrollable length of the film in px (story height − one viewport). */
  scrollLength = 1;
  onJump: ((p: number) => void) | null = null;
  private active = -1;

  constructor() {
    for (const def of CHAPTERS) {
      const copy = en.chapters.find((c) => c.id === def.id)!;
      const sec = document.createElement('section');
      sec.className = `chapter chapter--${def.key}`;
      sec.id = `chapter-${def.id}`;
      sec.dataset.chapter = String(def.id);
      sec.setAttribute('aria-labelledby', `chapter-${def.id}-title`);
      const tag = def.id === 1 ? 'h1' : 'h2';
      const inner = document.createElement('div');
      inner.className = 'chapter__copy';
      inner.innerHTML = `
        <p class="eyebrow line">${copy.eyebrow}</p>
        <${tag} class="line" id="chapter-${def.id}-title">${copy.title}</${tag}>
        <p class="chapter__body line">${copy.body}</p>`;
      if (def.id === 8) {
        inner.insertAdjacentHTML(
          'beforeend',
          `<div class="booking-card line" id="book">
            <p>Choose your dates and room on the Salim Inn booking portal. Check-in from ${SITE.checkIn.label}, check-out by ${SITE.checkOut.label}.</p>
            <a class="pill pill--gold" href="${SITE.bookingUrl}" target="_top">Book direct</a>
            <a class="pill" href="tel:${SITE.phoneE164}">Call ${SITE.phoneDisplay}</a>
          </div>`,
        );
      }
      sec.appendChild(inner);
      this.story.appendChild(sec);
      this.sections.push(sec);
    }

    const ol = document.getElementById('chapter-dots')!;
    for (const def of CHAPTERS) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chapter-dot';
      b.innerHTML = `<span class="chapter-dot__label">${String(def.id).padStart(2, '0')} · ${LABELS[def.id]}</span><span class="chapter-dot__pip"></span>`;
      b.setAttribute('aria-label', `Chapter ${def.id}: ${LABELS[def.id]}`);
      b.addEventListener('click', () => this.onJump?.(def.p0 + (def.p1 - def.p0) * (def.id === 1 ? 0 : 0.02)));
      li.appendChild(b);
      ol.appendChild(li);
      this.dots.push(b);
    }

    const footer = document.querySelector('.footer-address')!;
    footer.textContent = `${SITE.name} · ${SITE.address.line1}, ${SITE.address.line2}, ${SITE.address.postcode} ${SITE.address.city}, ${SITE.address.state} · ${SITE.phoneDisplay}`;
    document.querySelector('.footer-osm')!.textContent = en.footer.osm;
    const rate = document.querySelector('.mobile-cta__rate')!;
    rate.innerHTML = SHOW_PRICES ? `from <strong>RM${Math.min(...Object.values(WEB_RATES))}</strong> / night` : 'Book direct';
    this.layout();
  }

  /** Film length: ~15 screens on desktop, ~13 on phones. */
  layout(): void {
    const vh = window.innerHeight;
    const screens = window.innerWidth < 760 ? 13 : 15;
    this.scrollLength = Math.round(vh * screens);
    CHAPTERS.forEach((def: ChapterDef, i) => {
      const h = (def.p1 - def.p0) * this.scrollLength + (i === CHAPTERS.length - 1 ? vh : 0);
      this.sections[i].style.height = `${Math.round(h)}px`;
    });
  }

  setActive(id: number): void {
    if (id === this.active) return;
    this.active = id;
    this.sections.forEach((s) => s.classList.toggle('is-active', Number(s.dataset.chapter) === id));
    this.dots.forEach((d, i) => {
      if (CHAPTERS[i].id === id) d.setAttribute('aria-current', 'step');
      else d.removeAttribute('aria-current');
    });
  }

  get storyTop(): number {
    return this.story.getBoundingClientRect().top + window.scrollY;
  }

  /** Height of the whole film in px (the page's own sections follow it). */
  get storyHeight(): number {
    return this.story.offsetHeight;
  }
}
