import type { LegalDocumentId, LocalizedText } from './types';

/**
 * A notice-style consent: the documents it covers, and the sentence shown at
 * the moment of the act.
 *
 * This is the alternative to a `ConsentPrompt` list. A prompt list asks for a
 * tick per document; a notice states which documents the act is governed by and
 * takes the act itself — pressing the button — as the agreement.
 *
 * Two things follow, and both are load-bearing:
 *
 * - The sentence MUST be visible next to the control that performs the act.
 *   There is no tick to point at afterwards, so the notice is the entire record
 *   of what the guest was shown. A notice rendered on a different screen, or
 *   below the fold of the button, is not one.
 * - `documents` is what gets written to the consent ledger as granted, so it
 *   must list exactly the documents the sentence names, and no more.
 */
export interface ConsentNoticeContent {
  /** Documents this notice grants, in the order the sentence names them. */
  documents: LegalDocumentId[];
  /** The sentence, with `{terms}` / `{privacy}` placeholders for the links. */
  text: LocalizedText;
}

/**
 * The notice governing account creation.
 *
 * Deliberately no marketing document: marketing is a separate purpose that a
 * guest must be able to decline without declining an account, so it cannot ride
 * along inside a notice covering the act of signing up. It is asked for
 * separately, after sign-in.
 */
export const REGISTRATION_NOTICE: ConsentNoticeContent = {
  documents: ['terms_of_service', 'privacy_notice'],
  text: {
    en: 'By creating an account and using this service, you agree to the {terms} and acknowledge the {privacy}, which describes how your personal data is processed.',
    ms: 'Dengan mencipta akaun dan menggunakan perkhidmatan ini, anda bersetuju dengan {terms} dan mengakui {privacy}, yang menerangkan cara data peribadi anda diproses.',
  },
};
