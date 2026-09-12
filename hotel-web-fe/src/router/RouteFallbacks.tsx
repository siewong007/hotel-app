import { Box, Skeleton } from '@mui/material';
import { HotelSpinner } from '../components';

export const LoadingFallback = () => (
  <Box
    role="status"
    aria-label="Loading"
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

export const MinimalLoadingFallback = () => (
  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100px' }}>
    <HotelSpinner size={40} />
  </Box>
);
