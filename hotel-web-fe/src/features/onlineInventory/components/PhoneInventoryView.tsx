import { Box, Chip, Paper, Stack, Typography, alpha, useTheme } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';

import type { CellKey, GridCellView } from '../types';
import type { InventoryRoomTypeRow } from '../hooks/useOnlineInventory';
import { cellKey } from '../utils';
import { DAY_NUM, FULL_DATE, WEEKDAY_SHORT } from '../constants';
import { cellAriaLabel } from './GridCell';

const asDate = (date: string) => new Date(`${date}T12:00:00`);

export interface PhoneInventoryViewProps {
  roomTypes: InventoryRoomTypeRow[];
  dates: string[]; // visibleDates
  cells: Map<CellKey, GridCellView>;
  today: string;
  selected: ReadonlySet<CellKey>;
  selectMode: boolean; // page-owned
  onToggleSelect(key: CellKey): void; // page-owned toggler
  onOpenCell(key: CellKey): void; // opens the editor sheet
  formatPrice(value: string): string;
}

interface PhoneDayCellProps {
  view: GridCellView | undefined;
  dayKey: CellKey;
  date: string;
  isToday: boolean;
  isSelected: boolean;
  selectMode: boolean;
  onTap(key: CellKey): void;
  formatPrice(value: string): string;
}

/**
 * One day in the horizontal strip: weekday + day number header (tinted for
 * today), the online-available count or a "Closed" lock row, and the same
 * override/changed dot + selected ring the desktop grid cell uses.
 */
const PhoneDayCell = ({
  view,
  dayKey,
  date,
  isToday,
  isSelected,
  selectMode,
  onTap,
  formatPrice,
}: PhoneDayCellProps) => {
  const theme = useTheme();
  const closed = view !== undefined && !view.current.online_booking_enabled;
  const soldOut = view !== undefined && !closed && view.online_available === 0;

  return (
    <Box
      component="button"
      type="button"
      disabled={view === undefined}
      aria-label={
        view === undefined
          ? `${FULL_DATE.format(asDate(date))}: no inventory data`
          : cellAriaLabel(view, formatPrice)
      }
      aria-pressed={selectMode && view !== undefined ? isSelected : undefined}
      onClick={() => {
        if (view !== undefined) onTap(dayKey);
      }}
      sx={{
        position: 'relative',
        flex: '0 0 64px',
        scrollSnapAlign: 'start',
        display: 'flex',
        flexDirection: 'column',
        p: 0,
        border: 0,
        borderRight: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        color: 'text.primary',
        font: 'inherit',
        textAlign: 'center',
        cursor: view === undefined ? 'default' : 'pointer',
        userSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
        boxShadow: isSelected ? `inset 0 0 0 2px ${theme.palette.primary.main}` : 'none',
        outline: 'none',
        '&:last-of-type': { borderRight: 0 },
        '&:focus-visible': {
          boxShadow: `inset 0 0 0 3px ${theme.palette.primary.dark}`,
          zIndex: 1,
        },
        '&:disabled': { color: 'text.disabled' },
        '@media (prefers-reduced-motion: no-preference)': {
          transition: 'background-color 120ms ease, box-shadow 120ms ease',
        },
      }}
    >
      <Box
        sx={{
          width: '100%',
          px: 0.25,
          py: 0.5,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: isToday ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
        }}
      >
        <Typography
          variant="caption"
          component="div"
          sx={{
            color: isToday ? 'primary.dark' : 'text.secondary',
            fontWeight: 700,
            lineHeight: 1.2,
          }}
        >
          {isToday ? 'Today' : WEEKDAY_SHORT.format(asDate(date))}
        </Typography>
        <Typography component="div" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
          {DAY_NUM.format(asDate(date))}
        </Typography>
      </Box>
      <Box
        sx={{
          width: '100%',
          flex: 1,
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          py: 0.5,
        }}
      >
        {view === undefined ? (
          <Typography variant="caption" sx={{ color: 'text.disabled' }}>
            —
          </Typography>
        ) : closed ? (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
            <LockOutlinedIcon sx={{ fontSize: 14, color: 'text.secondary' }} aria-hidden />
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
              Closed
            </Typography>
          </Box>
        ) : (
          <Typography
            sx={{
              fontWeight: 800,
              fontSize: '1.05rem',
              lineHeight: 1.1,
              color: soldOut ? 'warning.dark' : 'text.primary',
            }}
          >
            {view.online_available}
          </Typography>
        )}
      </Box>
      {view !== undefined && (view.changed || view.is_override) && (
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            top: 5,
            right: 5,
            width: 7,
            height: 7,
            borderRadius: '50%',
            bgcolor: view.changed ? 'primary.main' : 'transparent',
            border: view.changed ? 'none' : `1.5px solid ${theme.palette.text.disabled}`,
          }}
        />
      )}
    </Box>
  );
};

/**
 * The phone layout for the inventory window: one card per room type holding a
 * horizontal scroll-snap strip of day cells. Presentation only — the page owns
 * the data, the selection model, and the editor/bulk sheets. Tapping a day
 * cell opens the editor sheet, or toggles selection when `selectMode` is on.
 */
export const PhoneInventoryView = ({
  roomTypes,
  dates,
  cells,
  today,
  selected,
  selectMode,
  onToggleSelect,
  onOpenCell,
  formatPrice,
}: PhoneInventoryViewProps) => {
  const handleTap = (key: CellKey) => {
    if (selectMode) onToggleSelect(key);
    else onOpenCell(key);
  };

  return (
    <Stack spacing={2}>
      {roomTypes.map((room) => {
        const todayView = cells.get(cellKey(room.room_type_id, today));
        return (
          <Paper
            key={room.room_type_id}
            variant="outlined"
            sx={{ borderRadius: 3, overflow: 'hidden' }}
          >
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', px: 1.5, py: 1.25 }}
            >
              <Typography sx={{ fontWeight: 800, flex: 1, minWidth: 0 }} noWrap>
                {room.room_type_name}
              </Typography>
              <Chip
                label={room.room_type_code}
                size="small"
                variant="outlined"
                sx={{ flexShrink: 0 }}
              />
              {todayView !== undefined && (
                <Typography
                  variant="caption"
                  sx={{ color: 'text.secondary', fontWeight: 600, flexShrink: 0 }}
                >
                  {todayView.online_available} free today
                </Typography>
              )}
            </Stack>
            <Box
              role="group"
              aria-label={`${room.room_type_name} availability by day`}
              sx={{
                display: 'flex',
                overflowX: 'auto',
                scrollSnapType: 'x proximity',
                scrollbarWidth: 'none',
                '&::-webkit-scrollbar': { display: 'none' },
                borderTop: 1,
                borderColor: 'divider',
              }}
            >
              {dates.map((date) => {
                const key = cellKey(room.room_type_id, date);
                return (
                  <PhoneDayCell
                    key={key}
                    dayKey={key}
                    date={date}
                    view={cells.get(key)}
                    isToday={date === today}
                    isSelected={selected.has(key)}
                    selectMode={selectMode}
                    onTap={handleTap}
                    formatPrice={formatPrice}
                  />
                );
              })}
            </Box>
          </Paper>
        );
      })}
    </Stack>
  );
};
