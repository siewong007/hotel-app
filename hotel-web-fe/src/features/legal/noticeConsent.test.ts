import { describe, expect, it } from 'vitest';
import { CONSENT_DOCUMENT_VERSIONS, REGISTRATION_NOTICE } from './content';
import { buildNoticeConsentPayload } from './noticeConsent';

describe('buildNoticeConsentPayload', () => {
  it('grants every document the notice names, pinned to its published version', () => {
    expect(buildNoticeConsentPayload(REGISTRATION_NOTICE, 'en')).toEqual({
      consents: [
        {
          document: 'terms_of_service',
          version: CONSENT_DOCUMENT_VERSIONS.terms_of_service,
          granted: true,
          locale: 'en',
        },
        {
          document: 'privacy_notice',
          version: CONSENT_DOCUMENT_VERSIONS.privacy_notice,
          granted: true,
          locale: 'en',
        },
      ],
      marketing_opt_in: false,
    });
  });

  it('records the locale the sentence was read in', () => {
    // PDPA s.7(2) wants the notice in both languages, so the evidence has to
    // say which one was actually on screen.
    const payload = buildNoticeConsentPayload(REGISTRATION_NOTICE, 'ms');

    expect(payload.consents.map((consent) => consent.locale)).toEqual(['ms', 'ms']);
  });

  it('never opts a guest into marketing', () => {
    // Declining marketing must never mean declining an account, so a notice
    // covering the act of signing up cannot carry it.
    for (const locale of ['en', 'ms'] as const) {
      expect(buildNoticeConsentPayload(REGISTRATION_NOTICE, locale).marketing_opt_in).toBe(false);
    }
  });
});

describe('REGISTRATION_NOTICE', () => {
  it('grants exactly the documents its sentence links to', () => {
    // The sentence is the only thing the guest sees, so a document granted
    // without being named in it would be consent to unseen text -- and one
    // named without being granted would fail the backend's require_consents.
    const linked = [...REGISTRATION_NOTICE.text.en.matchAll(/\{(\w+)\}/g)].map(
      (match) => match[1]
    );

    expect(linked).toEqual(['terms', 'privacy']);
    expect(REGISTRATION_NOTICE.documents).toEqual(['terms_of_service', 'privacy_notice']);
  });

  it('says the same thing in both languages, linking the same two documents', () => {
    const placeholders = (text: string) =>
      [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);

    expect(placeholders(REGISTRATION_NOTICE.text.ms)).toEqual(
      placeholders(REGISTRATION_NOTICE.text.en)
    );
  });

  it('carries no marketing document', () => {
    expect(REGISTRATION_NOTICE.documents).not.toContain('marketing');
  });
});
