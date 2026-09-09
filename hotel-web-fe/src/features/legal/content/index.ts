export * from './types';
export * from './hotelIdentity';
export * from './consentPrompts';
export { termsOfService, TERMS_OF_SERVICE_VERSION } from './termsOfService';
export { privacyNotice, PRIVACY_NOTICE_VERSION } from './privacyNotice';
export { paymentTerms, PAYMENT_TERMS_VERSION, PAYMENT_KEY_POINTS } from './paymentTerms';
export { ekycConsent, EKYC_CONSENT_VERSION, EKYC_KEY_POINTS } from './ekycConsent';

import { ekycConsent, EKYC_CONSENT_VERSION } from './ekycConsent';
import { paymentTerms, PAYMENT_TERMS_VERSION } from './paymentTerms';
import { privacyNotice, PRIVACY_NOTICE_VERSION } from './privacyNotice';
import { termsOfService, TERMS_OF_SERVICE_VERSION } from './termsOfService';
import type { LegalDocument, LegalDocumentId } from './types';

/**
 * Marketing consent has no long-form document of its own — the marketing
 * purpose is described in the privacy notice, and the checkbox wording is the
 * notice. It still needs a version so a marketing consent record can be pinned
 * to the wording the guest actually saw, so it tracks the privacy notice.
 */
export const MARKETING_CONSENT_VERSION = PRIVACY_NOTICE_VERSION;

export const CONSENT_DOCUMENT_VERSIONS: Record<LegalDocumentId, string> = {
  terms_of_service: TERMS_OF_SERVICE_VERSION,
  privacy_notice: PRIVACY_NOTICE_VERSION,
  payment_terms: PAYMENT_TERMS_VERSION,
  ekyc_biometric: EKYC_CONSENT_VERSION,
  marketing: MARKETING_CONSENT_VERSION,
};

/** Documents that have full renderable text. `marketing` deliberately has none. */
export const LEGAL_DOCUMENTS: Partial<Record<LegalDocumentId, LegalDocument>> = {
  terms_of_service: termsOfService,
  privacy_notice: privacyNotice,
  payment_terms: paymentTerms,
  ekyc_biometric: ekycConsent,
};

/** Public route each document is published at. */
export const LEGAL_DOCUMENT_PATHS: Record<LegalDocumentId, string> = {
  terms_of_service: '/legal/terms',
  privacy_notice: '/legal/privacy',
  payment_terms: '/legal/payment-terms',
  ekyc_biometric: '/legal/identity-verification',
  marketing: '/legal/privacy',
};
