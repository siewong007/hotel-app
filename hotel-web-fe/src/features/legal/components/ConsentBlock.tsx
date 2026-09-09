import React from 'react';
import {
  Alert,
  Box,
  Checkbox,
  FormControlLabel,
  FormHelperText,
  Link,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import {
  CONSENT_RECORD_NOTE,
  LEGAL_DOCUMENT_PATHS,
  LEGAL_LOCALES,
  LEGAL_LOCALE_LABELS,
  type ConsentPrompt,
  type LegalDocumentId,
  type LegalLocale,
  type LocalizedText,
} from '../content';
import { useLegalLocale } from '../LegalLocaleContext';
import type { ConsentState } from '../useConsent';

/** Link text for each placeholder a prompt can contain. */
const PLACEHOLDER_LABELS: Record<string, LocalizedText> = {
  '{terms}': { en: 'Booking Terms and Conditions', ms: 'Terma dan Syarat Tempahan' },
  '{privacy}': { en: 'Privacy Notice', ms: 'Notis Privasi' },
  '{payment}': { en: 'Payment Terms', ms: 'Terma Pembayaran' },
  '{ekyc}': {
    en: 'the identity verification notice',
    ms: 'notis pengesahan identiti',
  },
};

const PLACEHOLDER_TARGETS: Record<string, LegalDocumentId> = {
  '{terms}': 'terms_of_service',
  '{privacy}': 'privacy_notice',
  '{payment}': 'payment_terms',
  '{ekyc}': 'ekyc_biometric',
};

/**
 * The label as plain text, with each placeholder replaced by the document it
 * links to. Used for the checkbox's accessible name: stripping the placeholder
 * instead would leave a screen reader announcing "I agree to the , including
 * the cancellation terms".
 */
function plainLabel(text: string, locale: LegalLocale): string {
  return text
    .replace(/(\{terms\}|\{privacy\}|\{payment\}|\{ekyc\})/g, (match) =>
      PLACEHOLDER_LABELS[match] ? PLACEHOLDER_LABELS[match][locale] : match,
    )
    .trim();
}

/**
 * Renders a consent label, turning `{terms}` and friends into links that open
 * the document in a new tab.
 *
 * A new tab rather than a navigation on purpose: sending a guest away from a
 * half-filled booking form to read the terms, and losing what they typed, is
 * the reliable way to make them not read the terms.
 */
function renderLabel(text: string, locale: LegalLocale): React.ReactNode {
  const pattern = /(\{terms\}|\{privacy\}|\{payment\}|\{ekyc\})/g;
  const parts = text.split(pattern);

  return parts.map((part, index) => {
    const target = PLACEHOLDER_TARGETS[part];
    if (!target) return <React.Fragment key={index}>{part}</React.Fragment>;
    return (
      <Link
        key={index}
        href={LEGAL_DOCUMENT_PATHS[target]}
        target="_blank"
        rel="noopener noreferrer"
        underline="always"
sx={{ fontWeight: 600 }}
      >
        {PLACEHOLDER_LABELS[part][locale]}
      </Link>
    );
  });
}

export interface ConsentBlockProps {
  prompts: ConsentPrompt[];
  state: ConsentState;
  /** Extra points shown above the checkboxes (payment and eKYC use this). */
  keyPoints?: LocalizedText[];
  /** Hide the language switch where the page already offers one. */
  hideLocaleToggle?: boolean;
  /** Optional heading above the block. */
  title?: LocalizedText;
}

/**
 * The consent checkboxes shown wherever personal data is collected.
 *
 * Every box starts unticked and each purpose gets its own box — bundling
 * marketing into the terms checkbox is what makes consent invalid under the
 * PDPA, not merely impolite.
 */
export const ConsentBlock: React.FC<ConsentBlockProps> = ({
  prompts,
  state,
  keyPoints,
  hideLocaleToggle,
  title,
}) => {
  const { locale, setLocale } = useLegalLocale();

  return (
    <Box sx={{ mt: 3 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1, mb: 1 }}
      >
        {title ? (
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {title[locale]}
          </Typography>
        ) : (
          <span />
        )}
        {!hideLocaleToggle && (
          <ToggleButtonGroup
            size="small"
            exclusive
            value={locale}
            onChange={(_event, next) => next && setLocale(next as LegalLocale)}
            aria-label="Legal notice language"
          >
            {LEGAL_LOCALES.map((option) => (
              <ToggleButton key={option} value={option} sx={{ px: 1.5, py: 0.25, fontSize: '0.7rem' }}>
                {LEGAL_LOCALE_LABELS[option]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        )}
      </Stack>

      {keyPoints && keyPoints.length > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <Stack component="ul" sx={{ m: 0, pl: 2, gap: 0.5 }}>
            {keyPoints.map((point, index) => (
              <Typography key={index} component="li" variant="body2">
                {point[locale]}
              </Typography>
            ))}
          </Stack>
        </Alert>
      )}

      <Stack sx={{ gap: 0.5 }}>
        {prompts.map((prompt) => {
          const isMissing = state.showErrors && state.missing.includes(prompt.documentId);
          return (
            <Box key={prompt.documentId}>
              <FormControlLabel
                sx={{ alignItems: 'flex-start', m: 0 }}
                control={
                  <Checkbox
                    checked={Boolean(state.checked[prompt.documentId])}
                    onChange={(event) => state.toggle(prompt.documentId, event.target.checked)}
                    sx={{ pt: 0.25 }}
                    slotProps={{
                      input: {
                        'aria-label': plainLabel(prompt.label[locale], locale),
                        'aria-required': prompt.required,
                      },
                    }}
                    color={isMissing ? 'error' : 'primary'}
                  />
                }
                label={
                  <Typography variant="body2" sx={{ pt: 0.75 }}>
                    {renderLabel(prompt.label[locale], locale)}
                    {prompt.required && (
                      <Box component="span" sx={{ color: 'error.main' }} aria-hidden>
                        {' *'}
                      </Box>
                    )}
                  </Typography>
                }
              />
              {prompt.helper && (
                <FormHelperText sx={{ ml: 4, mt: -0.5 }}>{prompt.helper[locale]}</FormHelperText>
              )}
              {isMissing && (
                <FormHelperText error sx={{ ml: 4 }}>
                  {locale === 'ms'
                    ? 'Anda perlu bersetuju dengan perkara ini untuk meneruskan.'
                    : 'You need to agree to this before you can continue.'}
                </FormHelperText>
              )}
            </Box>
          );
        })}
      </Stack>

      <Typography variant="caption" sx={{ display: 'block', mt: 1.5, color: 'text.secondary' }}>
        {CONSENT_RECORD_NOTE[locale]}
      </Typography>
    </Box>
  );
};

export default ConsentBlock;
