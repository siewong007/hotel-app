import React from 'react';
import { Card, CardContent, CardHeader } from '@mui/material';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { formatCurrency } from '../../../utils/currency';
import { formatHotelDate } from '../../../utils/date';
import type { RevenueDailyPoint } from '../types';

interface RevenueTrendChartProps {
  daily: RevenueDailyPoint[];
}

/** Stay-date basis: bars are room nights sold, the line is occupancy %. */
const RevenueTrendChart: React.FC<RevenueTrendChartProps> = ({ daily }) => {
  const data = daily.map((point) => ({
    date: formatHotelDate(point.date, point.date),
    nights: point.room_nights_sold,
    occupancy: Number.parseFloat(point.occupancy_rate) || 0,
    revenue: Number.parseFloat(point.room_revenue) || 0,
  }));

  return (
    <Card>
      <CardHeader title="Occupancy & room nights" subheader="By stay date" />
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis yAxisId="nights" tick={{ fontSize: 12 }} allowDecimals={false} />
            <YAxis
              yAxisId="occupancy"
              orientation="right"
              tick={{ fontSize: 12 }}
              unit="%"
              domain={[0, 100]}
            />
            <Tooltip
              formatter={(value, name) =>
                name === 'revenue'
                  ? [formatCurrency(Number(value)), 'Room revenue']
                  : name === 'occupancy'
                    ? [`${Number(value).toFixed(1)}%`, 'Occupancy']
                    : [value, 'Room nights']
              }
            />
            <Bar yAxisId="nights" dataKey="nights" fill="#90caf9" radius={[4, 4, 0, 0]} />
            <Line
              yAxisId="occupancy"
              type="monotone"
              dataKey="occupancy"
              stroke="#2e7d32"
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};

export default RevenueTrendChart;
