import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { RatesApi } from '../api';
import { CALENDAR_WINDOW_DAYS } from '../constants';
import type { RateCalendarCell } from '../types';
import { addLocalDays, formatLocalDate } from '../../../utils/date';

export interface CalendarWindow {
  from: string;
  to: string;
}

const defaultWindow = (): CalendarWindow => {
  const today = new Date();
  return {
    from: formatLocalDate(today),
    to: formatLocalDate(addLocalDays(today, CALENDAR_WINDOW_DAYS - 1)),
  };
};

export function useRateCalendar() {
  const [window, setWindow] = useState<CalendarWindow>(defaultWindow);

  const query = useQuery({
    queryKey: ['rate-calendar', window.from, window.to],
    queryFn: () => RatesApi.calendar(window.from, window.to),
  });

  const cells = useMemo(() => {
    const map = new Map<string, RateCalendarCell>();
    query.data?.cells.forEach((cell) => {
      map.set(`${cell.room_type_id}:${cell.stay_date}`, cell);
    });
    return map;
  }, [query.data]);

  const shiftWindow = (days: number) => {
    setWindow((current) => ({
      from: formatLocalDate(addLocalDays(new Date(`${current.from}T12:00:00`), days)),
      to: formatLocalDate(addLocalDays(new Date(`${current.to}T12:00:00`), days)),
    }));
  };

  return {
    window,
    setWindow,
    shiftWindow,
    calendar: query.data,
    cells,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
