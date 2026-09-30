// Locale resolution, bundle parity and DOM application for the landing page.
// The shared `locale` storage key is asserted here because the hotel app reads
// the same key when the guest continues into the portal.
import { describe, expect, it, vi } from 'vitest';
import indexHtml from '../index.html?raw';
import { en } from './content/en';
import { ms } from './content/ms';
import { zh } from './content/zh';
import { zhTW } from './content/zhTW';
import { fill, type Copy } from './content';
import {
  LANG_CODES,
  STORAGE_KEY,
  matchLang,
  resolveLang,
  type LangCode,
} from './content/lang';

const BUNDLES: Record<LangCode, Copy> = { en, ms, zh, 'zh-TW': zhTW };

const copyAtIn = (bundle: Copy, path: string): unknown =>
  path.split('.').reduce<unknown>((node, key) => {
    if (node && typeof node === 'object') return (node as Record<string, unknown>)[key];
    return undefined;
  }, bundle);

describe('matchLang', () => {
  it('maps each supported family, Traditional before Simplified', () => {
    expect(matchLang('en-GB')).toBe('en');
    expect(matchLang('ms-MY')).toBe('ms');
    expect(matchLang('zh')).toBe('zh');
    expect(matchLang('zh-CN')).toBe('zh');
    expect(matchLang('zh-Hans-CN')).toBe('zh');
    expect(matchLang('zh-TW')).toBe('zh-TW');
    expect(matchLang('zh-HK')).toBe('zh-TW');
    expect(matchLang('zh-Hant')).toBe('zh-TW');
    expect(matchLang('fr-FR')).toBeNull();
    expect(matchLang(null)).toBeNull();
    expect(matchLang('')).toBeNull();
  });
});

describe('resolveLang', () => {
  it('prefers ?lang= over storage and the browser list', () => {
    expect(resolveLang({ query: 'ms', stored: 'zh-TW', languages: ['en'] })).toBe('ms');
    expect(resolveLang({ query: 'zh-tw', stored: 'ms' })).toBe('zh-TW');
  });

  it('falls back through storage, then navigator.languages, then English', () => {
    expect(resolveLang({ stored: 'zh', languages: ['en'] })).toBe('zh');
    expect(resolveLang({ languages: ['fr', 'ms-MY'] })).toBe('ms');
    expect(resolveLang({ languages: ['fr', 'de'] })).toBe('en');
    expect(resolveLang({})).toBe('en');
    expect(resolveLang({ query: 'klingon', stored: 'also-bad' })).toBe('en');
  });
});

describe('copy bundles', () => {
  it('cover all four locale codes', () => {
    expect(LANG_CODES).toEqual(['en', 'ms', 'zh', 'zh-TW']);
    for (const code of LANG_CODES) expect(BUNDLES[code].chapters).toHaveLength(en.chapters.length);
  });

  it('resolve every data-i18n path in index.html in every locale', () => {
    const html = indexHtml;
    const paths = new Set<string>();
    for (const m of html.matchAll(/data-i18n(?:-html|-alt|-aria)?="([^"]+)"/g)) paths.add(m[1]);
    expect(paths.size).toBeGreaterThan(80);
    for (const code of LANG_CODES) {
      for (const path of paths) {
        const value = copyAtIn(BUNDLES[code], path);
        expect(typeof value, `${code} missing ${path}`).toBe('string');
        expect(value, `${code} empty ${path}`).not.toBe('');
      }
    }
  });

  it('keeps placeholders the runtime fills', () => {
    for (const code of LANG_CODES) {
      expect(BUNDLES[code].chapterNav.aria).toContain('{{id}}');
      expect(BUNDLES[code].bookingCard.call).toContain('{{phone}}');
    }
    expect(fill('Call {{phone}}', { phone: '+60 11' })).toBe('Call +60 11');
    expect(fill('no slots', {})).toBe('no slots');
  });
});

describe('applyCopy', () => {
  const load = async (stored: string) => {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEY, stored);
    vi.resetModules();
    return { applyCopy: (await import('./applyCopy')).applyCopy, copy: (await import('./content')).copy };
  };

  it('swaps marked elements, title, description and <html lang> for a stored locale', async () => {
    document.documentElement.innerHTML = `
      <head><meta name="description" content="en"></head>
      <body>
        <p data-i18n="welcome.eyebrow">fallback</p>
        <h2 data-i18n-html="welcome.titleLine1">fallback</h2>
        <img data-i18n-alt="brand.logoAlt" alt="fallback">
        <nav data-i18n-aria="nav.aria" aria-label="fallback"></nav>
        <p data-i18n="unknown.path">keep me</p>
      </body>`;
    const { applyCopy, copy } = await load('ms');
    applyCopy();
    expect(document.documentElement.lang).toBe('ms');
    expect(document.title).toBe(copy.meta.title);
    expect(document.querySelector('meta[name="description"]')!.getAttribute('content')).toBe(copy.meta.description);
    expect(document.querySelector('[data-i18n="welcome.eyebrow"]')!.textContent).toBe(ms.welcome.eyebrow);
    expect(document.querySelector('[data-i18n-alt]')!.getAttribute('alt')).toBe(ms.brand.logoAlt);
    expect(document.querySelector('[data-i18n-aria]')!.getAttribute('aria-label')).toBe(ms.nav.aria);
    expect(document.querySelector('[data-i18n="unknown.path"]')!.textContent).toBe('keep me');
  });

  it('uses the shared locale key the hotel app reads', () => {
    expect(STORAGE_KEY).toBe('locale');
  });
});
