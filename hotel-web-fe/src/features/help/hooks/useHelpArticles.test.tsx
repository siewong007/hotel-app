import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { resetLocaleStoreForTests, setActiveLocale } from '../../../i18n/localeStore';
import { ARTICLES_EN } from '../content/articles.en';
import { useHelpArticles } from './useHelpArticles';

afterEach(() => {
  cleanup();
  resetLocaleStoreForTests();
});

function Harness() {
  const articles = useHelpArticles();
  return (
    <div>
      <span data-testid="count">{articles.length}</span>
      <span data-testid="first">{articles[0]?.title ?? ''}</span>
    </div>
  );
}

describe('useHelpArticles', () => {
  it('serves English synchronously, with no chunk to wait for', () => {
    render(<Harness />);
    expect(screen.getByTestId('first').textContent).toBe(ARTICLES_EN[0].title);
  });

  // The load-then-swap path. Only English ships in the app shell, so a reader
  // in another language is served English until that locale's chunk resolves —
  // and the hook has to notice when it does.
  //
  // This is the failure this file exists for: `useLocale()` changes the moment
  // the language is switched, so a snapshot built from the locale CODE is
  // already up to date by the time the articles arrive, `useSyncExternalStore`
  // sees no change and skips the re-render, and Help sits on English forever.
  // Subscribing to the article ARRAY is what makes the swap observable — drop
  // `subscribeToArticles` from the hook and this test fails at the assertion
  // below rather than in setup.
  it('re-renders with the real catalogue once the locale chunk arrives', async () => {
    setActiveLocale('zh');
    render(<Harness />);

    // Served the English fallback while the chunk is in flight.
    expect(screen.getByTestId('first').textContent).toBe(ARTICLES_EN[0].title);

    await waitFor(() => {
      expect(screen.getByTestId('first').textContent).not.toBe(ARTICLES_EN[0].title);
    });
    expect(Number(screen.getByTestId('count').textContent)).toBeGreaterThan(0);
  });
});
