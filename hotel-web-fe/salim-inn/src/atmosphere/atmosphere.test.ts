// The atmosphere's rules: what MET Norway's forecast becomes, which hour is
// "now" and when a forecast is too old to show, Sibu's clock and sun, which
// look wins, and how the one request is shared and survives failure. The
// film's lighting is judged from screenshots; these pin the decisions it rests on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_AGE_MS, WeatherFeed, parseMetNo, skyOf, weatherAt, type Forecast, type Weather } from './weather';
import { periodAt, sibuTime, solarTimes } from './solar';
import { AtmosphereController, lookFor, MODE_KEY, NO_WEATHER, weatherLook } from './index';

const AT = Date.UTC(2026, 9, 13, 4, 30); // 12:30 in Sibu
const sibu = (h: number, m: number, day = 13, month = 9) => Date.UTC(2026, month, day, h - 8, m);
const MIN = 60_000;

// Locationforecast 2.0 compact, trimmed: three hourly steps from 12:00 Sibu
// time, then a six-hour step (no next_1_hours) as later in a real answer
const step = (time: string, temp: number | null, cloud: number, symbol: string | null, rain = 0) => ({
  time,
  data: {
    instant: { details: { air_pressure_at_sea_level: 1008.1, air_temperature: temp, cloud_area_fraction: cloud, relative_humidity: 70, wind_from_direction: 200, wind_speed: 2.1 } },
    ...(symbol ? { next_1_hours: { summary: { symbol_code: symbol }, details: { precipitation_amount: rain } } } : {}),
    next_6_hours: { summary: { symbol_code: 'rainshowers_day' }, details: { precipitation_amount: 3.1 } },
  },
});
const SAMPLE = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [111.8625, 2.2655, 9] },
  properties: {
    meta: { updated_at: '2026-10-13T01:24:39Z', units: { air_temperature: 'celsius', cloud_area_fraction: '%', precipitation_amount: 'mm' } },
    timeseries: [
      step('2026-10-13T04:00:00Z', 31.3, 100, 'cloudy'),
      step('2026-10-13T05:00:00Z', 31.6, 100, 'rain', 0.8),
      step('2026-10-13T06:00:00Z', 30.9, 100, 'heavyrain', 2),
      step('2026-10-15T12:00:00Z', 26, 80, null),
    ],
  },
};
const UPDATED = Date.UTC(2026, 9, 13, 1, 24, 39);
const forecast = () => parseMetNo(SAMPLE)!;

const reading = (over: Partial<Weather> = {}): Weather => ({
  from: sibu(12, 0), tempC: 28, cloudCover: 90, symbol: 'lightrain', precipitationMm: 0.4, sky: 'lightRain', updatedAt: UPDATED, ...over,
});

describe('weather from MET Norway', () => {
  it('turns MET symbols into the conditions the page names', () => {
    expect(['clearsky_day', 'clearsky_night', 'fair_day', 'fair_polartwilight'].map(skyOf)).toEqual(['clear', 'clear', 'clear', 'clear']);
    expect(skyOf('partlycloudy_night')).toBe('partly');
    expect(skyOf('cloudy')).toBe('overcast');
    expect(skyOf('fog')).toBe('fog');
    expect(['lightrain', 'lightrainshowers_day'].map(skyOf)).toEqual(['lightRain', 'lightRain']);
    expect(['rain', 'rainshowers_night'].map(skyOf)).toEqual(['rain', 'rain']);
    expect(['heavyrain', 'heavyrainshowers_day'].map(skyOf)).toEqual(['heavyRain', 'heavyRain']);
    expect(['rainandthunder', 'lightrainshowersandthunder_day', 'heavyrainandthunder'].map(skyOf)).toEqual(['thunder', 'thunder', 'thunder']);
    // sleet and snow never fall in Sibu: they, and anything unknown, name no
    // condition (thunder still names a storm, whatever falls with it)
    expect(['snow', 'sleetshowers_day', 'heavysnowandthunder', '', 'tornado'].map(skyOf)).toEqual(['other', 'other', 'thunder', 'other', 'other']);
  });

  it('keeps the hourly steps, in order, and reads the hour the visitor is in', () => {
    const f = forecast();
    expect(f.updatedAt).toBe(UPDATED);
    expect(f.hours.map((h) => sibuTime(h.from))).toEqual(['12:00', '13:00', '14:00']); // the six-hour step is left out
    expect(weatherAt(f, AT)).toEqual({ from: sibu(12, 0), tempC: 31.3, cloudCover: 100, symbol: 'cloudy', precipitationMm: 0, sky: 'overcast', updatedAt: UPDATED });
    expect(weatherAt(f, sibu(13, 0))).toMatchObject({ tempC: 31.6, sky: 'rain', precipitationMm: 0.8 });
    expect(weatherAt(f, sibu(14, 59))).toMatchObject({ sky: 'heavyRain' });
    expect(weatherAt(f, sibu(15, 0))).toBeNull(); // past the hours it describes one by one
    expect(weatherAt(f, sibu(11, 59))).toBeNull();
  });

  it('shows nothing rather than an old or broken forecast', () => {
    const hour = { from: AT - 30 * MIN, tempC: 30, cloudCover: 50, symbol: 'fair_day', precipitationMm: 0 };
    expect(weatherAt({ updatedAt: AT - MAX_AGE_MS + MIN, hours: [hour] }, AT)).not.toBeNull();
    expect(weatherAt({ updatedAt: AT - MAX_AGE_MS - MIN, hours: [hour] }, AT)).toBeNull(); // nginx kept serving an old copy
    expect(weatherAt({ updatedAt: AT + MAX_AGE_MS + MIN, hours: [hour] }, AT)).toBeNull(); // the visitor's clock is far off
    const props = SAMPLE.properties;
    expect(parseMetNo({ properties: { ...props, meta: {} } })).toBeNull();
    expect(parseMetNo({ properties: { ...props, meta: { updated_at: '13/10/2026 01:24' } } })).toBeNull();
    expect(parseMetNo({ properties: { ...props, timeseries: [] } })).toBeNull();
    expect(parseMetNo({ properties: { ...props, timeseries: [step('2026-10-13T04:00:00+08:00', 31, 100, 'cloudy')] } })).toBeNull();
    expect(parseMetNo('<html>')).toBeNull();
    expect(parseMetNo(null)).toBeNull();
    // one bad step is dropped, not the forecast; odd values are kept in range
    const f = parseMetNo({ properties: { ...props, timeseries: [step('2026-10-13T04:00:00Z', null, 100, 'cloudy'), step('2026-10-13T05:00:00Z', 30, 104, 'rain', -1)] } })!;
    expect(f.hours).toEqual([{ from: sibu(13, 0), tempC: 30, cloudCover: 100, symbol: 'rain', precipitationMm: 0 }]);
  });
});

describe("Sibu's clock and sun", () => {
  it('keeps UTC+8 whatever the visitor’s zone', () => {
    expect(sibuTime(AT)).toBe('12:30');
    expect(sibuTime(sibu(0, 5))).toBe('00:05');
  });

  it('puts sunrise and sunset within five minutes of the published times', () => {
    // published for Sibu: 15 Jul 06:31 / 18:45, 13 Oct 06:16 / 18:20
    for (const [day, month, rise, set] of [[15, 6, [6, 31], [18, 45]], [13, 9, [6, 16], [18, 20]]] as const) {
      const noon = sibu(12, 0, day, month);
      const { sunrise, sunset } = solarTimes(noon);
      expect(Math.abs(sunrise - sibu(rise[0], rise[1], day, month)), `sunrise ${day}/${month + 1}`).toBeLessThan(5 * MIN);
      expect(Math.abs(sunset - sibu(set[0], set[1], day, month)), `sunset ${day}/${month + 1}`).toBeLessThan(5 * MIN);
    }
  });

  it('names the period from the sun, not the clock alone', () => {
    const rise = sibu(6, 16), set = sibu(18, 20);
    expect(periodAt(sibu(5, 40), rise, set)).toBe('night');
    expect(periodAt(sibu(5, 55), rise, set)).toBe('morning'); // first light, 21 min before sunrise
    expect(periodAt(sibu(11, 29), rise, set)).toBe('morning');
    expect(periodAt(sibu(11, 30), rise, set)).toBe('afternoon');
    expect(periodAt(sibu(17, 4), rise, set)).toBe('afternoon');
    expect(periodAt(sibu(17, 5), rise, set)).toBe('golden'); // the last 75 minutes of sun
    expect(periodAt(sibu(18, 44), rise, set)).toBe('golden');
    expect(periodAt(sibu(18, 46), rise, set)).toBe('night');
  });
});

describe('which look wins', () => {
  it('lays the weather over the scripted film in AUTO, and nothing when there is none', () => {
    expect(lookFor('auto', null)).toEqual(NO_WEATHER);
    expect(lookFor('auto', reading({ sky: 'heavyRain' }))).toMatchObject({ pin: 0, day: 0, night: 0, rain: 0.9 });
    expect(lookFor('auto', reading({ sky: 'thunder' }))).toMatchObject({ storm: 1, cloud: 1 });
    // a clear sky's reported cover still shows, at half weight and no more
    expect(weatherLook(reading({ sky: 'clear', cloudCover: 40 })).cloud).toBeCloseTo(0.2, 9);
    expect(weatherLook(reading({ sky: 'partly', cloudCover: 100 })).cloud).toBeCloseTo(0.5, 9);
  });

  it('lets a manual mode set the whole look, whatever the weather', () => {
    const storm = reading({ sky: 'thunder' });
    expect(lookFor('day', storm)).toMatchObject({ pin: 1, duskTo: 0, day: 1, rain: 0, storm: 0 });
    expect(lookFor('sunset', storm)).toMatchObject({ pin: 1, duskTo: 0.3, rain: 0, storm: 0 });
    expect(lookFor('night', storm)).toMatchObject({ pin: 1, duskTo: 1, night: 1, rain: 0 });
    // RAIN keeps the film's own dusk and adds rain to it
    expect(lookFor('rain', null)).toMatchObject({ pin: 0, rain: 0.62 });
  });
});

describe('the controller', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const feedWith = (f: Forecast | null, answered = true) => {
    const feed = new WeatherFeed('/x', vi.fn());
    feed.forecast = f;
    feed.answered = answered;
    return feed;
  };

  it('remembers a chosen mode, forgets AUTO, and survives storage that throws', () => {
    const a = new AtmosphereController(feedWith(null));
    expect(a.mode).toBe('auto');
    a.setMode('night');
    expect(store.get(MODE_KEY)).toBe('night');
    expect(new AtmosphereController(feedWith(null)).mode).toBe('night');
    a.setMode('auto');
    expect(store.has(MODE_KEY)).toBe(false);
    a.setMode('rain', false); // a ?atmo= link: this load only
    expect(store.has(MODE_KEY)).toBe(false);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } });
    const b = new AtmosphereController(feedWith(null));
    expect(b.mode).toBe('auto');
    expect(() => b.setMode('day')).not.toThrow();
    expect(b.mode).toBe('day');
  });

  it('reads the forecast’s hour for now, and moves on at the hour without asking again', () => {
    const a = new AtmosphereController(feedWith(forecast()));
    expect(a.state(AT)).toMatchObject({ status: 'ready', weather: { tempC: 31.3, sky: 'overcast' }, period: 'afternoon' });
    expect(a.state(AT).look.cloud).toBe(0.8);
    const next = a.state(sibu(13, 10));
    expect(next).toMatchObject({ status: 'ready', weather: { tempC: 31.6, sky: 'rain' } });
    expect(next.look.rain).toBe(0.6);
    // the sun is Sibu's own, every day
    expect(next.sunrise).toBe(solarTimes(sibu(13, 10)).sunrise);
    // past the forecast's hours, or before any answer: no weather, the film as designed
    expect(a.state(sibu(15, 30))).toMatchObject({ status: 'unavailable', weather: null, look: NO_WEATHER });
    expect(new AtmosphereController(feedWith(null, false)).state(AT).status).toBe('loading');
  });

  it('tells a subscriber at once, then on every change', () => {
    const a = new AtmosphereController(feedWith(null));
    const seen: string[] = [];
    a.subscribe((s) => seen.push(s.mode));
    a.setMode('sunset');
    a.setMode('sunset'); // no change, no call
    expect(seen).toEqual(['auto', 'sunset']);
  });
});

describe('the weather request', () => {
  afterEach(() => vi.useRealTimers());

  it('is shared: two callers, one request', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(SAMPLE), { status: 200 }));
    vi.useFakeTimers({ now: AT });
    const feed = new WeatherFeed('/x', fetchFn as unknown as typeof fetch);
    expect(feed.status(AT)).toBe('loading');
    const [a, b] = await Promise.all([feed.refresh(), feed.refresh()]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(feed.status(AT)).toBe('ready');
  });

  it('fails quietly, and keeps the forecast it had until it is too old', async () => {
    vi.useFakeTimers({ now: AT });
    let ok = true;
    const fetchFn = vi.fn(async () => (ok ? new Response(JSON.stringify(SAMPLE), { status: 200 }) : new Response('down', { status: 503 })));
    const feed = new WeatherFeed('/x', fetchFn as unknown as typeof fetch);
    let heard = 0;
    feed.subscribe(() => heard++);
    await feed.refresh();
    ok = false;
    vi.setSystemTime(sibu(13, 20));
    await feed.refresh();
    expect(feed.at(sibu(13, 20))?.tempC).toBe(31.6); // the next hour of the forecast it kept
    expect(feed.status(UPDATED + MAX_AGE_MS + MIN)).toBe('unavailable');
    expect(heard).toBe(2);
    const offline = new WeatherFeed('/x', vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch);
    await expect(offline.refresh()).resolves.toBeNull();
    expect(offline.status(AT)).toBe('unavailable');
    const junk = new WeatherFeed('/x', vi.fn(async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch);
    await junk.refresh();
    expect(junk.status(AT)).toBe('unavailable');
  });
});
