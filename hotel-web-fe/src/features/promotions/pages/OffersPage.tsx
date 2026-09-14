import { Box, Container, Stack, Typography } from '@mui/material';
import { useTranslation } from '../../../i18n';
import { PromotionCatalog } from '../components/PromotionCatalog';
import { GuestPortalThemeProvider } from '../../guestPortal/theme/GuestPortalThemeProvider';

// Chrome (nav, account, support) comes from GuestPortalShell — this page only
// carries a slim title block plus the catalog.
export default function OffersPage() {
  const { t } = useTranslation('guestPortal');

  return (
    <GuestPortalThemeProvider>
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <Container component="main" maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
        <Stack spacing={1} sx={{ mb: 3 }}>
          <Typography variant="overline" sx={{ color: 'var(--hotel-primary-text)', fontWeight: 700, letterSpacing: '0.12em' }}>
            {t('dashboard.sections.offers')}
          </Typography>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
            {t('offers.pageTitle')}
          </Typography>
          <Typography variant="body1" sx={{
            color: "text.secondary", maxWidth: 640
          }}>
            {t('offers.pageSubtitle')} {t('offers.termsNote')}
          </Typography>
        </Stack>
        <PromotionCatalog />
      </Container>
    </Box>
    </GuestPortalThemeProvider>
  );
}
