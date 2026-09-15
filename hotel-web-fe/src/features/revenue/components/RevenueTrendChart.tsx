import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader } from '@mui/material';

import {
  ChartStateGate,
  HotelBarChart,
  HotelLineChart,
  fmtInt,
  fmtMoney,
  fmtPct,
  fmtShortDate,
  thinTicks,
  useTickBudget,
} from '../../../components/charts';
import { formatHotelDate } from '../../../utils/date';
import type { RevenueDailyPoint } from '../types';

interface RevenueTrendChartProps {
  daily: RevenueDailyPoint[];
}

/** Two stacked charts sharing the stay-date axis — room nights sold (bars)
 *  on top, occupancy % (area line) below. Separating the units avoids the
 *  old dual-axis comparison that implied the series share a scale. */
const RevenueTrendChart: React.FC<RevenueTrendChartProps> = ({ daily }) => {
  const isEmpty = daily.length === 0;

  const nightsData = useMemo(
    () =>
      daily.map((p) => ({
        date: p.date,
        'Room nights': p.room_nights_sold,
        revenue: Number.parseFloat(p.room_revenue) || 0,
        adr: Number.parseFloat(p.adr) || 0,
      })),
    [daily],
  );

  const occupancySeries = useMemo(
    () => [
      {
        id: 'Occupancy',
        data: daily.map((p) => ({
          x: p.date,
          y: Number.parseFloat(p.occupancy_rate) || 0,
        })),
      },
    ],
    [daily],
  );

  const tickBudget = useTickBudget();
  const dayTicks = useMemo(
    () => thinTicks(daily.map((p) => p.date), tickBudget),
    [daily, tickBudget],
  );

  return (
    <Card>
      <CardHeader title="Occupancy & room nights" subheader="By stay date" />
      <CardContent sx={{ display: 'grid', gap: 1.5 }}>
        <ChartStateGate isEmpty={isEmpty} emptyMessage="No stay dates in this range">
          <HotelBarChart
            height={170}
            data={nightsData}
            keys={['Room nights']}
            indexBy="date"
            ariaLabel="Room nights sold per stay date"
            axisBottom={{ format: fmtShortDate, tickValues: dayTicks }}
            axisLeft={{ format: fmtInt }}
            enableLabel={false}
            tooltip={({ indexValue, data: d }) => (
              <div>
                <strong>{formatHotelDate(String(indexValue), String(indexValue))}</strong>
                <div>Room nights: {fmtInt(Number(d['Room nights']))}</div>
                <div>Room revenue: {fmtMoney(Number(d.revenue))}</div>
                <div>ADR: {fmtMoney(Number(d.adr))}</div>
              </div>
            )}
            margin={{ top: 8, right: 16, bottom: 28, left: 40 }}
          />
          <HotelLineChart
            height={180}
            data={occupancySeries}
            ariaLabel="Occupancy rate per stay date"
            yScale={{ type: 'linear', min: 0, max: 100, stacked: false }}
            axisBottom={{ format: fmtShortDate, tickValues: dayTicks }}
            axisLeft={{ format: (v) => fmtPct(Number(v), 0) }}
            enableArea
            areaOpacity={0.16}
            sliceTooltip={({ slice }) => (
              <div>
                <strong>{formatHotelDate(String(slice.points[0]?.data.x), String(slice.points[0]?.data.x))}</strong>
                <div>Occupancy: {fmtPct(Number(slice.points[0]?.data.y))}</div>
              </div>
            )}
            margin={{ top: 8, right: 16, bottom: 28, left: 40 }}
          />
        </ChartStateGate>
      </CardContent>
    </Card>
  );
};

export default RevenueTrendChart;
