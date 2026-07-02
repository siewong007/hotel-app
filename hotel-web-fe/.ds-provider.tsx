import React from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { createAppTheme } from './src/theme';

// Wraps preview cards in the hotel-app MUI theme (light mode) so every
// component reads the real palette, typography, and component overrides
// from context — without this the MUI components render unstyled.
export function AppThemeProvider({ children }: { children?: React.ReactNode }) {
  return (
    <ThemeProvider theme={createAppTheme('light')}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
