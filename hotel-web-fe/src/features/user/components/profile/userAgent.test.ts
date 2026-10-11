import { describe, expect, it } from 'vitest';
import { parseUserAgent } from './userAgent';
import { describeSessionDevice } from './deviceIcons';

const UA = {
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  chromeIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  samsungTablet:
    'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Safari/537.36',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  headless:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36',
};

describe('parseUserAgent', () => {
  it.each([
    [UA.chromeWindows, 'Chrome', 'Windows', 'desktop'],
    [UA.edgeWindows, 'Edge', 'Windows', 'desktop'],
    [UA.safariMac, 'Safari', 'macOS', 'desktop'],
    [UA.firefoxLinux, 'Firefox', 'Linux', 'desktop'],
    [UA.safariIphone, 'Safari', 'iOS', 'mobile'],
    [UA.chromeIphone, 'Chrome', 'iOS', 'mobile'],
    [UA.chromeAndroid, 'Chrome', 'Android', 'mobile'],
    [UA.samsungTablet, 'Samsung Internet', 'Android', 'tablet'],
    [UA.ipad, 'Safari', 'iPadOS', 'tablet'],
  ])('reads %s', (ua, browser, os, formFactor) => {
    expect(parseUserAgent(ua)).toEqual({ browser, os, formFactor, automated: false });
  });

  it.each([
    ['curl/8.14.1'],
    ['Python-urllib/3.13'],
    ['python-requests/2.32.3'],
    ['Playwright/1.59.1 (x64; debian 13) node/20.19'],
    ['saliminn-staging-check'],
    ['hotel-verify'],
    ['Mozilla/5.0 hotel-retest'],
    [UA.headless],
  ])('flags %s as automated', (ua) => {
    expect(parseUserAgent(ua).automated).toBe(true);
  });

  it('returns nothing for an empty or missing user agent', () => {
    for (const ua of ['', '   ', null, undefined]) {
      expect(parseUserAgent(ua)).toEqual({
        browser: null,
        os: null,
        formFactor: null,
        automated: false,
      });
    }
  });
});

describe('describeSessionDevice', () => {
  it('labels a session as browser on operating system', () => {
    expect(describeSessionDevice(UA.chromeWindows)).toMatchObject({
      type: 'desktop',
      label: 'Chrome on Windows',
    });
    expect(describeSessionDevice(UA.safariIphone)).toMatchObject({
      type: 'mobile',
      label: 'Safari on iOS',
    });
    expect(describeSessionDevice(UA.ipad)).toMatchObject({
      type: 'tablet',
      label: 'Safari on iPadOS',
    });
  });

  it('labels scripts and headless browsers as automated clients', () => {
    for (const ua of ['curl/8.5.0', UA.headless, 'Playwright/1.59.1']) {
      expect(describeSessionDevice(ua)).toMatchObject({
        type: 'automated',
        label: 'Automated / API client',
      });
    }
  });

  it('falls back to the platform, then to a generic device', () => {
    expect(describeSessionDevice('Mozilla/5.0 (Windows NT 10.0)').label).toBe('Windows device');
    expect(describeSessionDevice(null)).toMatchObject({ type: 'unknown', label: 'Device' });
  });
});
