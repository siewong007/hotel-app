// The page's atmosphere: Sibu's weather and sun, the visitor's chosen mode,
// and the look they add up to in the film. Kept free of three.js: main.ts
// loads it with the page, so the header's weather chip works on the still
// page too, and film.ts reads `look()` every frame.
//
// Priority: a manual mode (DAY, SUNSET, NIGHT, RAIN) sets the whole look and
// ignores the weather; AUTO keeps the film's scripted afternoon-to-dusk and
// lays Sibu's actual weather over it; with no weather (the request failed or
// the forecast is too old) AUTO is the film as designed. The weather shown in
// the header is always the real forecast, whatever the mode.
import { WeatherFeed, type FeedStatus, type Sky, type Weather } from './weather';
import { periodAt, solarTimes, type Period } from './solar';

export type { FeedStatus, Sky, Weather } from './weather';
export type { Period } from './solar';

export type Mode = 'auto' | 'day' | 'sunset' | 'night' | 'rain';
export const MODES: readonly Mode[] = ['auto', 'day', 'sunset', 'night', 'rain'];
export const MODE_KEY = 'salim-inn.atmosphere';

/** What the film's lighting does with the atmosphere; every value 0–1. */
export interface Look {
  /** How far the film's scripted dusk is pulled toward `duskTo` (0 keeps the script). */
  pin: number;
  duskTo: number;
  /** Daylight instead of dusk (DAY). */
  day: number;
  /** Darker than the film's own blue hour (NIGHT). */
  night: number;
  /** Overcast: a grey sky, a veiled sun, softer shadows. */
  cloud: number;
  /** Falling rain, and the darker, wetter light that comes with it. */
  rain: number;
  /** A thunderstorm's heavier sky (never flashes). */
  storm: number;
  /** Haze and mist close to the ground. */
  haze: number;
}

export const NO_WEATHER: Look = { pin: 0, duskTo: 0, day: 0, night: 0, cloud: 0, rain: 0, storm: 0, haze: 0 };

const BY_SKY: Record<Sky, Partial<Look>> = {
  clear: { cloud: 0.06 },
  partly: { cloud: 0.35 },
  overcast: { cloud: 0.8, haze: 0.2 },
  fog: { cloud: 0.7, haze: 0.85 },
  lightRain: { cloud: 0.78, rain: 0.35, haze: 0.3 },
  rain: { cloud: 0.88, rain: 0.6, haze: 0.4 },
  heavyRain: { cloud: 0.95, rain: 0.9, haze: 0.55 },
  thunder: { cloud: 1, rain: 0.75, storm: 1, haze: 0.5 },
  other: {},
};

/** AUTO: the scripted film under Sibu's actual sky. */
export function weatherLook(w: Weather | null): Look {
  if (!w) return { ...NO_WEATHER };
  const look = { ...NO_WEATHER, ...BY_SKY[w.sky] };
  // a clear or broken sky's cover is the reported one, at half weight
  if (w.sky === 'clear' || w.sky === 'partly') look.cloud = Math.max(look.cloud, Math.min(0.5, (w.cloudCover / 100) * 0.5));
  return look;
}

/** The look for a mode. Manual modes are curated and leave the weather out. */
export function lookFor(mode: Mode, w: Weather | null): Look {
  switch (mode) {
    case 'day':
      return { ...NO_WEATHER, pin: 1, duskTo: 0, day: 1, cloud: 0.12 };
    case 'sunset':
      return { ...NO_WEATHER, pin: 1, duskTo: 0.3, cloud: 0.08 };
    case 'night':
      return { ...NO_WEATHER, pin: 1, duskTo: 1, night: 1, cloud: 0.1 };
    case 'rain':
      return { ...NO_WEATHER, cloud: 0.88, rain: 0.62, haze: 0.45 };
    default:
      return weatherLook(w);
  }
}

const isMode = (v: unknown): v is Mode => typeof v === 'string' && (MODES as readonly string[]).includes(v);

/** The stored choice; storage can be absent or throw (private windows). */
function readMode(): Mode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return isMode(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

function writeMode(m: Mode): void {
  try {
    if (m === 'auto') localStorage.removeItem(MODE_KEY);
    else localStorage.setItem(MODE_KEY, m);
  } catch {
    /* not remembered, still applied */
  }
}

export interface AtmosphereState {
  mode: Mode;
  /** The forecast's hour for `now`. */
  weather: Weather | null;
  status: FeedStatus;
  now: number;
  /** Today's, in Sibu, from the solar approximation (solar.ts). */
  sunrise: number;
  sunset: number;
  period: Period;
  look: Look;
}

export class AtmosphereController {
  readonly feed: WeatherFeed;
  private current: Mode;
  private listeners = new Set<(s: AtmosphereState) => void>();
  private clock: ReturnType<typeof setInterval> | null = null;
  /** perf/ tooling only (?debug=1&wxlook=<sky>): the film's look as if the sky
   *  were this. The header keeps showing the real reading. */
  lookAs: Sky | null = null;

  constructor(feed = new WeatherFeed()) {
    this.feed = feed;
    this.current = readMode();
    feed.subscribe(() => this.emit());
  }

  get mode(): Mode {
    return this.current;
  }

  /** `remember` false: this page load only (a ?atmo= link). */
  setMode(mode: Mode, remember = true): void {
    if (remember) writeMode(mode);
    if (mode === this.current) return;
    this.current = mode;
    this.emit();
  }

  /** Begin asking for the weather, and re-read the hour and the sun once a
   *  minute (the forecast's next hour takes over without a request). */
  start(): void {
    this.feed.start();
    if (!this.clock) this.clock = setInterval(() => this.emit(), 60_000);
  }

  look(now = Date.now()): Look {
    if (this.current === 'auto' && this.lookAs) return weatherLook({ ...TEST_READING, sky: this.lookAs });
    return lookFor(this.current, this.feed.at(now));
  }

  state(now = Date.now()): AtmosphereState {
    const { sunrise, sunset } = solarTimes(now);
    return {
      mode: this.current,
      weather: this.feed.at(now),
      status: this.feed.status(now),
      now,
      sunrise,
      sunset,
      period: periodAt(now, sunrise, sunset),
      look: this.look(now),
    };
  }

  /** Called at once with the current state, then on every change. */
  subscribe(fn: (s: AtmosphereState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state());
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const s = this.state();
    for (const fn of this.listeners) fn(s);
  }
}

/** Only ever used for `lookAs` (a scene look for tooling), never shown. */
const TEST_READING: Weather = { from: 0, tempC: 0, cloudCover: 0, symbol: '', precipitationMm: 0, sky: 'other', updatedAt: 0 };

/** The page's one controller (main.ts starts it; film.ts and the header read it). */
export const atmosphere = new AtmosphereController();
