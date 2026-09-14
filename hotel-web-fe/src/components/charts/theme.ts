/**
 * Shared Nivo theme — the single mapping from `DesignTokens` to Nivo's Theme
 * shape. Every chart in the app consumes this via the `Hotel*Chart` wrappers;
 * nothing configures axis/grid/tooltip colors ad hoc.
 */
import { useMemo } from 'react';
import { useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import type { LineSeries, LineSvgProps } from '@nivo/line';

import { tokensFor } from '../../theme/tokens';

/** Nivo's `theme` prop type, derived from a chart package (avoids depending
 *  on the transitive @nivo/theming package directly). */
type NivoTheme = NonNullable<LineSvgProps<LineSeries>['theme']>;

export interface ChartTheme {
  /** Nivo `theme` prop value. */
  nivo: NivoTheme;
  /** Ordered categorical palette (`chart.series` tokens, gold first). */
  palette: string[];
  /** `primary.main` token — single-series accent. */
  primary: string;
  /** Status-tone foreground hexes — safe for Nivo `colors` (unlike `var()`,
   *  which react-spring can only resolve on `:root`). */
  status: { success: string; info: string; warning: string; orange: string; danger: string };
  positive: string;
  negative: string;
  /** `false` when the user prefers reduced motion — pass to `animate`. */
  animate: boolean;
}

export function useChartTheme(): ChartTheme {
  const mui = useTheme();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  return useMemo(() => {
    const tokens = tokensFor(mui.palette.mode === 'light' ? 'light' : 'dark');
    const text = {
      fontSize: 11,
      fill: tokens.text.secondary,
      fontFamily: 'inherit',
    };

    const nivo: NivoTheme = {
      background: 'transparent',
      text,
      axis: {
        ticks: { text, line: { stroke: tokens.chart.grid } },
        domain: { line: { stroke: tokens.chart.grid } },
        legend: { text: { ...text, fontSize: 11, fill: tokens.text.muted } },
      },
      grid: { line: { stroke: tokens.chart.grid } },
      legends: { text },
      labels: { text: { ...text, fill: tokens.text.primary } },
      tooltip: {
        container: {
          background: tokens.chart.tooltipBg,
          color: tokens.text.primary,
          fontSize: 12,
          borderRadius: 8,
          boxShadow: tokens.shadow.md,
          border: `1px solid ${tokens.border.base}`,
        },
      },
      crosshair: { line: { stroke: tokens.chart.axis, strokeDasharray: '4 3' } },
    };

    return {
      nivo,
      palette: [...tokens.chart.series],
      primary: tokens.primary.main,
      status: {
        success: tokens.status.success.fg,
        info: tokens.status.info.fg,
        warning: tokens.status.warning.fg,
        orange: tokens.status.orange.fg,
        danger: tokens.status.danger.fg,
      },
      positive: tokens.chart.positive,
      negative: tokens.chart.negative,
      animate: !reduceMotion,
    };
  }, [mui.palette.mode, reduceMotion]);
}
