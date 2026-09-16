import React from 'react';
import { Box } from '@mui/material';
import { LogoLoader } from 'hotel-web-fe';

// Page-level loading: centered mark in a min-height region.
export function Page() {
  return <LogoLoader variant="page" />;
}

// Component-level loading alongside other content.
export function Inline() {
  return (
    <Box sx={{ p: 3 }}>
      <LogoLoader variant="inline" label="Loading bookings" />
    </Box>
  );
}
