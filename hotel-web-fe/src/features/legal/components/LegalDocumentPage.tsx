import React from 'react';
import {
  Box,
  Button,
  Container,
  Divider,
  Link,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import GavelOutlinedIcon from '@mui/icons-material/GavelOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useNavigate } from '../../../router';
import {
  HOTEL_LEGAL_IDENTITY,
  LEGAL_DOCUMENT_PATHS,
  LEGAL_LOCALES,
  LEGAL_LOCALE_LABELS,
  getLegalDocuments,
  type LegalDocumentId,
  type LegalLocale,
} from '../content';
import { useLegalLocale } from '../LegalLocaleContext';
import { returnToPreviousPage } from '../../../utils/returnNavigation';

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
 * Boutique reading palette, borrowed from the guest sign-in experience rather
 * than invented: deep green ink `#102a21` / `#315b4b` and gold `#d9b574` on
 * warm paper (see `.auth-card` / `.auth-heading` in `index.css`). These values
 * are light-mode only — dark and night modes fall back to theme tokens
 * (`background.paper`, `text.primary`, `divider`) so the page stays legible in
 * every palette.
 */
const LEGAL_SERIF = 'Georgia, "Times New Roman", serif';
const LEGAL_INK = '#102a21';
const LEGAL_GREEN = '#315b4b';
const LEGAL_GOLD = '#d9b574';
const LEGAL_DEEP_GOLD = '#a4732e';
const LEGAL_PAPER = '#fdfbf6';
const LEGAL_FRAME_LINE = 'rgba(49,91,75,0.14)';
const LEGAL_HAIRLINE = 'rgba(49,91,75,0.16)';
const LEGAL_GOLD_WASH = 'rgba(217,181,116,0.07)';

const hairlineColor = (theme: Theme): string =>
  theme.palette.mode === 'light' ? LEGAL_HAIRLINE : theme.palette.divider;

/**
 * The quiet bordered block shared by the "In this document" rail and the
 * contact callout — a hairline frame with no fill, so it reads as page
 * furniture rather than a card.
 */
const quietFrameSx = (theme: Theme) => ({
  maxWidth: '68ch',
  px: { xs: 2, sm: 3 },
  py: { xs: 1.5, sm: 2 },
  border: '1px solid',
  borderColor: hairlineColor(theme),
  borderRadius: 2,
});

/**
 * Accent for an emphasis callout: deep gold flags an obligation the guest
 * must meet, house green flags helpful context. Dark and night modes defer
 * to the palette's warning/info tokens, matching how the rest of this page
 * falls back to theme colors once the fixed hues lose contrast.
 */
const emphasisAccent = (theme: Theme, emphasis: 'requirement' | 'info'): string =>
  emphasis === 'requirement'
    ? theme.palette.mode === 'light'
      ? LEGAL_DEEP_GOLD
      : theme.palette.warning.main
    : theme.palette.mode === 'light'
      ? LEGAL_GREEN
      : theme.palette.info.main;

const paperFrameSx = (theme: Theme) => ({
  p: { xs: 2.5, sm: 4, md: 6 },
  border: '1px solid',
  borderColor: theme.palette.mode === 'light' ? LEGAL_FRAME_LINE : 'divider',
  borderRadius: 3,
  bgcolor: theme.palette.mode === 'light' ? LEGAL_PAPER : 'background.paper',
});

const eyebrowSx = (theme: Theme) => ({
  display: 'block',
  fontSize: '0.6875rem',
  fontWeight: 700,
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  color: theme.palette.mode === 'light' ? LEGAL_GREEN : 'text.secondary',
});

const documentTitleSx = (theme: Theme) => ({
  mt: 0.75,
  fontFamily: LEGAL_SERIF,
  fontSize: { xs: '1.75rem', sm: '2rem', md: '2.125rem' },
  fontWeight: 400,
  letterSpacing: '-0.02em',
  lineHeight: 1.2,
  color: theme.palette.mode === 'light' ? LEGAL_INK : 'text.primary',
});

const sectionHeadingSx = (theme: Theme) => ({
  mt: 0,
  mb: 2,
  fontFamily: LEGAL_SERIF,
  fontSize: '1.35rem',
  fontWeight: 400,
  letterSpacing: '-0.01em',
  lineHeight: 1.3,
  color: theme.palette.mode === 'light' ? LEGAL_INK : 'text.primary',
});

const NUMERAL_PREFIX = /^(\d+)\.\s*(.*)$/;

/**
 * Splits "4. Cancellation, changes and no-shows" into ("4.", "Cancellation…")
 * for display only — the localized string keeps its numbering, the renderer
 * just gets to style the numeral separately (gold serif in the heading,
 * supplied by the ordered list in the contents rail).
 */
function splitHeadingNumeral(heading: string): { numeral: string | null; text: string } {
  const match = NUMERAL_PREFIX.exec(heading);
  if (!match) return { numeral: null, text: heading };
  return { numeral: `${match[1]}.`, text: match[2] };
}

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
  const navigate = useNavigate();
  // The terms disclose the configured business registration number, which the
  // boot-time `settings/public` fetch may deliver after this page has already
  // mounted. Re-resolving on `hotelSettingsChange` keeps a reader from being
  // left looking at the compiled-in fallback.
  const [documents, setDocuments] = React.useState(getLegalDocuments);
  React.useEffect(() => {
    const refresh = () => setDocuments(getLegalDocuments());
    window.addEventListener('hotelSettingsChange', refresh);
    return () => window.removeEventListener('hotelSettingsChange', refresh);
  }, []);
  const document = documents[documentId];
  const backLabel = locale === 'ms' ? 'Kembali' : 'Back';

  if (!document) {
    return (
      <Container maxWidth="md" sx={{ py: { xs: 4, md: 8 } }}>
        <Paper elevation={0} sx={paperFrameSx}>
          <Typography component="span" sx={eyebrowSx}>
            {HOTEL_LEGAL_IDENTITY.tradingName}
          </Typography>
          <Typography variant="h4" component="h1" sx={documentTitleSx}>
            {locale === 'ms' ? 'Dokumen tidak dijumpai' : 'Document not found'}
          </Typography>
          <Typography sx={{ color: 'text.secondary', mt: 1.5 }}>
            {locale === 'ms'
              ? 'Dokumen yang anda cari tidak wujud atau telah dialihkan. Dokumen undang-undang kami yang lain tersedia di bawah.'
              : 'The document you are looking for does not exist or has moved. Our other legal documents are below.'}
          </Typography>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2, mt: 3, alignItems: 'center' }}>
            <Button
              startIcon={<ArrowBackIcon />}
              onClick={() => returnToPreviousPage(navigate)}
            >
              {backLabel}
            </Button>
            {SIBLING_LINKS.map((entry) => (
              <Link key={entry.id} href={LEGAL_DOCUMENT_PATHS[entry.id]} variant="body2">
                {entry.label[locale]}
              </Link>
            ))}
          </Stack>
        </Paper>
      </Container>
    );
  }

  return (
    <Container
      maxWidth="md"
      sx={{ py: { xs: 3, md: 6 } }}
      // The language toggle swaps the prose client-side, so `lang` has to live
      // on the page — a screen reader that keeps announcing Malay pronunciation
      // over English text is how "accessible" becomes unusable.
      lang={locale}
    >
      <Paper elevation={0} sx={paperFrameSx}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => returnToPreviousPage(navigate)}
          sx={{ mb: 2, ml: -1 }}
        >
          {backLabel}
        </Button>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          sx={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 2 }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography component="span" sx={eyebrowSx}>
              {HOTEL_LEGAL_IDENTITY.tradingName}
            </Typography>
            <Typography variant="h4" component="h1" sx={documentTitleSx}>
              {document.title[locale]}
            </Typography>
          </Box>
          {/* Own row on xs via the column direction above; sits at the top-right
              of the masthead from sm up. */}
          <ToggleButtonGroup
            size="small"
            exclusive
            value={locale}
            onChange={(_event, next) => next && setLocale(next as LegalLocale)}
            aria-label={locale === 'ms' ? 'Bahasa dokumen' : 'Document language'}
            sx={{ flexShrink: 0 }}
          >
            {LEGAL_LOCALES.map((option) => (
              <ToggleButton key={option} value={option} sx={{ px: 1.5 }}>
                {LEGAL_LOCALE_LABELS[option]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Stack>

        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1.5 }}>
          {locale === 'ms'
            ? `Versi ${document.version} · Berkuat kuasa ${document.effectiveDate}`
            : `Version ${document.version} · Effective ${document.effectiveDate}`}
        </Typography>

        <Typography sx={{ mt: 3, fontSize: '1.05rem', lineHeight: 1.8, color: 'text.primary', maxWidth: '68ch' }}>
          {document.summary[locale]}
        </Typography>

        {document.sections.length > 1 ? (
          <Box
            component="nav"
            aria-label={locale === 'ms' ? 'Kandungan dokumen' : 'Document contents'}
            sx={(theme) => ({ mt: 4, ...quietFrameSx(theme) })}
          >
            <Typography sx={(theme) => ({ ...eyebrowSx(theme), mb: 1 })}>
              {locale === 'ms' ? 'Dalam dokumen ini' : 'In this document'}
            </Typography>
            <Box
              component="ol"
              sx={(theme) => ({
                m: 0,
                // Two-digit markers ("14.") are ~18px wide; pl:2.5 (20px)
                // leaves almost no gap before the link text.
                pl: 3,
                '& li::marker': {
                  fontFamily: LEGAL_SERIF,
                  color: theme.palette.mode === 'light' ? LEGAL_GREEN : 'text.secondary',
                },
              })}
            >
              {document.sections.map((section, index) => (
                <Typography
                  key={section.id}
                  component="li"
                  variant="body2"
                  sx={(theme) => ({
                    py: 0.5,
                    borderBottom: index === document.sections.length - 1 ? 'none' : '1px solid',
                    borderColor: hairlineColor(theme),
                  })}
                >
                  <Link
                    href={`#${section.id}`}
                    underline="hover"
                    sx={{ color: theme => theme.palette.mode === 'light' ? LEGAL_GREEN : 'primary.main' }}
                  >
                    {splitHeadingNumeral(section.heading[locale]).text}
                  </Link>
                </Typography>
              ))}
            </Box>
          </Box>
        ) : null}

        {/* With children, MUI paints the two hairline segments via ::before/
            ::after whose borderTop is hardcoded to palette.divider — a root
            borderColor would be inert, so the segments are colored directly. */}
        <Divider
          sx={(theme) => ({
            my: 4,
            '&::before, &::after': { borderTopColor: hairlineColor(theme) },
          })}
        >
          <Box
            sx={(theme) => ({
              width: 48,
              height: 2,
              borderRadius: 1,
              bgcolor: theme.palette.mode === 'light' ? LEGAL_GOLD : 'divider',
            })}
          />
        </Divider>

        <Box sx={{ maxWidth: '68ch' }}>
          <Stack sx={{ gap: 5 }}>
            {document.sections.map((section, index) => {
              const heading = splitHeadingNumeral(section.heading[locale]);
              const emphasis = section.emphasis;
              const sectionContent = (
                <>
                  {section.body?.map((paragraph, paragraphIndex) => (
                    <Typography key={paragraphIndex} sx={{ mb: 1.5, lineHeight: 1.85 }}>
                      {paragraph[locale]}
                    </Typography>
                  ))}
                  {section.bullets && section.bullets.length > 0 && (
                    // Plain <ul>, not Stack: Stack is display:flex, which
                    // blockifies <li> children so no ::marker ever generates
                    // and bullets render with no glyph at all.
                    <Box
                      component="ul"
                      sx={(theme) => ({
                        m: 0,
                        pl: 3,
                        '& > li + li': { mt: 1 },
                        '& li::marker': {
                          color: theme.palette.mode === 'light' ? LEGAL_GREEN : 'text.secondary',
                        },
                      })}
                    >
                      {section.bullets.map((bullet, bulletIndex) => (
                        <Typography key={bulletIndex} component="li" sx={{ lineHeight: 1.85 }}>
                          {bullet[locale]}
                        </Typography>
                      ))}
                    </Box>
                  )}
                </>
              );
              return (
                <Box
                  key={section.id}
                  id={section.id}
                  component="section"
                  sx={(theme) => ({
                    scrollMarginTop: 12,
                    ...(index > 0
                      ? { pt: 4, borderTop: '1px solid', borderColor: hairlineColor(theme) }
                      : null),
                  })}
                >
                  <Typography component="h2" sx={sectionHeadingSx}>
                    {heading.numeral ? (
                      <Box
                        component="span"
                        sx={(theme) => ({
                          mr: 0.75,
                          fontFamily: LEGAL_SERIF,
                          color: theme.palette.mode === 'light' ? LEGAL_DEEP_GOLD : LEGAL_GOLD,
                        })}
                      >
                        {heading.numeral}
                      </Box>
                    ) : null}
                    {heading.text}
                  </Typography>
                  {emphasis ? (
                    <Box
                      sx={(theme) => ({
                        mt: 1.5,
                        p: 2.5,
                        border: '1px solid',
                        borderColor: hairlineColor(theme),
                        borderLeftWidth: 3,
                        borderLeftColor: emphasisAccent(theme, emphasis),
                        borderRadius: 2,
                        bgcolor: theme.palette.mode === 'light' ? LEGAL_GOLD_WASH : 'action.hover',
                      })}
                    >
                      <Box
                        sx={(theme) => ({
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.75,
                          mb: 1.5,
                          color: emphasisAccent(theme, emphasis),
                        })}
                      >
                        {emphasis === 'requirement' ? (
                          <GavelOutlinedIcon sx={{ fontSize: 16 }} />
                        ) : (
                          <InfoOutlinedIcon sx={{ fontSize: 16 }} />
                        )}
                        <Typography
                          component="span"
                          variant="caption"
                          sx={{
                            color: 'inherit',
                            fontWeight: 700,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                          }}
                        >
                          {emphasis === 'requirement'
                            ? locale === 'ms'
                              ? 'Perkara penting'
                              : 'Important'
                            : locale === 'ms'
                              ? 'Baik untuk diketahui'
                              : 'Good to know'}
                        </Typography>
                      </Box>
                      {sectionContent}
                    </Box>
                  ) : (
                    sectionContent
                  )}
                </Box>
              );
            })}
          </Stack>
        </Box>

        <Divider sx={(theme) => ({ my: 4, borderColor: hairlineColor(theme) })} />

        <Box sx={quietFrameSx}>
          <Typography sx={(theme) => ({ ...eyebrowSx(theme), mb: 1 })}>
            {locale === 'ms' ? 'Ada soalan tentang dokumen ini?' : 'Questions about this document?'}
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
        </Box>

        <Divider sx={(theme) => ({ my: 4, borderColor: hairlineColor(theme) })} />

        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
          <Button
            startIcon={<ArrowBackIcon />}
            onClick={() => returnToPreviousPage(navigate)}
            sx={{ ml: -1 }}
          >
            {backLabel}
          </Button>
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
