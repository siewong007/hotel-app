/**
 * Builds the consent payload for a notice-style consent.
 *
 * `useConsent` deliberately has no way to produce a granted payload without a
 * tick — its whole design is that no box starts ticked. A notice grants its
 * documents from a different act (pressing the button under the sentence), so
 * it needs its own builder rather than a flag that would let any caller
 * pre-grant a checkbox flow by accident.
 *
 * The versions come from the same `CONSENT_DOCUMENT_VERSIONS` map the checkbox
 * flows pin, so a notice-derived record is pinned to the wording published at
 * the time exactly as a ticked one is.
 */

import { CONSENT_DOCUMENT_VERSIONS, type LegalLocale } from './content';
import type { ConsentNoticeContent } from './content/consentNotice';
import type { ConsentAcceptance, ConsentPayload } from './useConsent';

export function buildNoticeConsentPayload(
  notice: ConsentNoticeContent,
  locale: LegalLocale,
): ConsentPayload {
  return {
    consents: notice.documents.map(
      (document): ConsentAcceptance => ({
        // `marketing` is excluded from ConsentAcceptance's document type, and a
        // notice must never carry it — see REGISTRATION_NOTICE.
        document: document as ConsentAcceptance['document'],
        version: CONSENT_DOCUMENT_VERSIONS[document],
        granted: true,
        locale,
      }),
    ),
    // Never opted in by a notice. Marketing is asked for separately so that
    // declining it cannot mean declining an account.
    marketing_opt_in: false,
  };
}
