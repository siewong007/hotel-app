import React from 'react';
import {
  Box,
  Container,
  Divider,
  Link,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import {
  HOTEL_LEGAL_IDENTITY,
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_PATHS,
  LEGAL_LOCALES,
  LEGAL_LOCALE_LABELS,
  type LegalDocumentId,
  type LegalLocale,
} from '../content';
import { useLegalLocale } from '../LegalLocaleContext';

const SIBLING_LINKS: { id: LegalDocumentId; label: Record<LegalLocale, string> }[] = [
  { id: 'terms_of_service', label: { en: 'Booking Terms', ms: 'Terma Tempahan' } },
  { id: 'privacy_notice', label: { en: 'Privacy Notice', ms: 'Notis Privasi' } },
  { id: 'payment_terms', label: { en: 'Payment Terms', ms: 'Terma Pembayaran' } },
  {
    id: 'ekyc_biometric',
    label: { en: 'Identity Verification', ms: 'Pengesahan Identiti' },
  },
];

/**
 * Renders one legal document in the reader's chosen language.
 *
 * These pages are public and unauthenticated by design: a guest must be able to
 * read what they are agreeing to before they have an account, and a consent
 * checkbox that links somewhere you need to log in to read is not informed
 * consent.
 */
export const LegalDocumentPage: React.FC<{ documentId: LegalDocumentId }> = ({ documentId }) => {
  const { locale, setLocale } = useLegalLocale();
  const document = LEGAL_DOCUMENTS[documentId];

  if (!document) {
    return (
      <Container maxWidth="md" sx={{ py: 6 }}>
        <Typography variant="h5">Document not found</Typography>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: { xs: 3, md: 6 } }}>
      <Paper elevation={0} sx={{ p: { xs: 2.5, md: 5 }, border: 1, borderColor: 'divider' }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          sx={{ justifyContent: 'space-between', alignItems: { sm: 'flex-start' }, gap: 2 }}
        >
          <Box>
            <Typography variant="overline" sx={{ color: 'text.secondary' }}>
              {HOTEL_LEGAL_IDENTITY.tradingName}
            </Typography>
            <Typography variant="h4" component="h1" sx={{ fontWeight: 700, mt: 0.5 }}>
              {document.title[locale]}
            </Typography>
          </Box>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={locale}
            onChange={(_event, next) => next && setLocale(next as LegalLocale)}
            aria-label={locale === 'ms' ? 'Bahasa dokumen' : 'Document language'}
          >
            {LEGAL_LOCALES.map((option) => (
              <ToggleButton key={option} value={option} sx={{ px: 1.5 }}>
                {LEGAL_LOCALE_LABELS[option]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Stack>

        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
          {locale === 'ms'
            ? `Versi ${document.version} · Berkuat kuasa ${document.effectiveDate}`
            : `Version ${document.version} · Effective ${document.effectiveDate}`}
        </Typography>

        <Typography sx={{ mt: 3, fontSize: '1.05rem', lineHeight: 1.75 }}>
          {document.summary[locale]}
        </Typography>

        <Divider sx={{ my: 4 }} />

        <Stack sx={{ gap: 4 }}>
          {document.sections.map((section) => (
            <Box key={section.id} id={section.id} component="section">
              <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 1.5 }}>
                {section.heading[locale]}
              </Typography>
              {section.body?.map((paragraph, index) => (
                <Typography key={index} sx={{ mb: 1.5, lineHeight: 1.8 }}>
                  {paragraph[locale]}
                </Typography>
              ))}
              {section.bullets && section.bullets.length > 0 && (
                <Stack component="ul" sx={{ m: 0, pl: 3, gap: 1 }}>
                  {section.bullets.map((bullet, index) => (
                    <Typography key={index} component="li" sx={{ lineHeight: 1.8 }}>
                      {bullet[locale]}
                    </Typography>
                  ))}
                </Stack>
              )}
            </Box>
          ))}
        </Stack>

        <Divider sx={{ my: 4 }} />

        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
          {locale === 'ms' ? 'Hubungi kami' : 'Contact us'}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.9 }}>
          {HOTEL_LEGAL_IDENTITY.registeredName}
          <br />
          {HOTEL_LEGAL_IDENTITY.addressLines.map((line) => (
            <React.Fragment key={line}>
              {line}
              <br />
            </React.Fragment>
          ))}
          <Link href={`mailto:${HOTEL_LEGAL_IDENTITY.email}`}>{HOTEL_LEGAL_IDENTITY.email}</Link>
          {' · '}
          <Link href={`tel:${HOTEL_LEGAL_IDENTITY.phone.replace(/\s/g, '')}`}>
            {HOTEL_LEGAL_IDENTITY.phone}
          </Link>
        </Typography>

        <Divider sx={{ my: 4 }} />

        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2 }}>
          {SIBLING_LINKS.filter((entry) => entry.id !== documentId).map((entry) => (
            <Link key={entry.id} href={LEGAL_DOCUMENT_PATHS[entry.id]} variant="body2">
              {entry.label[locale]}
            </Link>
          ))}
        </Stack>
      </Paper>
    </Container>
  );
};

export default LegalDocumentPage;
