import React from 'react';
import { Link } from '@mui/material';
import {
  LEGAL_DOCUMENT_PATHS,
  type LegalDocumentId,
  type LegalLocale,
  type LocalizedText,
} from '../content';

/** Link text for each placeholder a consent label or notice can contain. */
export const PLACEHOLDER_LABELS: Record<string, LocalizedText> = {
  '{terms}': { en: 'Booking Terms and Conditions', ms: 'Terma dan Syarat Tempahan' },
  '{privacy}': { en: 'Privacy Notice', ms: 'Notis Privasi' },
  '{payment}': { en: 'Payment Terms', ms: 'Terma Pembayaran' },
  '{ekyc}': {
    en: 'the identity verification notice',
    ms: 'notis pengesahan identiti',
  },
};

export const PLACEHOLDER_TARGETS: Record<string, LegalDocumentId> = {
  '{terms}': 'terms_of_service',
  '{privacy}': 'privacy_notice',
  '{payment}': 'payment_terms',
  '{ekyc}': 'ekyc_biometric',
};

const PLACEHOLDER_PATTERN = /(\{terms\}|\{privacy\}|\{payment\}|\{ekyc\})/g;

/**
 * The text as plain prose, with each placeholder replaced by the document it
 * links to. Used for accessible names: stripping the placeholder instead would
 * leave a screen reader announcing "I agree to the , including the cancellation
 * terms".
 */
export function plainLabel(text: string, locale: LegalLocale): string {
  return text
    .replace(PLACEHOLDER_PATTERN, (match) =>
      PLACEHOLDER_LABELS[match] ? PLACEHOLDER_LABELS[match][locale] : match,
    )
    .trim();
}

/**
 * Renders consent text, turning `{terms}` and friends into links that open the
 * document in a new tab.
 *
 * A new tab rather than a navigation on purpose: sending a guest away from a
 * half-filled booking form to read the terms, and losing what they typed, is
 * the reliable way to make them not read the terms.
 */
export function renderLabel(text: string, locale: LegalLocale): React.ReactNode {
  const parts = text.split(PLACEHOLDER_PATTERN);

  return parts.map((part, index) => {
    const target = PLACEHOLDER_TARGETS[part];
    if (!target) return <React.Fragment key={index}>{part}</React.Fragment>;
    const href = LEGAL_DOCUMENT_PATHS[target];
    return (
      <Link
        key={index}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        underline="always"
        sx={{ fontWeight: 600 }}
        // The link sits inside the checkbox's <label>: label activation would
        // otherwise forward the click to the control and toggle consent, so the
        // default is prevented and the document opened by hand — agreeing by
        // accident is not agreement.
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          window.open(href, '_blank', 'noopener,noreferrer');
        }}
      >
        {PLACEHOLDER_LABELS[part][locale]}
      </Link>
    );
  });
}
