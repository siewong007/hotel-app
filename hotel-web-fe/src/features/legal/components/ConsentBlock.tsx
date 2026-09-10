import React from 'react';
import {
  Alert,
  Box,
  Checkbox,
  FormControlLabel,
  FormHelperText,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import {
  CONSENT_RECORD_NOTE,
  LEGAL_LOCALES,
  LEGAL_LOCALE_LABELS,
  type ConsentPrompt,
  type LegalLocale,
  type LocalizedText,
} from '../content';
// The placeholder-to-link rendering is shared with ConsentNotice, so both
// styles of consent draw the same links to the same documents.
import { plainLabel, renderLabel } from './legalLinks';
import { useLegalLocale } from '../LegalLocaleContext';
import type { ConsentState } from '../useConsent';

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
            aria-label={locale === 'ms' ? 'Bahasa notis undang-undang' : 'Legal notice language'}
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
