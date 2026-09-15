import { Box, Skeleton } from '@mui/material';
import { LogoLoader } from '../components';
import { useTranslation } from '../i18n';
import { bootSplashPresent } from '../utils/bootSplash';

// Full-viewport boot screen shown while auth resolves, before any shell exists.
// Deliberately NOT a page-shaped skeleton — a fake dashboard reads as a wrong
// page flashing by on every refresh (the access token is in-memory only, so
// every reload pays for the refresh round trip here). The brand mark carries
// the wait; the static #boot-splash in index.html/guest.html fades into this
// identical centered mark — skipEntrance renders it already settled so the
// pre-React → React handoff is a plain crossfade, not a re-draw.
export const BootSplash = () => (
  <LogoLoader variant="fullScreen" skipEntrance={bootSplashPresent} />
);

export const LoadingFallback = () => {
  const { t } = useTranslation('common');
  return (
  <Box
    role="status"
    aria-label={t('aria.loading')}
    sx={{ minHeight: 'calc(100vh - 200px)', pt: 1 }}
  >
    <Skeleton variant="text" width={260} height={44} sx={{ mb: 2 }} />
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 2,
        mb: 3,
      }}
    >
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} variant="rounded" height={96} />
      ))}
    </Box>
    <Skeleton variant="rounded" height={44} sx={{ mb: 1.5 }} />
    {[0, 1, 2, 3, 4, 5].map((i) => (
      <Skeleton key={i} variant="text" height={34} sx={{ mb: 0.5 }} />
    ))}
  </Box>
  );
};

export const MinimalLoadingFallback = () => <LogoLoader variant="page" minHeight={100} />;
