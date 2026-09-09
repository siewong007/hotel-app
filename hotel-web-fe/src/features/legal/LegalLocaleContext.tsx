import React, { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from 'react';
import {
  getActiveLocale,
  setActiveLocale,
  subscribeToLocale,
} from '../../i18n/localeStore';
import type { LegalLocale } from './content';

interface LegalLocaleValue {
  locale: LegalLocale;
  setLocale: (locale: LegalLocale) => void;
}

const LegalLocaleContext = createContext<LegalLocaleValue | undefined>(undefined);

/**
 * Holds which language the legal text is displayed in.
 *
 * This is not cosmetic: the chosen locale is written into the consent record,
 * because PDPA s.7(2) requires the notice in both Bahasa Malaysia and English
 * and the evidence should say which one the guest actually read.
 *
 * The interface language store is the single source of truth — a guest who
 * picks Bahasa Melayu in the header (or on these EN/MS toggles) must see the
 * terms in that language, and the payload must record that same code. A second
 * `legal-locale` store was what made the checkbox language and the recorded
 * locale diverge.
 */
export const LegalLocaleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const value = useSharedLegalLocale();
  return <LegalLocaleContext.Provider value={value}>{children}</LegalLocaleContext.Provider>;
};

function useSharedLegalLocale(): LegalLocaleValue {
  const locale = useSyncExternalStore(subscribeToLocale, getActiveLocale, getActiveLocale);
  const setLocale = useCallback((next: LegalLocale) => {
    setActiveLocale(next);
  }, []);
  return useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
}

/**
 * Returns the active legal locale. Usable outside the provider — the consent
 * blocks appear on public pages that do not all mount it — in which case it
 * still reads the shared interface language so a parent `buildPayload` and the
 * checkboxes cannot disagree.
 */
export function useLegalLocale(): LegalLocaleValue {
  const context = useContext(LegalLocaleContext);
  const fallback = useSharedLegalLocale();
  return context ?? fallback;
}
