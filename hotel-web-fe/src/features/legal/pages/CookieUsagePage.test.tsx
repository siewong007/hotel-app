import { act, render, screen } from '@testing-library/react';
import { setActiveLocale } from '../../../i18n/localeStore';
import { publicRouteDefinitions } from '../../../navigation/routeRegistry';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../../test/axe';
import CookieUsagePage from './CookieUsagePage';

describe('CookieUsagePage', () => {
  it('is available as a public page without an account', () => {
    expect(publicRouteDefinitions.some(({ path }) => path === '/legal/cookies')).toBe(true);
  });

  it('shows the localized cookie information on its own page', () => {
    render(<CookieUsagePage />);

    expect(screen.queryByRole('main')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Cookie Usage' })).toBeTruthy();
    expect(screen.getByText(/We save your language and display preferences/)).toBeTruthy();
    // language is switched only with the header globe
    expect(screen.queryByRole('button', { name: 'Bahasa Malaysia' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe('/legal/privacy');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<CookieUsagePage />);
    await expectNoAxeViolations(container);
  });

  it('switches the information across all supported languages', async () => {
    render(<CookieUsagePage />);

    const translations = [
      ['en', 'Cookie Usage', /We save your language and display preferences/],
      ['ms', 'Penggunaan Kuki', /Kami menyimpan pilihan bahasa dan paparan anda/],
      ['zh', 'Cookie 使用说明', /我们会在此浏览器中保存您的语言和显示偏好/],
      ['zh-TW', 'Cookie 使用說明', /我們會在此瀏覽器中保存您的語言和顯示偏好/],
    ] as const;

    // the header globe writes the shared interface locale; the page follows it
    for (const [language, heading, paragraph] of translations) {
      act(() => setActiveLocale(language));
      expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
      expect(screen.getByText(paragraph)).toBeTruthy();
    }

    setActiveLocale('en');
  });
});
