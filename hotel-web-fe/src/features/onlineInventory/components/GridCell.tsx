import { memo } from 'react';
import { Box, Typography, alpha, useTheme } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';

import type { CellKey, GridCellView } from '../types';

const FULL_DATE = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export const cellDomId = (key: CellKey) => `inv-cell-${key.replace(':', '-')}`;

export const cellAriaLabel = (view: GridCellView, formatPrice: (v: string) => string): string => {
  const date = FULL_DATE.format(new Date(`${view.stay_date}T12:00:00`));
  const parts = [
    `${view.room_type_name}, ${date}: `,
    view.current.online_booking_enabled
      ? `${view.online_available} online at ${formatPrice(view.effective_price)}`
      : 'closed to online booking',
  ];
  if (view.current.online_booking_enabled && view.online_available === 0) parts.push(', none left');
  if (view.changed) parts.push(', modified');
  if (view.is_reset) parts.push(', reset pending');
  return parts.join('');
};

interface GridCellProps {
  view: GridCellView;
  selected: boolean;
  focused: boolean;
  onSelect(key: CellKey, extend: boolean): void;
  onOpen(key: CellKey, anchor: HTMLElement): void;
  onKeyDown(key: CellKey, event: React.KeyboardEvent): void;
  onDragStart(key: CellKey, shiftKey: boolean): void;
  onDragTo(key: CellKey): void;
  registerRef(key: CellKey, el: HTMLTableCellElement | null): void;
  formatPrice(value: string): string;
}

const GridCellInner = ({
  view,
  selected,
  focused,
  onSelect,
  onOpen,
  onKeyDown,
  onDragStart,
  onDragTo,
  registerRef,
  formatPrice,
}: GridCellProps) => {
  const theme = useTheme();
  const closed = !view.current.online_booking_enabled;
  const soldOut = !closed && view.online_available === 0;
  const customPriced = view.current.custom_price !== null;

  return (
    <Box
      component="td"
      role="gridcell"
      id={cellDomId(view.key)}
      ref={(el: HTMLTableCellElement | null) => registerRef(view.key, el)}
      tabIndex={focused ? 0 : -1}
      aria-selected={selected}
      aria-label={cellAriaLabel(view, formatPrice)}
      onClick={(event) => onSelect(view.key, event.shiftKey)}
      onDoubleClick={(event) => onOpen(view.key, event.currentTarget as HTMLElement)}
      onKeyDown={(event) => onKeyDown(view.key, event)}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse') onDragStart(view.key, event.shiftKey);
      }}
      onPointerEnter={() => onDragTo(view.key)}
      sx={{
        position: 'relative',
        minWidth: 92,
        height: 56,
        px: 1,
        py: 0.5,
        textAlign: 'center',
        verticalAlign: 'middle',
        cursor: 'pointer',
        userSelect: 'none',
        borderBottom: 1,
        borderRight: 1,
        borderColor: 'divider',
        bgcolor: closed
          ? 'action.hover'
          : soldOut
            ? alpha(theme.palette.warning.main, 0.08)
            : selected
              ? alpha(theme.palette.primary.main, 0.08)
              : 'background.paper',
        outline: 'none',
        boxShadow: selected ? `inset 0 0 0 2px ${theme.palette.primary.main}` : 'none',
        '&:focus-visible': {
          boxShadow: `inset 0 0 0 3px ${theme.palette.primary.dark}`,
          zIndex: 1,
        },
        '@media (prefers-reduced-motion: no-preference)': {
          transition: 'background-color 120ms ease, box-shadow 120ms ease',
        },
      }}
    >
      {closed ? (
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
      <Typography
        variant="caption"
        component="div"
        sx={{
          lineHeight: 1.2,
          mt: 0.25,
          fontWeight: customPriced ? 800 : 500,
          color: customPriced ? 'primary.dark' : 'text.secondary',
          ...(customPriced && {
            display: 'inline-block',
            px: 0.75,
            borderRadius: 1,
            bgcolor: alpha(theme.palette.primary.main, 0.1),
          }),
        }}
      >
        {closed ? '·' : formatPrice(view.effective_price)}
      </Typography>
      {soldOut && (
        <Typography
          variant="caption"
          component="div"
          sx={{ lineHeight: 1, color: 'warning.dark', fontWeight: 700 }}
        >
          None left
        </Typography>
      )}
      {(view.changed || view.is_override) && (
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

export const GridCell = memo(GridCellInner);
