import React from 'react';
import { ResponsiveBar, type BarSvgProps, type BarDatum } from '@nivo/bar';

import { useChartTheme } from './theme';

export interface HotelBarChartProps<D extends BarDatum = BarDatum>
  extends Omit<BarSvgProps<D>, 'height' | 'width'> {
  height?: number;
}

/**
 * Category bar chart (vertical or horizontal) with the shared hotel theme.
 * Horizontal layout is the default-friendly path for long category names.
 */
export function HotelBarChart<D extends BarDatum = BarDatum>({
  height = 260,
  margin,
  colors,
  animate,
  axisBottom,
  axisLeft,
  ...props
}: HotelBarChartProps<D>) {
  const { nivo, palette, animate: animateDefault } = useChartTheme();
  const horizontal = props.layout === 'horizontal';

  return (
    <div style={{ height, width: '100%' }}>
      <ResponsiveBar<D>
        theme={nivo}
        colors={colors ?? [palette[0]]}
        animate={animate ?? animateDefault}
        margin={
          margin ?? (horizontal
            ? { top: 8, right: 48, bottom: 8, left: 8 }
            : { top: 12, right: 16, bottom: 32, left: 48 })
        }
        padding={0.32}
        borderRadius={3}
        axisBottom={
          horizontal
            ? { tickSize: 0, tickPadding: 8, ...axisBottom }
            : { tickSize: 0, tickPadding: 8, ...axisBottom }
        }
        axisLeft={
          horizontal
            ? { tickSize: 0, tickPadding: 6, ...axisLeft }
            : { tickSize: 0, tickPadding: 8, ...axisLeft }
        }
        enableGridX={horizontal}
        enableGridY={!horizontal}
        role="img"
        {...props}
      />
    </div>
  );
}
