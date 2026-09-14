import { useMemo } from 'react';
import { Box, Paper, Typography, alpha, useTheme } from '@mui/material';
import type { Theme } from '@mui/material/styles';

import type { RateCalendarCell, RateCalendarRoomType } from '../types';
import { formatCurrency } from '../../../utils/currency';

const WEEKDAY_SHORT = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const DAY_NUM = new Intl.DateTimeFormat(undefined, { day: 'numeric' });

const asDate = (date: string) => new Date(`${date}T12:00:00`);

export interface RateCalendarGridProps {
  roomTypes: RateCalendarRoomType[];
  dates: string[];
  cells: Map<string, RateCalendarCell>;
  currency: string;
  today: string;
  onInspectCell(cell: RateCalendarCell, anchor: HTMLElement): void;
}

export const rateCellKey = (roomTypeId: number, date: string) =>
  `${roomTypeId}:${date}`;

const occupancyColor = (pct: number, theme: Theme) => {
  if (pct >= 90) return theme.palette.error.main;
  if (pct >= 70) return theme.palette.warning.main;
  return theme.palette.success.main;
};

/**
 * Staff rate matrix: room type × stay date. Read-mostly — each cell shows the
 * resolved effective rate with an occupancy bar; clicking a cell opens the
 * resolution breakdown popover. Editing happens through the plan editor and
 * the bulk-rates dialog, never directly on cells.
 */
export const RateCalendarGrid = ({
  roomTypes,
  dates,
  cells,
  currency,
  today,
  onInspectCell,
}: RateCalendarGridProps) => {
  const theme = useTheme();
  const grid = useMemo(
    () =>
      roomTypes.map((room) => ({
        room,
        row: dates.map((date) => cells.get(rateCellKey(room.room_type_id, date))),
      })),
    [roomTypes, dates, cells],
  );

  return (
    <Paper
      variant="outlined"
      sx={{ borderRadius: 3, overflow: 'auto', maxHeight: 'min(72vh, 720px)' }}
    >
      <Box
        component="table"
        role="grid"
        aria-label="Rate calendar by room type and date"
        sx={{
          borderCollapse: 'separate',
          borderSpacing: 0,
          width: '100%',
          minWidth: 180 + dates.length * 92,
        }}
      >
        <Box component="thead">
          <Box component="tr" role="row">
            <Box
              component="th"
              role="columnheader"
              sx={{
                position: 'sticky',
                top: 0,
                left: 0,
                zIndex: 4,
                minWidth: 180,
                p: 1.5,
                bgcolor: 'background.paper',
                borderRight: 1,
                borderBottom: 1,
                borderColor: 'divider',
                textAlign: 'left',
                color: 'text.secondary',
                fontSize: '0.75rem',
                fontWeight: 700,
                letterSpacing: 0.4,
              }}
            >
              ROOM TYPE / DATE
            </Box>
            {dates.map((date) => (
              <Box
                component="th"
                role="columnheader"
                key={date}
                sx={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 3,
                  minWidth: 92,
                  py: 0.5,
                  px: 0.5,
                  bgcolor:
                    date === today
                      ? alpha(theme.palette.primary.main, 0.08)
                      : 'background.paper',
                  borderRight: 1,
                  borderBottom: 1,
                  borderColor: 'divider',
                  textAlign: 'center',
                }}
              >
                <Typography
                  variant="caption"
                  component="div"
                  sx={{ color: 'text.secondary', fontWeight: 700 }}
                >
                  {date === today ? 'Today' : WEEKDAY_SHORT.format(asDate(date))}
                </Typography>
                <Typography component="div" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
                  {DAY_NUM.format(asDate(date))}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
        <Box component="tbody">
          {grid.map(({ room, row }) => (
            <Box component="tr" role="row" key={room.room_type_id}>
              <Box
                component="th"
                role="rowheader"
                sx={{
                  position: 'sticky',
                  left: 0,
                  zIndex: 2,
                  bgcolor: 'background.paper',
                  borderRight: 1,
                  borderBottom: 1,
                  borderColor: 'divider',
                  px: 1.5,
                  py: 0.5,
                  minWidth: 180,
                  textAlign: 'left',
                }}
              >
                <Typography sx={{ fontWeight: 800, lineHeight: 1.2 }} noWrap>
                  {room.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {room.code}
                </Typography>
              </Box>
              {row.map((cell, index) => {
                if (!cell) {
                  return (
                    <Box
                      component="td"
                      role="gridcell"
                      key={dates[index]}
                      sx={{ borderRight: 1, borderBottom: 1, borderColor: 'divider' }}
                    />
                  );
                }
                const occupancy = Number.parseFloat(cell.occupancy_pct);
                return (
                  <Box
                    component="td"
                    role="gridcell"
                    key={cell.stay_date}
                    sx={{
                      p: 0,
                      borderRight: 1,
                      borderBottom: 1,
                      borderColor: 'divider',
                      bgcolor:
                        cell.stay_date === today
                          ? alpha(theme.palette.primary.main, 0.05)
                          : 'transparent',
                    }}
                  >
                    <Box
                      component="button"
                      type="button"
                      aria-label={`${room.name} ${cell.stay_date} rate ${cell.effective_rate}`}
                      onClick={(event) =>
                        onInspectCell(cell, event.currentTarget as HTMLElement)
                      }
                      sx={{
                        display: 'block',
                        width: '100%',
                        minHeight: 56,
                        px: 0.75,
                        py: 0.5,
                        border: 0,
                        bgcolor: 'transparent',
                        cursor: 'pointer',
                        textAlign: 'left',
                        font: 'inherit',
                        '&:hover': { bgcolor: 'action.hover' },
                        '&:focus-visible': {
                          outline: `3px solid ${theme.palette.primary.dark}`,
                          outlineOffset: -3,
                        },
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                        <Typography
                          sx={{
                            fontWeight: 800,
                            lineHeight: 1.1,
                            color: cell.is_base_rate
                              ? 'text.secondary'
                              : 'text.primary',
                          }}
                        >
                          {formatCurrency(cell.effective_rate, currency)}
                        </Typography>
                        {cell.custom_price !== null && (
                          <Box
                            component="span"
                            title="Online override"
                            aria-label="Online price override active"
                            sx={{
                              width: 7,
                              height: 7,
                              borderRadius: '50%',
                              bgcolor: 'secondary.main',
                              flexShrink: 0,
                            }}
                          />
                        )}
                        {!cell.online_booking_enabled && (
                          <Typography
                            variant="caption"
                            color="warning.main"
                            sx={{ fontWeight: 700 }}
                          >
                            off
                          </Typography>
                        )}
                      </Box>
                      <Box
                        sx={{
                          mt: 0.5,
                          height: 3,
                          borderRadius: 2,
                          bgcolor: 'action.disabledBackground',
                          overflow: 'hidden',
                        }}
                      >
                        <Box
                          sx={{
                            width: `${Math.min(occupancy, 100)}%`,
                            height: '100%',
                            bgcolor: occupancyColor(occupancy, theme),
                          }}
                        />
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {cell.sold_rooms}/{cell.physical_rooms} sold
                      </Typography>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          ))}
        </Box>
      </Box>
    </Paper>
  );
};
