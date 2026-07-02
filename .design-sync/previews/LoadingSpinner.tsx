import React from 'react';
import { Box } from '@mui/material';
import { LoadingSpinner } from 'hotel-web-fe';

export function Circular() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
      <LoadingSpinner variant="circular" />
    </Box>
  );
}

export function Dots() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
      <LoadingSpinner variant="dots" />
    </Box>
  );
}

export function Large() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
      <LoadingSpinner variant="circular" size={72} />
    </Box>
  );
}
