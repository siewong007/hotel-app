// Chapter sections (real DOM copy, in reading order), the chapter dots, and
// the scroll geometry that maps page scroll to the master timeline.
import { copy, fill } from '../content';
import { CHAPTERS, type ChapterDef } from '../experience/Timeline';
import { SITE, WEB_RATES } from '../config/site';

const minRate = Math.min(...Object.values(WEB_RATES));

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
      const chapter = copy.chapters.find((c) => c.id === def.id)!;
      const sec = document.createElement('section');
      sec.className = `chapter chapter--${def.key}`;
      sec.id = `chapter-${def.id}`;
      sec.dataset.chapter = String(def.id);
      sec.setAttribute('aria-labelledby', `chapter-${def.id}-title`);
      const tag = def.id === 1 ? 'h1' : 'h2';
      const inner = document.createElement('div');
      inner.className = 'chapter__copy';
      inner.innerHTML = `
        <p class="eyebrow line">${chapter.eyebrow}</p>
        <${tag} class="line" id="chapter-${def.id}-title">${chapter.title}</${tag}>
        <p class="chapter__body line">${chapter.body}</p>`;
      if (def.id === 8) {
        inner.insertAdjacentHTML(
          'beforeend',
          `<div class="booking-card line" id="book">
            <p>${copy.bookingCard.blurb}</p>
            <a class="pill pill--gold" href="${SITE.bookingUrl}" target="_top">${copy.bookingCard.book}</a>
            <a class="pill" href="tel:${SITE.phoneE164}">${fill(copy.bookingCard.call, { phone: SITE.phoneDisplay })}</a>
          </div>`,
        );
      }
      sec.appendChild(inner);
      this.story.appendChild(sec);
      this.sections.push(sec);
    }

    const ol = document.getElementById('chapter-dots')!;
    for (const def of CHAPTERS) {
      const label = copy.chapterNav.labels[def.id - 1];
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chapter-dot';
      b.innerHTML = `<span class="chapter-dot__label">${String(def.id).padStart(2, '0')} · ${label}</span><span class="chapter-dot__pip"></span>`;
      b.setAttribute('aria-label', fill(copy.chapterNav.aria, { id: def.id, label }));
      b.addEventListener('click', () => this.onJump?.(def.p0 + (def.p1 - def.p0) * (def.id === 1 ? 0 : 0.02)));
      li.appendChild(b);
      ol.appendChild(li);
      this.dots.push(b);
    }

    const footer = document.querySelector('.footer-address')!;
    footer.textContent = `${SITE.name} · ${SITE.address.line1}, ${SITE.address.line2}, ${SITE.address.postcode} ${SITE.address.city}, ${SITE.address.state} · ${SITE.phoneDisplay}`;
    document.querySelector('.footer-osm')!.textContent = copy.footer.osm;
    const rate = document.querySelector('.mobile-cta__rate')!;
    rate.innerHTML = fill(copy.mobileCta.rate, { min: minRate });
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
