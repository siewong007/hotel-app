import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import { Box, Button, Container, Stack, Typography } from '@mui/material';
import { useNavigate } from '../../../router';
import { useTranslation } from '../../../i18n';
import { PromotionCatalog } from '../components/PromotionCatalog';
import { getHotelSettings } from '../../../utils/hotelSettings';
import { GuestPortalThemeProvider } from '../../guestPortal/theme/GuestPortalThemeProvider';

export default function OffersPage() {
  const { t } = useTranslation('guestPortal');
  const navigate = useNavigate();
  const hotelName = getHotelSettings().hotel_name;

  return (
    <GuestPortalThemeProvider>
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <Box
        component="header"
        sx={(theme) => ({
          background: `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.primary.main} 55%, ${theme.palette.primary.light} 100%)`,
          color: 'primary.contrastText',
          py: { xs: 5, md: 8 },
        })}
      >
        <Container maxWidth="lg">
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            sx={{
              justifyContent: "space-between",
              alignItems: { sm: 'center' },
              gap: 3
            }}>
            <Box>
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  alignItems: "center",
                  mb: 1
                }}>
                <LocalOfferIcon />
                <Typography variant="overline">{t('offers.pageEyebrow', { hotel: hotelName })}</Typography>
              </Stack>
              <Typography variant="h2" component="h1" sx={{ fontSize: { xs: '2.3rem', md: '3.5rem' } }}>
                {t('offers.pageTitle')}
              </Typography>
              <Typography variant="h6" sx={{ mt: 1, maxWidth: 650, opacity: 0.9 }}>
                {t('offers.pageSubtitle')}
              </Typography>
            </Box>
            <Button
              variant="contained"
              color="inherit"
              onClick={() => navigate('/login')}
              sx={{ color: 'primary.contrastText', flexShrink: 0 }}
            >
              {t('offers.guestPortalButton')}
            </Button>
          </Stack>
        </Container>
      </Box>
      <Container component="main" maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
        <Stack spacing={1} sx={{ mb: 3 }}>
          <Typography variant="h4" component="h2">
            {t('offers.currentDeals')}
          </Typography>
          <Typography variant="body1" sx={{
            color: "text.secondary"
          }}>
            {t('offers.termsNote')}
          </Typography>
        </Stack>
        <PromotionCatalog />
      </Container>
    </Box>
    </GuestPortalThemeProvider>
  );
}
