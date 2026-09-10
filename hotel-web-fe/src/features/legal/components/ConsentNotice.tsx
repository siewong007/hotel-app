import React from 'react';
import { Box, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import {
  CONSENT_RECORD_NOTE,
  LEGAL_LOCALES,
  LEGAL_LOCALE_LABELS,
  type LegalLocale,
} from '../content';
import type { ConsentNoticeContent } from '../content/consentNotice';
import { useLegalLocale } from '../LegalLocaleContext';
import { renderLabel } from './legalLinks';

export interface ConsentNoticeProps {
  notice: ConsentNoticeContent;
  /** Hide the language switch where the page already offers one. */
  hideLocaleToggle?: boolean;
}

/**
 * The consent notice shown immediately beneath the control that acts on it.
 *
 * There is no tick here, so placement is the guarantee: this must render next to
 * the button it governs, close enough that a guest cannot press it without the
 * sentence in view. Put it anywhere else and there is nothing that evidences
 * what they were shown.
 *
 * The locale toggle stays, for the same reason the checkbox block has one — the
 * record pins the locale the sentence was read in, so the guest has to be able
 * to choose it.
 */
export const ConsentNotice: React.FC<ConsentNoticeProps> = ({ notice, hideLocaleToggle }) => {
  const { locale, setLocale } = useLegalLocale();

  return (
    <Box sx={{ mt: 1.5 }}>
      {!hideLocaleToggle && (
        <Stack direction="row" sx={{ justifyContent: 'flex-end', mb: 0.5 }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={locale}
            onChange={(_event, next) => next && setLocale(next as LegalLocale)}
            aria-label={locale === 'ms' ? 'Bahasa notis undang-undang' : 'Legal notice language'}
          >
            {LEGAL_LOCALES.map((option) => (
              <ToggleButton key={option} value={option} sx={{ px: 1.5, py: 0.25, fontSize: '0.7rem' }}>
                {LEGAL_LOCALE_LABELS[option]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Stack>
      )}

      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', lineHeight: 1.6 }}>
        {renderLabel(notice.text[locale], locale)}
      </Typography>

      <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
        {CONSENT_RECORD_NOTE[locale]}
      </Typography>
    </Box>
  );
};

export default ConsentNotice;
