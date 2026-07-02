import React from 'react';
import { Box } from '@mui/material';
import { HotelSpinner } from 'hotel-web-fe';

// Branded full-screen loading indicator; `size` sets its diameter in px.
export function Default() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
      <HotelSpinner />
    </Box>
  );
}

export function Compact() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
      <HotelSpinner size={64} />
    </Box>
  );
}
