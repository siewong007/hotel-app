import type { LocaleCode } from '../../../i18n';

/**
 * Legal content primitives, in all four interface languages.
 *
 * Malaysia's Personal Data Protection Act 2010 (Act 709) s.7(2) requires the
 * written notice given to a data subject to be in BOTH the national language
 * (Bahasa Malaysia) and English — en and ms are the mandatory pair; zh and
 * zh-TW ride along because every supported interface language gets the corpus.
 * `LocalizedText` has no optional side on purpose, so a missing translation is
 * a type error rather than a silent compliance gap — and a consent record can
 * never claim a language the text does not exist in.
 */

export type LegalLocale = LocaleCode;

export const LEGAL_LOCALES: readonly LegalLocale[] = ['en', 'ms', 'zh', 'zh-TW'] as const;

export const LEGAL_LOCALE_LABELS: Record<LegalLocale, string> = {
  en: 'English',
  ms: 'Bahasa Malaysia',
  zh: '简体中文',
  'zh-TW': '繁體中文',
};

export interface LocalizedText {
  en: string;
  ms: string;
  zh: string;
  'zh-TW': string;
}

/**
 * Identifies a consentable document. These values are the wire contract with
 * the backend: they must stay in step with `ConsentDocument` in
 * `hotel-app-be/src/models/consent.rs` and with the `document_type` CHECK
 * constraint on `public.consent_records`.
 */
export type LegalDocumentId =
  | 'terms_of_service'
  | 'privacy_notice'
  | 'payment_terms'
  | 'ekyc_biometric'
  | 'marketing';

export interface LegalSection {
  /** Stable anchor id, used for deep links such as /legal/privacy#retention. */
  id: string;
  heading: LocalizedText;
  /** Ordered paragraphs. */
  body?: LocalizedText[];
  /** Ordered bullet points rendered after `body`. */
  bullets?: LocalizedText[];
  /**
   * Presentation hint: 'requirement' renders the section as a callout for
   * obligations the guest must meet (payment, cancellation); 'info' marks
   * helpful context. Absent = plain section. Metadata only — never changes
   * wording, so it does not trigger a consent version bump.
   */
  emphasis?: 'requirement' | 'info';
}

export interface LegalDocument {
  id: LegalDocumentId;
  /**
   * ISO date. A consent record pins the version the guest actually saw, so
   * bumping this string starts a new consent generation — never edit a
   * published document's text without also bumping its version.
   */
  version: string;
  effectiveDate: string;
  title: LocalizedText;
  /** One-paragraph plain-language summary shown above the full text. */
  summary: LocalizedText;
  sections: LegalSection[];
}

export function localize(text: LocalizedText, locale: LegalLocale): string {
  return text[locale];
}
