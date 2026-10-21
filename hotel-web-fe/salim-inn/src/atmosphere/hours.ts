// Who is open now, on Sibu's clock. The film lights a business's windows
// while it trades, whatever hour its scripted dusk shows (World.setTrading):
// the hotel's front desk never closes (config/site.ts, 24-hour reception);
// the supermarket keeps its listed hours (data/neighbourhood.json); the shop
// rows and cafe.cafe trade 08:00–22:00 every day (the owner, 21 Oct 2026).
import { places, type Opening } from '../data/neighbourhood';
import { sibuDay, sibuMinutes } from './solar';

/** 1 while open, 0 while closed (World eases between them). */
export interface Trading {
  hotel: number;
  mart: number;
  shops: number;
}

const DAILY: Opening[] = [{ days: [0, 1, 2, 3, 4, 5, 6], times: ['08:00-22:00'] }];
/** The shop rows' ground floors and cafe.cafe (the owner, 21 Oct 2026). */
export const SHOP_HOURS: Opening[] = DAILY;
/** The supermarket's listed hours (the same today), or the shops' should its entry lose them. */
const MART_HOURS: Opening[] = places({ includeUnverified: true }).find((p) => p.kind === 'supermarket')?.opening ?? SHOP_HOURS;

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Whether `opening` (days 0 = Sunday, "HH:MM-HH:MM" times) is open at `now` in Sibu. */
export function openAt(opening: readonly Opening[], now: number): boolean {
  const m = sibuMinutes(now), day = sibuDay(now), yesterday = (day + 6) % 7;
  return opening.some((o) => o.times.some((t) => {
    const [a, b] = t.split('-').map(minutes);
    if (a <= b) return o.days.includes(day) && m >= a && m < b;
    // past midnight: from `a` on its own days until `b` the morning after
    return (o.days.includes(day) && m >= a) || (o.days.includes(yesterday) && m < b);
  }));
}

export function tradingAt(now: number): Trading {
  return { hotel: 1, mart: openAt(MART_HOURS, now) ? 1 : 0, shops: openAt(SHOP_HOURS, now) ? 1 : 0 };
}
