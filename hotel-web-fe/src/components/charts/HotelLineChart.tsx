import React from 'react';
import { ResponsiveLine, type LineSvgProps, type LineSeries } from '@nivo/line';

import { useChartTheme } from './theme';

export interface HotelLineChartProps<S extends LineSeries = LineSeries>
  extends Omit<LineSvgProps<S>, 'height' | 'width'> {
  /** Chart box height in px — the wrapper div is `width: 100%`. */
  height?: number;
}

/**
 * Time-series line/area chart with the shared hotel theme applied.
 * All Nivo line props pass through — wrappers set defaults, not walls.
 */
export function HotelLineChart<S extends LineSeries = LineSeries>({
  height = 260,
  margin,
  colors,
  animate,
  axisBottom,
  axisLeft,
  ...props
}: HotelLineChartProps<S>) {
  const { nivo, palette, animate: animateDefault } = useChartTheme();

  return (
    <div style={{ height, width: '100%' }}>
      <ResponsiveLine<S>
        theme={nivo}
        colors={colors ?? palette}
        animate={animate ?? animateDefault}
        margin={margin ?? { top: 12, right: 16, bottom: 32, left: 44 }}
        xScale={{ type: 'point' }}
        yScale={{ type: 'linear', min: 'auto', max: 'auto', stacked: false }}
        axisBottom={{
          tickSize: 0,
          tickPadding: 8,
          tickRotation: 0,
          ...axisBottom,
        }}
        axisLeft={{
          tickSize: 0,
          tickPadding: 8,
          ...axisLeft,
        }}
        enableGridX={false}
        pointSize={6}
        pointBorderWidth={2}
        pointBorderColor={{ from: 'seriesColor' }}
        useMesh
        enableSlices="x"
        role="img"
        {...props}
      />
    </div>
  );
}
