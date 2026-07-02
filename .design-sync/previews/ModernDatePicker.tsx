import React from 'react';
import { Box } from '@mui/material';
import { ModernDatePicker } from 'hotel-web-fe';

const noop = () => {};

export function CheckIn() {
  return (
    <Box sx={{ maxWidth: 320 }}>
      <ModernDatePicker label="Check-in date" value="2026-07-15" onChange={noop} required />
    </Box>
  );
}

export function Sizes() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 320 }}>
      <ModernDatePicker label="Small" value="2026-07-15" onChange={noop} size="small" margin="none" />
      <ModernDatePicker label="Medium" value="2026-07-18" onChange={noop} size="medium" margin="none" />
    </Box>
  );
}

export function WithError() {
  return (
    <Box sx={{ maxWidth: 320 }}>
      <ModernDatePicker
        label="Check-out date"
        value="2026-07-14"
        onChange={noop}
        error
        helperText="Check-out must be after check-in."
      />
    </Box>
  );
}
