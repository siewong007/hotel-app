import React from 'react';
import { ResponsivePie, type PieSvgProps, type DefaultRawDatum } from '@nivo/pie';

import { useChartTheme } from './theme';

export interface HotelPieChartProps<D extends DefaultRawDatum = DefaultRawDatum>
  extends Omit<PieSvgProps<D>, 'height' | 'width'> {
  height?: number;
}

/** Donut-first pie chart with the shared hotel theme and categorical palette. */
export function HotelPieChart<D extends DefaultRawDatum = DefaultRawDatum>({
  height = 260,
  margin,
  colors,
  animate,
  ...props
}: HotelPieChartProps<D>) {
  const { nivo, palette, animate: animateDefault } = useChartTheme();

  return (
    <div style={{ height, width: '100%' }}>
      <ResponsivePie<D>
        theme={nivo}
        colors={colors ?? palette}
        animate={animate ?? animateDefault}
        margin={margin ?? { top: 12, right: 12, bottom: 12, left: 12 }}
        innerRadius={0.62}
        padAngle={1.2}
        cornerRadius={3}
        activeOuterRadiusOffset={6}
        enableArcLabels={false}
        role="img"
        {...props}
      />
    </div>
  );
}
