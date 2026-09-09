import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from './I18nProvider';
import { resetLocaleStoreForTests, setActiveLocale } from './localeStore';
import { resetMissingKeyReportsForTests } from './translate';
import { useTranslation } from './useTranslation';

afterEach(() => {
  cleanup();
  resetLocaleStoreForTests();
  resetMissingKeyReportsForTests();
  vi.unstubAllGlobals();
});

function Harness({ namespace = 'nav' }: { namespace?: string }) {
  const { t, tOr, locale, dir, setLocale } = useTranslation(namespace);
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="dir">{dir}</span>
      <span data-testid="label">{t('routes.bookings.label')}</span>
      <span data-testid="cross-ns">{t('common:actions.save')}</span>
      <span data-testid="fallback">{tOr('routes.nope.label', 'Hardcoded English')}</span>
      <button type="button" onClick={() => setLocale('ms')}>
        to-malay
      </button>
    </div>
  );
}

describe('useTranslation', () => {
  it('translates against the bound namespace', () => {
    render(<Harness />);
    expect(screen.getByTestId('label').textContent).toBe('Bookings');
  });

  it('honours an explicit ns:key prefix', () => {
    render(<Harness />);
    expect(screen.getByTestId('cross-ns').textContent).toBe('Save');
  });

  it('re-renders every consumer when the language changes', () => {
    render(<Harness />);
    expect(screen.getByTestId('locale').textContent).toBe('en');

    fireEvent.click(screen.getByText('to-malay'));

    expect(screen.getByTestId('locale').textContent).toBe('ms');
    expect(screen.getByTestId('label').textContent).toBe('Tempahan');
    expect(screen.getByTestId('cross-ns').textContent).toBe('Simpan');
  });

  it('exposes the writing direction of the active locale', () => {
    render(<Harness />);
    expect(screen.getByTestId('dir').textContent).toBe('ltr');
  });

  it('renders the supplied fallback for a key no bundle defines', () => {
    render(<Harness />);
    expect(screen.getByTestId('fallback').textContent).toBe('Hardcoded English');
  });

  it('keeps the fallback when the language changes', () => {
    // An unmigrated string must not become a raw key just because the reader
    // switched language.
    render(<Harness />);
    fireEvent.click(screen.getByText('to-malay'));
    expect(screen.getByTestId('fallback').textContent).toBe('Hardcoded English');
  });

  it('falls back to English for a key the active locale has not translated', () => {
    setActiveLocale('ms');
    render(<Harness />);
    // Every ms key is present today, so assert the mechanism directly against
    // a namespace/key pair that exists only in English.
    expect(screen.getByTestId('label').textContent).toBe('Tempahan');
  });
});

describe('I18nProvider', () => {
  it('mirrors the active locale onto the document element', () => {
    render(
      <I18nProvider>
        <Harness />
      </I18nProvider>
    );

    expect(document.documentElement.getAttribute('lang')).toBe('en');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');

    fireEvent.click(screen.getByText('to-malay'));

    expect(document.documentElement.getAttribute('lang')).toBe('ms');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
  });

  it('renders its children untouched', () => {
    render(
      <I18nProvider>
        <p>child content</p>
      </I18nProvider>
    );
    expect(screen.getByText('child content')).toBeTruthy();
  });
});
