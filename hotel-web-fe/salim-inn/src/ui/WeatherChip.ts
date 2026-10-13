// The top bar's weather chip: "Sibu · 31°C · Overcast", from MET Norway's
// forecast for this hour (the atmosphere's feed), and a small panel with the
// hour's forecast, today's sun, the credit MET's licence asks for (CC BY 4.0)
// and the atmosphere selector (AUTO, DAY, SUNSET, NIGHT, RAIN). It is the quietest
// thing in the bar: a muted label beside the pills, never a second call to
// action. Until a reading arrives it shows just the place; with none at all,
// the place and Sibu's time. The chip's accessible name is its visible text
// and a hidden hint (WCAG 2.5.3, label in name); phones and tablets show only
// the icon and the temperature, and the rest stays in that name. The parts are
// separated by real spaces (the dots between them are CSS, silent), or a
// browser reads the name as one word: "Sibu31°COvercast".
import { MODES, type AtmosphereController, type AtmosphereState, type Mode, type Sky } from '../atmosphere';
import { sibuTime } from '../atmosphere/solar';
import { copy, fill } from '../content';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// 24 px line icons in the brand's gold; drawn, not fetched
const CLOUD = 'M7.5 18.5h9a3.75 3.75 0 0 0 .6-7.45A5.6 5.6 0 0 0 6.4 11.6 3.45 3.45 0 0 0 7.5 18.5z';
const CLOUD_UP = 'M7.5 15h9a3.75 3.75 0 0 0 .6-7.45A5.6 5.6 0 0 0 6.4 8.1 3.45 3.45 0 0 0 7.5 15z';
const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>';
const MOON = '<path d="M19.5 14.6A7.6 7.6 0 1 1 9.4 4.5a6 6 0 0 0 10.1 10.1z"/>';
const SMALL_SUN = '<circle cx="8.5" cy="8" r="2.6"/><path d="M8.5 3v1.3M3.5 8h1.3M5 4.5l.9.9M12 4.5l-.9.9"/>';
const SMALL_MOON = '<path d="M11.5 9.8A4.4 4.4 0 1 1 6.2 4.3a3.5 3.5 0 0 0 5.3 5.5z"/>';
const DROPS = (n: number) => [9, 12.5, 16, 7.5].slice(0, n).map((x) => `<path d="M${x} 17.5l-1 2.5"/>`).join('');

function icon(sky: Sky | null, night: boolean): string {
  let body: string;
  switch (sky) {
    case 'partly':
      body = `${night ? SMALL_MOON : SMALL_SUN}<path d="${CLOUD}"/>`;
      break;
    case 'overcast':
    case 'other':
      body = `<path d="${CLOUD}"/>`;
      break;
    case 'fog':
      body = `<path d="${CLOUD_UP}"/><path d="M5 18h14M7 21h10"/>`;
      break;
    case 'lightRain':
      body = `<path d="${CLOUD_UP}"/>${DROPS(2)}`;
      break;
    case 'rain':
      body = `<path d="${CLOUD_UP}"/>${DROPS(3)}`;
      break;
    case 'heavyRain':
      body = `<path d="${CLOUD_UP}"/>${DROPS(4)}`;
      break;
    case 'thunder':
      body = `<path d="${CLOUD_UP}"/><path d="M12.5 15.5l-2 3.5h3l-1.8 3.2"/>`;
      break;
    default: // clear, or no reading yet: the sky at this hour
      body = night ? MOON : SUN;
  }
  return `<svg class="wx__icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

// MET Norway asks for a link to where its data can be downloaded
const MET_LINK = '<a href="https://api.met.no/" target="_blank" rel="noopener">MET Norway</a>';
const LICENCE_LINK = '<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>';

const skyLabel = (sky: Sky): string | null => (sky === 'other' ? null : copy.weather.sky[sky]);
const temp = (c: number) => `${Math.round(c)}°C`;

/** The chip's visible parts, in order: always the place; then the reading,
 *  or Sibu's time when there is none. */
export function chipParts(s: AtmosphereState): { place: string; temp: string | null; sky: string | null; time: string | null } {
  const w = s.weather;
  if (w) return { place: copy.weather.place, temp: temp(w.tempC), sky: skyLabel(w.sky), time: null };
  return { place: copy.weather.place, temp: null, sky: null, time: s.status === 'unavailable' ? sibuTime(s.now) : null };
}

/** Puts the chip first in the bar's actions and keeps it current. */
export function mountWeatherChip(atmo: AtmosphereController, host: HTMLElement | null = document.querySelector('.top-actions')): HTMLElement | null {
  if (!host) return null;
  const t = copy.weather;
  const root = document.createElement('div');
  root.className = 'wx';
  root.innerHTML = `
    <button class="wx__chip" type="button" aria-expanded="false" aria-controls="wx-panel">
      <span class="wx__glyph"></span>
      <span class="wx__text"><span class="wx__place"></span> <span class="wx__temp"></span> <span class="wx__sky"></span> <span class="wx__time"></span></span> <span class="visually-hidden">${esc(t.hint)}</span>
    </button>
    <div class="wx__panel" id="wx-panel" role="dialog" aria-labelledby="wx-title" tabindex="-1" hidden>
      <div class="wx__head">
        <p class="wx__title" id="wx-title">${esc(t.region)}</p>
        <button class="wx__close" type="button" aria-label="${esc(t.close)}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </div>
      <p class="wx__now"></p>
      <dl class="wx__facts"></dl>
      <fieldset class="wx__modes">
        <legend>${esc(t.atmosphere)}</legend>
        <div class="wx__options">${MODES.map((m) => `<label class="wx__option"><input type="radio" name="wx-mode" value="${m}"><span>${esc(t.modes[m])}</span></label>`).join('')}</div>
        <p class="wx__hint">${esc(t.atmosphereHint)}</p>
      </fieldset>
      <p class="wx__source"></p>
    </div>`;
  host.prepend(root);
  const q = <E extends Element>(sel: string) => root.querySelector<E>(sel)!;
  const chip = q<HTMLButtonElement>('.wx__chip');
  const panel = q<HTMLElement>('.wx__panel');

  const open = (on: boolean, refocus = false) => {
    if (on === !panel.hidden) return;
    panel.hidden = !on;
    chip.setAttribute('aria-expanded', String(on));
    root.classList.toggle('is-open', on);
    if (on) panel.focus();
    else if (refocus) chip.focus();
  };
  chip.addEventListener('click', () => open(!!panel.hidden));
  q<HTMLButtonElement>('.wx__close').addEventListener('click', () => open(false, true));
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) {
      e.stopPropagation();
      open(false, true);
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!panel.hidden && !root.contains(e.target as Node)) open(false);
  });
  root.addEventListener('focusout', (e) => {
    // tabbing out of the panel closes it, as leaving a menu does
    if (!panel.hidden && e.relatedTarget instanceof Node && !root.contains(e.relatedTarget)) open(false);
  });
  for (const input of root.querySelectorAll<HTMLInputElement>('input[name="wx-mode"]')) {
    input.addEventListener('change', () => {
      if (input.checked) atmo.setMode(input.value as Mode);
    });
  }

  atmo.subscribe((s) => render(root, s));
  return root;
}

function render(root: HTMLElement, s: AtmosphereState): void {
  const t = copy.weather;
  const w = s.weather;
  const night = s.period === 'night';
  const parts = chipParts(s);
  root.querySelector('.wx__glyph')!.innerHTML = icon(w?.sky ?? null, night);
  const set = (sel: string, text: string | null) => {
    const el = root.querySelector<HTMLElement>(sel)!;
    el.textContent = text ?? '';
    el.hidden = text === null;
  };
  set('.wx__place', parts.place);
  set('.wx__temp', parts.temp);
  set('.wx__sky', parts.sky);
  set('.wx__time', parts.time);
  root.dataset.status = s.status;

  const now = root.querySelector<HTMLElement>('.wx__now')!;
  if (w) now.innerHTML = `<span class="wx__big">${esc(temp(w.tempC))}</span>${skyLabel(w.sky) ? `<span>${esc(skyLabel(w.sky)!)}</span>` : ''}`;
  else now.textContent = s.status === 'loading' ? t.loading : t.unavailable;
  const facts: [string, string][] = [];
  if (w) facts.push([t.cloud, `${Math.round(w.cloudCover)}%`], [t.rain, `${w.precipitationMm.toFixed(1)} mm`]);
  facts.push([t.sunrise, sibuTime(s.sunrise)], [t.sunset, sibuTime(s.sunset)], [t.localTime, sibuTime(s.now)]);
  root.querySelector('.wx__facts')!.innerHTML = facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  // the credit (the links are ours; the words around them are escaped first)
  root.querySelector('.wx__source')!.innerHTML = w
    ? `${fill(esc(t.source), { met: MET_LINK, licence: LICENCE_LINK })} · <span class="wx__hour">${esc(fill(t.forecastFor, { from: sibuTime(w.from), to: sibuTime(w.from + 3_600_000) }))}</span>`
    : '';
  for (const input of root.querySelectorAll<HTMLInputElement>('input[name="wx-mode"]')) input.checked = input.value === s.mode;
  // hooks for the page's own styling (and the film's period-aware details)
  const html = document.documentElement;
  html.dataset.period = s.period;
  html.dataset.atmosphere = s.mode;
  if (w) html.dataset.sky = w.sky;
  else delete html.dataset.sky;
}
