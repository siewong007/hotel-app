import { useCallback, useEffect, useRef } from 'react';
import { Box, Chip, Paper, Typography, alpha, useTheme } from '@mui/material';

import type { CellKey, GridCellView } from '../types';
import type { InventoryRoomTypeRow } from '../hooks/useOnlineInventory';
import { cellKey, parseCellKey } from '../utils';
import { GridCell } from './GridCell';

const WEEKDAY_SHORT = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const DAY_NUM = new Intl.DateTimeFormat(undefined, { day: 'numeric' });
const HEADER_DATE = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

const asDate = (date: string) => new Date(`${date}T12:00:00`);

export interface InventoryGridProps {
  roomTypes: InventoryRoomTypeRow[];
  dates: string[];
  cells: Map<CellKey, GridCellView>;
  selected: ReadonlySet<CellKey>;
  focused: CellKey | null;
  today: string;
  onSelectCell(key: CellKey, extend: boolean): void;
  onMoveFocus(key: CellKey, extend: boolean): void;
  onSelectRange(from: CellKey, to: CellKey): void;
  onSelectRow(roomTypeId: number): void;
  onSelectColumn(date: string): void;
  onSelectAll(): void;
  onOpenEditor(key: CellKey, anchor: HTMLElement): void;
  onClearSelection(): void;
  formatPrice(value: string): string;
}

const ARROW_DELTAS: Record<string, [number, number]> = {
  ArrowRight: [0, 1],
  ArrowLeft: [0, -1],
  ArrowDown: [1, 0],
  ArrowUp: [-1, 0],
};

/**
 * The pricing/inventory matrix: a WAI-ARIA grid with roving tabindex, arrow-key
 * navigation, marquee/row/column selection, and per-cell edit affordance.
 * Presentation only — all state lives in the page's hooks.
 */
export const InventoryGrid = ({
  roomTypes,
  dates,
  cells,
  selected,
  focused,
  today,
  onSelectCell,
  onMoveFocus,
  onSelectRange,
  onSelectRow,
  onSelectColumn,
  onSelectAll,
  onOpenEditor,
  onClearSelection,
  formatPrice,
}: InventoryGridProps) => {
  const theme = useTheme();
  const roomTypeIds = roomTypes.map((room) => room.room_type_id);

  const cellRefs = useRef(new Map<CellKey, HTMLTableCellElement>());
  const registerRef = useCallback((key: CellKey, el: HTMLTableCellElement | null) => {
    if (el) cellRefs.current.set(key, el);
    else cellRefs.current.delete(key);
  }, []);

  useEffect(() => {
    if (focused) cellRefs.current.get(focused)?.focus();
  }, [focused]);

  const dragAnchor = useRef<CellKey | null>(null);
  useEffect(() => {
    const stop = () => {
      dragAnchor.current = null;
    };
    window.addEventListener('pointerup', stop);
    return () => window.removeEventListener('pointerup', stop);
  }, []);

  const neighborKey = useCallback(
    (key: CellKey, dr: number, dc: number): CellKey | null => {
      const { roomTypeId, date } = parseCellKey(key);
      const r = roomTypeIds.indexOf(roomTypeId) + dr;
      const c = dates.indexOf(date) + dc;
      if (r < 0 || r >= roomTypeIds.length || c < 0 || c >= dates.length) return null;
      return cellKey(roomTypeIds[r], dates[c]);
    },
    [roomTypeIds, dates],
  );

  const handleKeyDown = useCallback(
    (key: CellKey, event: React.KeyboardEvent) => {
      const delta = ARROW_DELTAS[event.key];
      if (delta) {
        event.preventDefault();
        const next = neighborKey(key, delta[0], delta[1]);
        if (next) onMoveFocus(next, event.shiftKey);
        return;
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const { roomTypeId } = parseCellKey(key);
        const edge = event.key === 'Home' ? 0 : dates.length - 1;
        // Plain Home/End jump within the row; Ctrl/Cmd jumps to the grid edge.
        const rowIndex =
          event.ctrlKey || event.metaKey ? edge : roomTypeIds.indexOf(roomTypeId);
        if (dates[edge] && roomTypeIds[rowIndex] !== undefined) {
          onMoveFocus(cellKey(roomTypeIds[rowIndex], dates[edge]), event.shiftKey);
        }
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onOpenEditor(key, event.currentTarget as HTMLElement);
        return;
      }
      if (event.key === 'Escape') onClearSelection();
    },
    [neighborKey, onMoveFocus, onOpenEditor, onClearSelection, dates, roomTypeIds],
  );

  const handleDragStart = useCallback(
    (key: CellKey, shiftKey: boolean) => {
      dragAnchor.current = key;
      onSelectCell(key, shiftKey);
    },
    [onSelectCell],
  );

  const handleDragTo = useCallback(
    (key: CellKey) => {
      if (dragAnchor.current === null || dragAnchor.current === key) return;
      onSelectRange(dragAnchor.current, key);
    },
    [onSelectRange],
  );

  const headerCellSx = {
    position: 'sticky' as const,
    top: 0,
    zIndex: 3,
    bgcolor: 'background.paper',
    borderBottom: 1,
    borderColor: 'divider',
    p: 0,
  };

  return (
    <Paper
      variant="outlined"
      sx={{ borderRadius: 3, overflow: 'auto', maxHeight: 'min(72vh, 720px)' }}
    >
      <Box
        component="table"
        role="grid"
        aria-label="Online inventory by room type and date"
        aria-rowcount={roomTypes.length + 1}
        aria-colcount={dates.length + 1}
        sx={{
          borderCollapse: 'separate',
          borderSpacing: 0,
          width: '100%',
          minWidth: 180 + dates.length * 96,
        }}
      >
        <Box component="thead">
          <Box component="tr" role="row">
            <Box
              component="th"
              role="columnheader"
              sx={{
                ...headerCellSx,
                left: 0,
                zIndex: 4,
                minWidth: 180,
                borderRight: 1,
              }}
            >
              <Box
                component="button"
                type="button"
                aria-label="Select all cells"
                onClick={onSelectAll}
                sx={{
                  display: 'block',
                  width: '100%',
                  minHeight: 44,
                  px: 1.5,
                  border: 0,
                  bgcolor: 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  color: 'text.secondary',
                  font: 'inherit',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  '&:focus-visible': { outline: `3px solid ${theme.palette.primary.dark}`, outlineOffset: -3 },
                }}
              >
                ROOM TYPE / DATE
              </Box>
            </Box>
            {dates.map((date) => (
              <Box
                component="th"
                role="columnheader"
                key={date}
                sx={{ ...headerCellSx, borderRight: 1, minWidth: 96 }}
              >
                <Box
                  component="button"
                  type="button"
                  aria-label={`Select all on ${HEADER_DATE.format(asDate(date))}`}
                  onClick={() => onSelectColumn(date)}
                  sx={{
                    display: 'block',
                    width: '100%',
                    minHeight: 44,
                    py: 0.5,
                    border: 0,
                    bgcolor: date === today ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
                    cursor: 'pointer',
                    color: 'text.primary',
                    font: 'inherit',
                    '&:focus-visible': { outline: `3px solid ${theme.palette.primary.dark}`, outlineOffset: -3 },
                  }}
                >
                  <Typography variant="caption" component="div" sx={{ color: 'text.secondary', fontWeight: 700 }}>
                    {date === today ? 'Today' : WEEKDAY_SHORT.format(asDate(date))}
                  </Typography>
                  <Typography component="div" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
                    {DAY_NUM.format(asDate(date))}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
        <Box component="tbody">
          {roomTypes.map((room) => (
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
                  p: 0,
                  minWidth: 180,
                  textAlign: 'left',
                }}
              >
                <Box
                  component="button"
                  type="button"
                  aria-label={`Select row ${room.room_type_name}`}
                  onClick={() => onSelectRow(room.room_type_id)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    width: '100%',
                    minHeight: 56,
                    px: 1.5,
                    py: 0.5,
                    border: 0,
                    bgcolor: 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    font: 'inherit',
                    color: 'text.primary',
                    '&:focus-visible': { outline: `3px solid ${theme.palette.primary.dark}`, outlineOffset: -3 },
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 800, lineHeight: 1.2 }} noWrap>
                      {room.room_type_name}
                    </Typography>
                  </Box>
                  <Chip label={room.room_type_code} size="small" variant="outlined" sx={{ ml: 'auto', flexShrink: 0 }} />
                </Box>
              </Box>
              {dates.map((date) => {
                const key = cellKey(room.room_type_id, date);
                const view = cells.get(key);
                if (!view) return <Box component="td" role="gridcell" key={key} />;
                return (
                  <GridCell
                    key={key}
                    view={view}
                    selected={selected.has(key)}
                    focused={focused === key}
                    onSelect={onSelectCell}
                    onOpen={onOpenEditor}
                    onKeyDown={handleKeyDown}
                    onDragStart={handleDragStart}
                    onDragTo={handleDragTo}
                    registerRef={registerRef}
                    formatPrice={formatPrice}
                  />
                );
              })}
            </Box>
          ))}
        </Box>
      </Box>
    </Paper>
  );
};
