// The header's weather chip: what it says in each state (and never more than
// the forecast), that its name holds its visible words (WCAG 2.5.3), the
// credit MET Norway's licence asks for, and that its panel opens, closes and
// sets the atmosphere the way a keyboard expects.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AtmosphereController, MODE_KEY } from '../atmosphere';
import { WeatherFeed, type Forecast, type Hour } from '../atmosphere/weather';
import { sibuTime, solarTimes } from '../atmosphere/solar';
import { chipParts, mountWeatherChip } from './WeatherChip';

const AT = Date.UTC(2026, 9, 13, 4, 30); // 12:30 in Sibu
const hour = (over: Partial<Hour> = {}): Hour => ({ from: Date.UTC(2026, 9, 13, 4, 0), tempC: 31.3, cloudCover: 100, symbol: 'cloudy', precipitationMm: 0, ...over });
const forecast = (over: Partial<Hour> = {}): Forecast => ({ updatedAt: Date.UTC(2026, 9, 13, 1, 24), hours: [hour(over)] });

const words = (s: string) => s.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

describe('the weather chip', () => {
  let store: Map<string, string>;
  let feed: WeatherFeed;
  let atmo: AtmosphereController;
  let host: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers({ now: AT });
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    document.body.innerHTML = '<header class="topbar"><nav class="top-actions"><select id="langPicker"></select><a class="pill" href="/login">Sign in</a></nav></header>';
    host = document.querySelector('.top-actions')!;
    feed = new WeatherFeed('/x', vi.fn());
    atmo = new AtmosphereController(feed);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  /** What a finished request does: hold its forecast (or none) and tell every listener. */
  const publish = (f: Forecast | null) => {
    feed.forecast = f;
    feed.answered = true;
    (feed as unknown as { listeners: Set<() => void> }).listeners.forEach((fn) => fn());
  };
  const text = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.wx__text > span')].filter((e) => !e.hidden).map((e) => e.textContent).join(' | ');

  it('says only the place until a forecast arrives, then this hour’s, and the time when there is none', () => {
    const root = mountWeatherChip(atmo, host)!;
    expect(host.firstElementChild).toBe(root); // first in the bar's actions
    expect(text(root)).toBe('Sibu');
    publish(forecast());
    expect(text(root)).toBe('Sibu | 31°C | Overcast');
    publish(null);
    expect(text(root)).toBe('Sibu | 12:30');
    // an unknown symbol names no condition rather than guessing one
    expect(chipParts({ ...atmo.state(), weather: { ...hour({ symbol: 'tornado' }), sky: 'other', updatedAt: 0 } })).toMatchObject({ temp: '31°C', sky: null });
  });

  it('moves on to the next hour at the minute’s tick, without a request', () => {
    const root = mountWeatherChip(atmo, host)!;
    publish({ updatedAt: Date.UTC(2026, 9, 13, 1, 24), hours: [hour(), hour({ from: Date.UTC(2026, 9, 13, 5, 0), tempC: 29.6, symbol: 'rain' })] });
    atmo.start(); // the feed's own request is the vi.fn() above: it answers nothing
    vi.setSystemTime(Date.UTC(2026, 9, 13, 5, 0, 30));
    vi.advanceTimersByTime(60_000);
    expect(text(root)).toBe('Sibu | 30°C | Rain');
  });

  it('is named by the words it shows, then what it is for', () => {
    const root = mountWeatherChip(atmo, host)!;
    publish(forecast({ symbol: 'lightrain', tempC: 27.6 }));
    const chip = root.querySelector('button.wx__chip')!;
    expect(chip.hasAttribute('aria-label')).toBe(false);
    const visible = [...chip.querySelectorAll<HTMLElement>('.wx__text > span')].filter((e) => !e.hidden).map((e) => e.textContent).join(' ');
    expect(words(chip.textContent ?? '')).toContain(words(visible));
    expect(words(chip.textContent ?? '')).toBe('sibu 28 c light rain weather and atmosphere');
    expect(chip.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('opens a labelled panel, closes on Escape back to the chip, and on a click outside', () => {
    const root = mountWeatherChip(atmo, host)!;
    publish(forecast());
    const chip = root.querySelector<HTMLButtonElement>('.wx__chip')!;
    const panel = root.querySelector<HTMLElement>('#wx-panel')!;
    expect(chip.getAttribute('aria-controls')).toBe('wx-panel');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(document.getElementById(panel.getAttribute('aria-labelledby')!)!.textContent).toBe('Sibu, Sarawak');
    chip.click();
    expect(panel.hidden).toBe(false);
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(panel);
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.hidden).toBe(true);
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(chip);
    chip.click();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(panel.hidden).toBe(true);
  });

  it('shows the hour’s forecast with MET Norway’s credit, and only Sibu’s sun and time without one', () => {
    const root = mountWeatherChip(atmo, host)!;
    publish(forecast({ precipitationMm: 0.44 }));
    const sun = solarTimes(AT);
    const facts = () => [...root.querySelectorAll('.wx__facts div')].map((d) => `${d.querySelector('dt')!.textContent}=${d.querySelector('dd')!.textContent}`);
    expect(facts()).toEqual(['Cloud cover=100%', 'Rain this hour=0.4 mm', `Sunrise=${sibuTime(sun.sunrise)}`, `Sunset=${sibuTime(sun.sunset)}`, 'Local time=12:30']);
    const source = root.querySelector('.wx__source')!;
    expect(source.textContent).toBe('Weather data from MET Norway (CC BY 4.0), summarised · Forecast for 12:00–13:00');
    expect([...source.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href'), a.rel])).toEqual([
      ['MET Norway', 'https://api.met.no/', 'noopener'],
      ['CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/', 'noopener'],
    ]);
    publish(null);
    expect(root.querySelector('.wx__now')!.textContent).toBe('The weather in Sibu isn’t available just now.');
    expect(facts().map((f) => f.split('=')[0])).toEqual(['Sunrise', 'Sunset', 'Local time']);
    expect(root.querySelector('.wx__source')!.textContent).toBe('');
  });

  it('sets and remembers the atmosphere from its radio group, AUTO first and checked', () => {
    const root = mountWeatherChip(atmo, host)!;
    const radios = [...root.querySelectorAll<HTMLInputElement>('input[name="wx-mode"]')];
    expect(radios.map((r) => r.value)).toEqual(['auto', 'day', 'sunset', 'night', 'rain']);
    expect(radios.find((r) => r.checked)!.value).toBe('auto');
    expect(root.querySelector('legend')!.textContent).toBe('Atmosphere');
    const night = radios.find((r) => r.value === 'night')!;
    night.checked = true;
    night.dispatchEvent(new Event('change', { bubbles: true }));
    expect(atmo.mode).toBe('night');
    expect(store.get(MODE_KEY)).toBe('night');
    expect(document.documentElement.dataset.atmosphere).toBe('night');
  });
});
