import { createContext, useContext } from 'react';
import type { ThemeMode } from '../theme';

export interface ThemeModeContextValue {
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
}

export const ThemeModeContext = createContext<ThemeModeContextValue | undefined>(undefined);

export function useThemeMode(): ThemeModeContextValue {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) {
    throw new Error('useThemeMode must be used within ThemeModeContext.Provider');
  }
  return ctx;
}
