// Sibu's weather for the header and the film's atmosphere: MET Norway's
// forecast for the hotel's coordinates (Locationforecast 2.0), the model's
// best estimate of each hour — no station reports Sibu's weather any closer.
// The page asks its own origin (/salim-inn/weather.json): nginx fetches MET
// as often as its Expires header allows (about every half hour) and serves
// every visitor from that copy (nginx.conf), so no visitor's browser talks to
// a third party and the page's CSP stays 'self'. MET's data is free for
// commercial use with credit (CC BY 4.0, WeatherChip.ts); Open-Meteo's free
// tier, used first, is for non-commercial use only (its terms, 2026-10-13).
//
// The page keeps the whole forecast and reads the hour it is in, so the chip
// and the film move on at the hour without asking again. Nothing here is made
// up: a failed, malformed or too-old answer is no weather at all, and the page
// carries on without it.

/** What the sky is doing, from MET Norway's symbol code. */
export type Sky = 'clear' | 'partly' | 'overcast' | 'fog' | 'lightRain' | 'rain' | 'heavyRain' | 'thunder' | 'other';

/** One hour of the forecast. */
export interface Hour {
  /** When the hour begins (epoch ms). */
  from: number;
  /** °C at the start of the hour. */
  tempC: number;
  /** Cloud cover at the start of the hour, 0–100 %. */
  cloudCover: number;
  /** MET's symbol for the hour, as given (e.g. "rainshowers_day"). */
  symbol: string;
  /** Rain expected over the hour, mm. */
  precipitationMm: number;
}

export interface Forecast {
  /** When MET last updated it (epoch ms). */
  updatedAt: number;
  /** In time order. */
  hours: Hour[];
}

/** The hour the page is in, as the header and the film use it. */
export interface Weather extends Hour {
  sky: Sky;
  /** When MET last updated the forecast (epoch ms). */
  updatedAt: number;
}

export type FeedStatus = 'loading' | 'ready' | 'unavailable';

export const WEATHER_URL = '/salim-inn/weather.json';
/** How often a visible page asks again (about how long MET's copy lasts). */
export const REFRESH_MS = 30 * 60_000;
/** A forecast older than this is not shown as the weather now. MET updates
 *  Sibu's several times a day; this is a long outage, not a slow update. */
export const MAX_AGE_MS = 18 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;
const TIMEOUT_MS = 8000;

/** MET symbol code → the conditions the page knows. Sibu never sees sleet or
 *  snow: those, and anything unknown, are 'other' and name no condition. */
export function skyOf(symbol: string): Sky {
  const s = symbol.replace(/_(day|night|polartwilight)$/, '');
  if (s.includes('thunder')) return 'thunder';
  if (/sleet|snow/.test(s)) return 'other';
  if (s.startsWith('heavyrain')) return 'heavyRain';
  if (s.startsWith('lightrain')) return 'lightRain';
  if (s.startsWith('rain')) return 'rain';
  if (s === 'clearsky' || s === 'fair') return 'clear';
  if (s === 'partlycloudy') return 'partly';
  if (s === 'cloudy') return 'overcast';
  if (s === 'fog') return 'fog';
  return 'other';
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null);
const time = (v: unknown): number | null => {
  // MET's times are ISO 8601 in UTC ("2026-10-13T05:00:00Z")
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/** Locationforecast's compact JSON → the hours it describes one by one (the
 *  first two days or so; later steps cover six hours and are left out), or
 *  null when it says nothing the page could show. */
export function parseMetNo(data: unknown): Forecast | null {
  const props = obj(obj(data)?.properties);
  const updatedAt = time(obj(props?.meta)?.updated_at);
  if (!props || updatedAt === null || !Array.isArray(props.timeseries)) return null;
  const hours: Hour[] = [];
  for (const step of props.timeseries) {
    const from = time(obj(step)?.time);
    const d = obj(obj(step)?.data);
    const inst = obj(obj(d?.instant)?.details);
    const next = obj(d?.next_1_hours);
    const symbol = obj(next?.summary)?.symbol_code;
    const rain = obj(next?.details)?.precipitation_amount;
    if (from === null || !inst || !isNum(inst.air_temperature) || !isNum(inst.cloud_area_fraction) || typeof symbol !== 'string') continue;
    hours.push({
      from,
      tempC: inst.air_temperature,
      cloudCover: Math.min(100, Math.max(0, inst.cloud_area_fraction)),
      symbol,
      precipitationMm: isNum(rain) ? Math.max(0, rain) : 0,
    });
  }
  hours.sort((a, b) => a.from - b.from);
  return hours.length ? { updatedAt, hours } : null;
}

/** The forecast's hour that `now` falls in, or null when the forecast is too
 *  old, or does not cover now (or the visitor's clock is far off). */
export function weatherAt(f: Forecast, now: number): Weather | null {
  if (Math.abs(now - f.updatedAt) > MAX_AGE_MS) return null;
  const h = f.hours.find((x) => x.from <= now && now < x.from + HOUR_MS);
  return h ? { ...h, sky: skyOf(h.symbol), updatedAt: f.updatedAt } : null;
}

/** One request at a time for the whole page; refreshed every REFRESH_MS
 *  while the page is visible, and on return to it once that much has passed.
 *  A failed request keeps the forecast it had (weatherAt judges its age). */
export class WeatherFeed {
  forecast: Forecast | null = null;
  /** An answer, good or not, has come back. */
  answered = false;
  private listeners = new Set<() => void>();
  private inflight: Promise<Forecast | null> | null = null;
  private fetchedAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private readonly url: string;
  private readonly fetchFn: typeof fetch;

  constructor(url = WEATHER_URL, fetchFn: typeof fetch = (...a) => fetch(...a)) {
    this.url = url;
    this.fetchFn = fetchFn;
  }

  /** The weather for `now`, from the forecast held. */
  at(now: number): Weather | null {
    return this.forecast ? weatherAt(this.forecast, now) : null;
  }

  status(now: number): FeedStatus {
    if (!this.answered) return 'loading';
    return this.at(now) ? 'ready' : 'unavailable';
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.refresh();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - this.fetchedAt >= REFRESH_MS) void this.refresh();
    });
  }

  /** Ask now, unless a request is already on its way. */
  refresh(): Promise<Forecast | null> {
    if (this.inflight) return this.inflight;
    this.inflight = this.load().then((f) => {
      this.inflight = null;
      this.fetchedAt = Date.now();
      this.answered = true;
      if (f) this.forecast = f;
      for (const fn of this.listeners) fn();
      this.schedule();
      return this.forecast;
    });
    return this.inflight;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (document.visibilityState === 'visible') void this.refresh();
    }, REFRESH_MS);
  }

  private async load(): Promise<Forecast | null> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetchFn(this.url, { headers: { Accept: 'application/json' }, signal: ctl.signal });
      if (!res.ok) return null;
      return parseMetNo(await res.json());
    } catch {
      return null; // offline, blocked, timed out or not JSON: no weather
    } finally {
      clearTimeout(t);
    }
  }
}
