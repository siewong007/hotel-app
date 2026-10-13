// Sibu's clock and sun. Malaysia keeps UTC+8 all year (Asia/Kuching, no
// daylight saving), so local time is a fixed offset. Sunrise and sunset come
// from the NOAA solar approximation for the hotel's coordinates (within a
// couple of minutes of published times at this latitude), which needs no
// network at all; MET Norway's forecast does not carry them.
import { LAT0, LON0 } from '../data/geo';

export const SIBU_TZ = 'Asia/Kuching';
const OFFSET_MS = 8 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** The periods the page knows, from the sun rather than the clock alone. */
export type Period = 'morning' | 'afternoon' | 'golden' | 'night';

/** Minutes past midnight in Sibu. */
export function sibuMinutes(now: number): number {
  const d = new Date(now + OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** "14:05" in Sibu, whatever the visitor's own zone. */
export function sibuTime(now: number): string {
  const m = sibuMinutes(now);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** NOAA's approximation: sunrise and sunset (epoch ms) on Sibu's date of `now`. */
export function solarTimes(now: number, lat = LAT0, lon = LON0): { sunrise: number; sunset: number } {
  const local = new Date(now + OFFSET_MS); // its UTC fields are Sibu's calendar
  const dateUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const dayOfYear = Math.round((dateUtc - Date.UTC(local.getUTCFullYear(), 0, 1)) / DAY_MS) + 1;
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const rad = Math.PI / 180;
  const cosHa = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
  const ha = Math.acos(Math.min(1, Math.max(-1, cosHa))) / rad;
  // NOAA counts minutes from UTC midnight of the date; Sibu's sunrise falls
  // the evening before in UTC, so it comes out negative, which is right
  return {
    sunrise: dateUtc + (720 - 4 * (lon + ha) - eqTime) * 60_000,
    sunset: dateUtc + (720 - 4 * (lon - ha) - eqTime) * 60_000,
  };
}

/** Morning from just before sunrise to late morning, afternoon until the
 *  last 75 minutes of sun, golden hour until just after sunset, then night. */
export function periodAt(now: number, sunrise: number, sunset: number): Period {
  const before = 25 * 60_000, golden = 75 * 60_000;
  if (now < sunrise - before || now > sunset + before) return 'night';
  if (now >= sunset - golden) return 'golden';
  return sibuMinutes(now) < 11 * 60 + 30 ? 'morning' : 'afternoon';
}
