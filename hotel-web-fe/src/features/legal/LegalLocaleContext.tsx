import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { LegalLocale } from './content';

const STORAGE_KEY = 'legal-locale';

interface LegalLocaleValue {
  locale: LegalLocale;
  setLocale: (locale: LegalLocale) => void;
}

const LegalLocaleContext = createContext<LegalLocaleValue | undefined>(undefined);

function readStoredLocale(): LegalLocale {
  // Guarded: storage throws in private-mode and non-DOM runtimes, and the
  // consent UI must still render if it does.
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'ms') return stored;
    // Fall back to the browser's own preference before defaulting.
    if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ms')) {
      return 'ms';
    }
  } catch {
    // Ignore and use the default.
  }
  return 'en';
}

/**
 * Holds which language the legal text is displayed in.
 *
 * This is not cosmetic: the chosen locale is written into the consent record,
 * because PDPA s.7(2) requires the notice in both Bahasa Malaysia and English
 * and the evidence should say which one the guest actually read.
 */
export const LegalLocaleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<LegalLocale>(readStoredLocale);

  const setLocale = useCallback((next: LegalLocale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // A remembered preference is a convenience; failing to store it must not
      // break the page.
    }
  }, []);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LegalLocaleContext.Provider value={value}>{children}</LegalLocaleContext.Provider>;
};

/**
 * Returns the active legal locale. Usable outside the provider — the consent
 * blocks appear on public pages that do not all mount it — in which case it
 * falls back to the stored preference and a no-op setter.
 */
export function useLegalLocale(): LegalLocaleValue {
  const context = useContext(LegalLocaleContext);
  const [standaloneLocale, setStandaloneLocale] = useState<LegalLocale>(readStoredLocale);

  const standaloneSet = useCallback((next: LegalLocale) => {
    setStandaloneLocale(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // See above.
    }
  }, []);

  const fallback = useMemo(
    () => ({ locale: standaloneLocale, setLocale: standaloneSet }),
    [standaloneLocale, standaloneSet],
  );

  return context ?? fallback;
}
