/**
 * Small, dependency-free user-agent reader for the signed-in device lists.
 *
 * The backend stores the raw `User-Agent` of every sign-in. The device list
 * used to keyword-match it against words like "laptop" or "desktop", which no
 * real desktop browser sends, so every Windows, macOS and Linux session showed
 * as a bare "Device". This turns the string into the parts a person
 * recognises — browser, operating system, form factor — and flags scripted
 * clients (curl, Python, headless browsers, Playwright, monitoring checks) so
 * they do not pass for someone's laptop.
 *
 * Best-effort and cosmetic only: a user agent is client-controlled, so nothing
 * here may feed a security decision.
 */

export type FormFactor = 'desktop' | 'mobile' | 'tablet';

export interface ParsedUserAgent {
  /** Product name such as "Chrome"; never translated. */
  browser: string | null;
  /** Platform name such as "Windows"; never translated. */
  os: string | null;
  formFactor: FormFactor | null;
  /** A script, API client or headless/automated browser rather than a person. */
  automated: boolean;
}

/** Scripted clients and automation frameworks, matched case-insensitively. */
const AUTOMATED_PATTERNS: RegExp[] = [
  /\bcurl\//i,
  /\bwget\//i,
  /python/i,
  /\bhttpie\//i,
  /postman/i,
  /insomnia/i,
  /okhttp/i,
  /go-http-client/i,
  /\bjava\//i,
  /node-fetch/i,
  /\baxios\//i,
  /\bundici\b/i,
  /headless/i,
  /playwright/i,
  /puppeteer/i,
  /selenium/i,
  /webdriver/i,
  /phantomjs/i,
  /lighthouse/i,
  /\b(bot|crawler|spider)\b/i,
  /libwww/i,
  /apache-httpclient/i,
];

const BROWSERS: Array<[RegExp, string]> = [
  // Order matters: Edge, Opera and Samsung Internet all also say "Chrome",
  // and Chrome also says "Safari".
  [/\b(Edg|EdgA|EdgiOS|Edge)\//, 'Edge'],
  [/\b(OPR|OPiOS|Opera)\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(Firefox|FxiOS)\//, 'Firefox'],
  [/\bCriOS\//, 'Chrome'],
  [/\bChromium\//, 'Chromium'],
  [/\bChrome\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
  [/\b(iPhone|iPad|iPod)\b.*\bAppleWebKit\//, 'Safari'],
];

const OPERATING_SYSTEMS: Array<[RegExp, string]> = [
  // iOS before macOS: iPhone user agents say "like Mac OS X".
  [/\biPad\b/, 'iPadOS'],
  [/\b(iPhone|iPod)\b/, 'iOS'],
  [/\bAndroid\b/, 'Android'],
  [/\bWindows\b/, 'Windows'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\b(Macintosh|Mac OS X)\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

function firstMatch(userAgent: string, table: Array<[RegExp, string]>): string | null {
  for (const [pattern, name] of table) {
    if (pattern.test(userAgent)) return name;
  }
  return null;
}

function formFactorOf(userAgent: string, os: string | null): FormFactor | null {
  if (/\b(iPad|Tablet)\b/i.test(userAgent)) return 'tablet';
  if (os === 'Android') return /\bMobile\b/.test(userAgent) ? 'mobile' : 'tablet';
  if (os === 'iOS' || /\bMobile\b/.test(userAgent)) return 'mobile';
  if (os) return 'desktop';
  return null;
}

export function parseUserAgent(raw: string | null | undefined): ParsedUserAgent {
  const userAgent = (raw ?? '').trim();
  if (!userAgent) {
    return { browser: null, os: null, formFactor: null, automated: false };
  }
  const os = firstMatch(userAgent, OPERATING_SYSTEMS);
  const browser = firstMatch(userAgent, BROWSERS);
  // A real browser identifies as "Mozilla/5.0 (<platform>) ...". With no
  // recognisable browser, a string that is not Mozilla-shaped or names no
  // platform at all (custom check scripts, SDKs) is a program, not a person.
  const automated =
    AUTOMATED_PATTERNS.some((pattern) => pattern.test(userAgent)) ||
    (browser === null && (os === null || !userAgent.startsWith('Mozilla/')));
  return { browser, os, formFactor: formFactorOf(userAgent, os), automated };
}
