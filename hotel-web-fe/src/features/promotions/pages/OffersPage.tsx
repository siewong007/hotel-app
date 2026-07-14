import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import { Box, Button, Container, Stack, Typography } from '@mui/material';
import { useNavigate } from '../../../router';
import { PromotionCatalog } from '../components/PromotionCatalog';

export default function OffersPage() {
  const navigate = useNavigate();

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <Box
        component="header"
        sx={{
          background: 'linear-gradient(135deg, #0d47a1 0%, #1976d2 55%, #42a5f5 100%)',
          color: 'common.white',
          py: { xs: 5, md: 8 },
        }}
      >
        <Container maxWidth="lg">
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems={{ sm: 'center' }}
            gap={3}
          >
            <Box>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <LocalOfferIcon />
                <Typography variant="overline">Salim Inn offers</Typography>
              </Stack>
              <Typography variant="h2" component="h1" sx={{ fontSize: { xs: '2.3rem', md: '3.5rem' } }}>
                A better stay for less
              </Typography>
              <Typography variant="h6" sx={{ mt: 1, maxWidth: 650, opacity: 0.9 }}>
                Browse current hotel deals, then sign in to claim an eligible offer and keep its voucher ready for your stay.
              </Typography>
            </Box>
            <Button
              variant="contained"
              color="inherit"
              onClick={() => navigate('/portal/login')}
              sx={{ color: 'primary.main', flexShrink: 0 }}
            >
              Guest portal
            </Button>
          </Stack>
        </Container>
      </Box>

      <Container component="main" maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
        <Stack spacing={1} sx={{ mb: 3 }}>
          <Typography variant="h4" component="h2">
            Current deals
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Offers are subject to availability and the terms shown on each deal.
          </Typography>
        </Stack>
        <PromotionCatalog />
      </Container>
    </Box>
  );
}
