import { type CSSProperties, type ReactNode } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { Box, type BoxProps } from '@mui/material';
import { createAppTheme, cssVarDeclarations, lightTokens } from '../../theme';

// Module-level: the island's theme and var map are immutable, so building
// them once avoids re-creating a full MUI theme per preview render.
const PAPER_THEME = createAppTheme('light');
const PAPER_VARS = cssVarDeclarations(lightTokens) as CSSProperties;

interface PaperIslandProps extends BoxProps {
  children: ReactNode;
}

/**
 * Light "paper document" island inside the app shell. Nests a ThemeProvider
 * built from lightTokens AND republishes the `--hotel-*` vars on the wrapper,
 * so both MUI-prop consumers (`text.secondary`, `color="success"`, inputs,
 * chips, alerts) and `var(--hotel-*)` consumers resolve the warm-paper palette
 * no matter which app theme is active. On-screen invoice previews render
 * inside it to keep the printed document's paper identity — see
 * docs/DESIGN_SYSTEM.md. Print output itself can't see these vars; the print
 * paths interpolate `paperTokens` literals instead.
 */
export function PaperIsland({ children, style, ...boxProps }: PaperIslandProps) {
  return (
    <ThemeProvider theme={PAPER_THEME}>
      {/* Caller styles merge over the var map — a `style` prop must augment
          the island, never replace the republished --hotel-* vars. */}
      <Box style={{ ...PAPER_VARS, ...style }} {...boxProps}>{children}</Box>
    </ThemeProvider>
  );
}

export default PaperIsland;
