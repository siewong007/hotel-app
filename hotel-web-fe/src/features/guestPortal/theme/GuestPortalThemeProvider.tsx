import type { ReactNode } from 'react';
import { GlobalStyles } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { guestPortalTheme } from './guestPortalTheme';

interface GuestPortalThemeProviderProps {
  children: ReactNode;
}

export function GuestPortalThemeProvider({ children }: GuestPortalThemeProviderProps) {
  return (
    <ThemeProvider theme={guestPortalTheme}>
      <GlobalStyles
        styles={{
          ':root': {
            '--hotel-scrollbar-track': '#EDE5D8',
            '--hotel-scrollbar-thumb': '#B99A5C',
            '--hotel-scrollbar-thumb-hover': '#8D713D',
          },
        }}
      />
      {children}
    </ThemeProvider>
  );
}
