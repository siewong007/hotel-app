import React from 'react';
import { Box, Typography } from '@mui/material';
import {
  CONSENT_RECORD_NOTE,
} from '../content';
import type { ConsentNoticeContent } from '../content/consentNotice';
import { useLegalLocale } from '../LegalLocaleContext';
import { translateFor } from '../../../i18n';
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
 * The record pins the locale the sentence was read in: the guest chooses it
 * with the header globe (the shared interface locale), not an in-block toggle.
 */
export const ConsentNotice: React.FC<ConsentNoticeProps> = ({ notice, hideLocaleToggle }) => {
  const { locale } = useLegalLocale();
  // Chrome follows the corpus locale (en/ms) — the language the notice was
  // read in — not the interface locale.
  const lt = (key: string) => translateFor(locale, key, undefined, 'legal');

  return (
    <Box sx={{ mt: 1.5 }}>
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
