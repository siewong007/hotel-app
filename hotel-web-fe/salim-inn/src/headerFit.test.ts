// The top bar's Play-film fit (ui/headerFit.ts). jsdom lays nothing out, so
// each test gives the row a width and every pill a width from its label; the
// real widths are checked in a browser across 761–1440 px.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fitPlay } from './ui/headerFit';

const GAP = 8;
const PICKER = 100;
let room = 0;

const widthOf = (el: Element): number => (el.tagName === 'SELECT' ? PICKER : 30 + 8 * (el.textContent ?? '').length);
const isHidden = (el: Element): boolean => el.hasAttribute('hidden') || el.classList.contains('is-crowded-out');
const rect = (left: number, width: number): DOMRect =>
  ({ left, right: left + width, width, x: left, y: 0, top: 0, bottom: 42, height: 42, toJSON: () => ({}) }) as DOMRect;

// The row is `room` wide; its pills sit side by side at their own widths and
// overflow its right edge when they do not fit (as while fitPlay measures).
function layout(this: Element): DOMRect {
  if (this.classList.contains('top-actions')) return rect(0, room);
  const row = this.parentElement;
  if (!row?.classList.contains('top-actions') || isHidden(this)) return rect(0, 0);
  let x = 0;
  for (const pill of row.children) {
    if (pill === this) break;
    if (!isHidden(pill)) x += widthOf(pill) + GAP;
  }
  return rect(x, widthOf(this));
}

const mount = (direction = 'row'): { bar: HTMLElement; play: HTMLElement } => {
  document.body.innerHTML = `
    <header class="topbar" style="display: flex; flex-direction: ${direction}">
      <a class="brand" href="#top">Salim Inn</a>
      <nav class="top-actions">
        <select class="pill lang-picker" id="langPicker"><option>English</option></select>
        <a class="pill sign-in" id="accountAction" href="/login">Sign in</a>
        <button class="pill" id="play" type="button">Play film</button>
        <a class="pill pill--gold" id="bookingAction" href="/guest-portal?view=booking">Book direct</a>
      </nav>
    </header>`;
  return { bar: document.querySelector<HTMLElement>('.topbar')!, play: document.getElementById('play')! };
};

// English pills: picker 100, "Sign in" 86, "Book direct" 118, three gaps 24;
// Play is 102 as "Play film" and 118 as "Replay film", its longest label.
const WITH_PLAY = 100 + 86 + 102 + 118 + 3 * GAP;
const WITH_REPLAY = 100 + 86 + 118 + 118 + 3 * GAP;

describe('fitPlay', () => {
  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(layout);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('keeps Play film where the row holds it at its longest label', () => {
    const { bar, play } = mount();
    room = WITH_REPLAY;
    fitPlay(bar);
    expect(play.classList.contains('is-crowded-out')).toBe(false);
  });

  it('crowds Play out when only its shorter labels would fit', () => {
    const { bar, play } = mount();
    room = WITH_REPLAY - 1;
    expect(room).toBeGreaterThan(WITH_PLAY); // "Play film" itself would fit
    fitPlay(bar);
    expect(play.classList.contains('is-crowded-out')).toBe(true);
    expect(play.textContent).toBe('Play film'); // its label survives the measuring
  });

  it('brings Play film back when the row has room again', () => {
    const { bar, play } = mount();
    room = WITH_PLAY - 1;
    fitPlay(bar);
    expect(play.classList.contains('is-crowded-out')).toBe(true);
    room = WITH_REPLAY;
    fitPlay(bar);
    expect(play.classList.contains('is-crowded-out')).toBe(false);
  });

  it('counts what is shown: a hidden Book leaves room for Play film', () => {
    const { bar, play } = mount();
    document.getElementById('bookingAction')!.hidden = true; // an admin's bar
    room = WITH_REPLAY - 118 - GAP;
    fitPlay(bar);
    expect(play.classList.contains('is-crowded-out')).toBe(false);
  });

  it('leaves a Play the page itself hides alone (the still version, older phone rules)', () => {
    const { bar, play } = mount();
    play.style.display = 'none';
    room = 200;
    fitPlay(bar);
    expect(play.classList.contains('is-crowded-out')).toBe(false);
  });

  it('leaves the phones’ two-row bar alone', () => {
    const { bar, play } = mount('column');
    play.classList.add('is-crowded-out');
    room = 200;
    fitPlay(bar);
    expect(play.classList.contains('is-crowded-out')).toBe(false);
  });
});
