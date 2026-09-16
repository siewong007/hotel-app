import React from 'react';
import { Box } from '@mui/material';
import { BrandMark } from 'hotel-web-fe';

// The Salim Inn monogram — deep-green tile, champagne roofline, ivory S.
export function Default() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
      <BrandMark />
    </Box>
  );
}

export function Compact() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
      <BrandMark size={32} />
    </Box>
  );
}
