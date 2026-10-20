import React from 'react';
import { Box } from '@mui/material';

/**
 * A phone list of `MobileCardRow`s closing a profile tab's section card (an
 * outlined `Paper` with `p: 2`): rows run edge to edge and flush with the
 * card's bottom, so each row's own padding lines up with the card title.
 * Desktop keeps the table; this replaces it below `sm` (`useIsPhone`).
 */
export const PhoneRows: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box sx={{ mx: -2, mb: -2 }}>{children}</Box>
);

/** One row of a `PhoneRows` list, divided from whatever is above it. */
export const PhoneRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>{children}</Box>
);
