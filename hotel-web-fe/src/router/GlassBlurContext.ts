import { createContext, useContext } from 'react';

export interface GlassBlurContextValue {
  /** Backdrop-blur intensity in px (0–20); 0 renders frosted surfaces solid. */
  glassBlur: number;
  onGlassBlurChange: (px: number) => void;
}

export const GlassBlurContext = createContext<GlassBlurContextValue | undefined>(undefined);

export function useGlassBlur(): GlassBlurContextValue {
  const ctx = useContext(GlassBlurContext);
  if (!ctx) {
    throw new Error('useGlassBlur must be used within GlassBlurContext.Provider');
  }
  return ctx;
}
