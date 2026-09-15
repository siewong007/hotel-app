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
import { useTranslation } from '../../../i18n';
import type { RevenueDailyPoint } from '../types';

interface RevenueTrendChartProps {
  daily: RevenueDailyPoint[];
}

/** Two stacked charts sharing the stay-date axis — room nights sold (bars)
 *  on top, occupancy % (area line) below. Separating the units avoids the
 *  old dual-axis comparison that implied the series share a scale. */
const RevenueTrendChart: React.FC<RevenueTrendChartProps> = ({ daily }) => {
  const { t } = useTranslation('revenue');
  const isEmpty = daily.length === 0;
  const roomNightsLabel = t('trend.roomNights');

  const nightsData = useMemo(
    () =>
      daily.map((p) => ({
        date: p.date,
        [roomNightsLabel]: p.room_nights_sold,
        revenue: Number.parseFloat(p.room_revenue) || 0,
        adr: Number.parseFloat(p.adr) || 0,
      })),
    [daily, roomNightsLabel],
  );

  const occupancySeries = useMemo(
    () => [
      {
        id: t('trend.occupancy'),
        data: daily.map((p) => ({
          x: p.date,
          y: Number.parseFloat(p.occupancy_rate) || 0,
        })),
      },
    ],
    [daily, t],
  );

  const tickBudget = useTickBudget();
  const dayTicks = useMemo(
    () => thinTicks(daily.map((p) => p.date), tickBudget),
    [daily, tickBudget],
  );

  return (
    <Card>
      <CardHeader title={t('trend.title')} subheader={t('trend.subtitle')} />
      <CardContent sx={{ display: 'grid', gap: 1.5 }}>
        <ChartStateGate isEmpty={isEmpty} emptyMessage={t('trend.empty')}>
          <HotelBarChart
            height={170}
            data={nightsData}
            keys={[roomNightsLabel]}
            indexBy="date"
            ariaLabel={t('trend.ariaRoomNights')}
            axisBottom={{ format: fmtShortDate, tickValues: dayTicks }}
            axisLeft={{ format: fmtInt }}
            enableLabel={false}
            tooltip={({ indexValue, data: d }) => (
              <div>
                <strong>{formatHotelDate(String(indexValue), String(indexValue))}</strong>
                <div>{t('trend.ttRoomNights', { value: fmtInt(Number(d[roomNightsLabel])) })}</div>
                <div>{t('trend.ttRoomRevenue', { value: fmtMoney(Number(d.revenue)) })}</div>
                <div>{t('trend.ttAdr', { value: fmtMoney(Number(d.adr)) })}</div>
              </div>
            )}
            margin={{ top: 8, right: 16, bottom: 28, left: 40 }}
          />
          <HotelLineChart
            height={180}
            data={occupancySeries}
            ariaLabel={t('trend.ariaOccupancy')}
            yScale={{ type: 'linear', min: 0, max: 100, stacked: false }}
            axisBottom={{ format: fmtShortDate, tickValues: dayTicks }}
            axisLeft={{ format: (v) => fmtPct(Number(v), 0) }}
            enableArea
            areaOpacity={0.16}
            sliceTooltip={({ slice }) => (
              <div>
                <strong>{formatHotelDate(String(slice.points[0]?.data.x), String(slice.points[0]?.data.x))}</strong>
                <div>{t('trend.ttOccupancy', { value: fmtPct(Number(slice.points[0]?.data.y)) })}</div>
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
