import type { ReactNode } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { guestPortalTheme } from './guestPortalTheme';

interface GuestPortalThemeProviderProps {
  children: ReactNode;
}

export function GuestPortalThemeProvider({ children }: GuestPortalThemeProviderProps) {
  return <ThemeProvider theme={guestPortalTheme}>{children}</ThemeProvider>;
}
