import { Box } from '@mui/material';
import { HotelSpinner } from '../components';

export const LoadingFallback = () => (
  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100vh - 200px)', opacity: 0.8 }}>
    <HotelSpinner size={80} />
  </Box>
);

export const MinimalLoadingFallback = () => (
  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100px' }}>
    <HotelSpinner size={40} />
  </Box>
);
