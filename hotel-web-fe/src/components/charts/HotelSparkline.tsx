import React from 'react';
import { ResponsiveLine } from '@nivo/line';

import { useChartTheme } from './theme';

export interface HotelSparklineProps {
  /** Ordered y-values — x positions are implicit indexes. */
  values: number[];
  height?: number;
  color?: string;
  /** Accessible summary of what the sparkline shows. */
  ariaLabel?: string;
}

/**
 * KPI-card sparkline: a themed, axes-free Nivo line. Returns null for fewer
 * than two points — a single datum is not a trend.
 */
export const HotelSparkline: React.FC<HotelSparklineProps> = ({
  values,
  height = 36,
  color,
  ariaLabel,
}) => {
  const { nivo, palette } = useChartTheme();
  if (values.length < 2) return null;

  return (
    <div style={{ height, width: '100%' }} role="img" aria-label={ariaLabel}>
      <ResponsiveLine
        data={[{ id: 'spark', data: values.map((y, i) => ({ x: i, y })) }]}
        theme={nivo}
        colors={[color ?? palette[0]]}
        margin={{ top: 3, right: 2, bottom: 3, left: 2 }}
        xScale={{ type: 'point' }}
        yScale={{ type: 'linear', min: 'auto', max: 'auto' }}
        axisTop={null}
        axisRight={null}
        axisBottom={null}
        axisLeft={null}
        enableGridX={false}
        enableGridY={false}
        enablePoints={false}
        enableArea
        areaOpacity={0.14}
        lineWidth={1.6}
        isInteractive={false}
        animate={false}
        role="img"
      />
    </div>
  );
};
