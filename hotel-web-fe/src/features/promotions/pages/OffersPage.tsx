import { Box, Container, Stack, Typography } from '@mui/material';
import { PromotionCatalog } from '../components/PromotionCatalog';
import { GuestPortalThemeProvider } from '../../guestPortal/theme/GuestPortalThemeProvider';

// Chrome (nav, account, support) comes from GuestPortalShell — this page only
// carries a slim title block plus the catalog.
export default function OffersPage() {
  return (
    <GuestPortalThemeProvider>
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <Container component="main" maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
        <Stack spacing={1} sx={{ mb: 3 }}>
          <Typography variant="overline" sx={{ color: 'var(--hotel-primary-text)', fontWeight: 700, letterSpacing: '0.12em' }}>
            Offers
          </Typography>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
            A better stay for less
          </Typography>
          <Typography variant="body1" sx={{
            color: "text.secondary", maxWidth: 640
          }}>
            Browse current hotel deals, then sign in to claim an eligible offer and keep its voucher ready for your stay. Offers are subject to availability and the terms shown on each deal.
          </Typography>
        </Stack>
        <PromotionCatalog />
      </Container>
    </Box>
    </GuestPortalThemeProvider>
  );
}
