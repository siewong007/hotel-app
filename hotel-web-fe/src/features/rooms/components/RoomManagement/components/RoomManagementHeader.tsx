// Page header for Room Management: title + room/floor summary, today's date,
// quick status stat tiles, and the status / attribute filter rows.

import React from 'react';
import { Box, Paper, Typography, ToggleButton, ToggleButtonGroup, TextField, InputAdornment } from '@mui/material';
import {
  Hotel as HotelIcon,
  Block as BlockIcon,
  SmokingRooms as SmokingIcon,
  AutoAwesome as SparkleIcon,
  Search as SearchIcon,
  Sort as SortIcon,
} from '@mui/icons-material';
import type { Room } from '../../../../../types';
import { formatHotelDate } from '../../../../../utils/date';
import type { RoomStatusType } from '../../../config';
import { getStatusAccentColor } from '../../../config';
import type {
  RoomFilterOption,
  RoomAttributeFilters,
} from '../../../hooks/useRoomManagementFilters';

/** Alpha-composite a color that may be a `var(--hotel-*)` token — MUI `alpha()`
 *  can't parse CSS variables, `color-mix` handles both hex and var(). */
const tint = (color: string, pct: number) =>
  `color-mix(in srgb, ${color} ${pct}%, transparent)`;

interface RoomManagementHeaderProps {
  rooms: Room[];
  occupancyRate: number;
  availableCount: number;
  occupiedCount: number;
  reservedCount: number;
  dirtyCount: number;
  maintenanceCount: number;
  statusFilter: RoomStatusType | 'all';
  onStatusFilterChange: (value: RoomStatusType | 'all') => void;
  filterOptions: RoomFilterOption[];
  attrFilters: RoomAttributeFilters;
  onToggleAttr: (key: keyof RoomAttributeFilters) => void;
  smokingCount: number;
  dailyCleaningCount: number;
  noCleaningCount: number;
  floors: number[];
  floorFilter: number | 'all';
  onFloorFilterChange: (value: number | 'all') => void;
  roomSearch: string;
  onRoomSearchChange: (value: string) => void;
  prioritySort: boolean;
  onTogglePrioritySort: () => void;
}

const RoomManagementHeader: React.FC<RoomManagementHeaderProps> = ({
  rooms,
  occupancyRate,
  availableCount,
  occupiedCount,
  reservedCount,
  dirtyCount,
  maintenanceCount,
  statusFilter,
  onStatusFilterChange,
  filterOptions,
  attrFilters,
  onToggleAttr,
  smokingCount,
  dailyCleaningCount,
  noCleaningCount,
  floors,
  floorFilter,
  onFloorFilterChange,
  roomSearch,
  onRoomSearchChange,
  prioritySort,
  onTogglePrioritySort,
}) => {
  return (
    <Paper
      elevation={0}
      sx={{
        mb: 0,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      {/* Title and Stats Row */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 2,
        px: 2.5,
        py: 2,
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}>
        {/* Title Section with icon badge */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: 1.5,
              bgcolor: 'var(--hotel-primary-subtle)',
              color: 'var(--hotel-primary-text)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <HotelIcon sx={{ fontSize: 24 }} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '1.25rem', lineHeight: 1.15, letterSpacing: '-0.01em' }}>
              Hotel Manager — Rooms
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
              {rooms.length} rooms
              {(() => {
                const floors = Array.from(
                  new Set(rooms.map((r) => r.floor).filter((f): f is number => f != null))
                ).sort((a, b) => a - b);
                if (floors.length === 0) return '';
                if (floors.length === 1) return ` · floor ${floors[0]}`;
                return ` · floors ${floors[0]}–${floors[floors.length - 1]}`;
              })()}
              {' · '}
              {occupancyRate}% occupied
            </Typography>
          </Box>
        </Box>

        {/* Center: today's date */}
        <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600 }}>
            {formatHotelDate(new Date())} · live status
          </Typography>
        </Box>

        {/* Quick Stats - soft tinted tiles */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {([
            { count: availableCount, label: 'Available', status: 'available' as const, show: true },
            { count: occupiedCount, label: 'Occupied', status: 'occupied' as const, show: true },
            { count: reservedCount, label: 'Reserved', status: 'reserved' as const, show: true },
            { count: dirtyCount, label: 'Dirty', status: 'dirty' as const, show: dirtyCount > 0 },
            { count: maintenanceCount, label: 'Maintenance', status: 'maintenance' as const, show: maintenanceCount > 0 },
          ])
            .map((s) => ({ ...s, color: getStatusAccentColor(s.status) }))
            .filter((s) => s.show)
            .map((s) => (
              <Box
                key={s.label}
                sx={{
                  px: 1.75,
                  py: 0.85,
                  minWidth: 64,
                  borderRadius: 1.5,
                  textAlign: 'center',
                  bgcolor: tint(s.color, 12),
                  border: '1px solid',
                  borderColor: tint(s.color, 40),
                  color: s.color,
                }}
              >
                <Typography sx={{ fontWeight: 800, fontSize: '1.1rem', lineHeight: 1 }}>
                  {s.count}
                </Typography>
                <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.65rem', letterSpacing: 0.3 }}>
                  {s.label}
                </Typography>
              </Box>
            ))}
        </Box>
      </Box>

      {/* Status Filters */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', px: 2.5, py: 1.25 }}>
        <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', mr: 0.5 }}>
          Filter:
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={statusFilter}
          onChange={(_, value) => {
            if (value) onStatusFilterChange(value);
          }}
          sx={{ gap: 0.75, flexWrap: 'wrap' }}
        >
          {filterOptions.map((item) => {
            const selected = statusFilter === item.value;
            return (
              <ToggleButton
                key={item.value}
                value={item.value}
                sx={{
                  border: '1px solid !important',
                  borderColor: selected ? `${tint(item.color === 'transparent' ? 'var(--hotel-text)' : item.color, 55)} !important` : 'divider',
                  borderRadius: '999px !important',
                  px: 1.5,
                  py: 0.4,
                  gap: 0.75,
                  color: 'text.primary',
                  bgcolor: selected
                    ? (item.color === 'transparent' ? 'action.selected' : tint(item.color, 12))
                    : 'background.paper',
                  textTransform: 'none',
                  '&:hover': { bgcolor: item.color === 'transparent' ? 'action.hover' : tint(item.color, 8) },
                }}
              >
                <Box
                  sx={{
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    bgcolor: item.color,
                    border: item.value === 'all' ? '1px solid' : 0,
                    borderColor: 'divider',
                  }}
                />
                <Typography variant="caption" sx={{ fontWeight: 700 }}>{item.label}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                  {item.count}
                </Typography>
              </ToggleButton>
            );
          })}
        </ToggleButtonGroup>

        {/* Divider between status filters and quick attribute filters */}
        <Box sx={{ width: '1px', height: 26, bgcolor: 'divider', mx: 0.5 }} />

        {/* Quick attribute filters (independent toggles) */}
        {([
          { key: 'smoking' as const, label: 'Smoking', count: smokingCount, color: 'var(--hotel-warning)', icon: <SmokingIcon sx={{ fontSize: 15 }} /> },
          { key: 'daily' as const, label: 'Daily cleaning', count: dailyCleaningCount, color: 'var(--hotel-success)', icon: <SparkleIcon sx={{ fontSize: 15 }} /> },
          { key: 'nodaily' as const, label: 'No cleaning', count: noCleaningCount, color: 'var(--hotel-neutral)', icon: <BlockIcon sx={{ fontSize: 15 }} /> },
        ]).map((item) => {
          const selected = attrFilters[item.key];
          return (
            <Box
              key={item.key}
              component="button"
              onClick={() => onToggleAttr(item.key)}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.75,
                px: 1.5,
                py: 0.5,
                cursor: 'pointer',
                border: '1px solid',
                borderColor: selected ? tint(item.color, 55) : 'divider',
                borderRadius: '999px',
                color: 'text.primary',
                bgcolor: selected ? tint(item.color, 12) : 'background.paper',
                font: 'inherit',
                '&:hover': { bgcolor: selected ? tint(item.color, 18) : tint(item.color, 6) },
                '& svg': { color: item.color },
              }}
            >
              {item.icon}
              <Typography variant="caption" sx={{ fontWeight: 700 }}>{item.label}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                {item.count}
              </Typography>
            </Box>
          );
        })}

        {/* Floor filter — only useful when the property spans floors */}
        {floors.length > 1 && (
          <>
            <Box sx={{ width: '1px', height: 26, bgcolor: 'divider', mx: 0.5 }} />
            {(['all', ...floors] as (number | 'all')[]).map((floor) => {
              const selected = floorFilter === floor;
              return (
                <Box
                  key={floor}
                  component="button"
                  onClick={() => onFloorFilterChange(floor)}
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    px: 1.25,
                    py: 0.5,
                    cursor: 'pointer',
                    border: '1px solid',
                    borderColor: selected ? tint('var(--hotel-info)', 55) : 'divider',
                    borderRadius: '999px',
                    color: 'text.primary',
                    bgcolor: selected ? 'var(--hotel-info-bg)' : 'background.paper',
                    font: 'inherit',
                    '&:hover': { bgcolor: selected ? tint('var(--hotel-info)', 18) : 'action.hover' },
                  }}
                >
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>
                    {floor === 'all' ? 'All floors' : `Floor ${floor}`}
                  </Typography>
                </Box>
              );
            })}
          </>
        )}

        {/* Room-number search + attention-first sort, pushed to the row end */}
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
          <TextField
            size="small"
            value={roomSearch}
            onChange={(e) => onRoomSearchChange(e.target.value)}
            placeholder="Room #"
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                  </InputAdornment>
                ),
              },
              htmlInput: { 'aria-label': 'Search by room number' },
            }}
            sx={{
              width: 110,
              '& .MuiInputBase-root': { borderRadius: 999, fontSize: '0.75rem', height: 30 },
            }}
          />
          <Box
            component="button"
            onClick={onTogglePrioritySort}
            title="Sort rooms by attention needed (dirty, maintenance, reserved first)"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.6,
              px: 1.25,
              py: 0.5,
              cursor: 'pointer',
              border: '1px solid',
              borderColor: prioritySort ? tint('var(--hotel-warning)', 55) : 'divider',
              borderRadius: '999px',
              color: 'text.primary',
              bgcolor: prioritySort ? 'var(--hotel-warning-bg)' : 'background.paper',
              font: 'inherit',
              '&:hover': { bgcolor: prioritySort ? tint('var(--hotel-warning)', 18) : 'action.hover' },
              '& svg': { color: 'var(--hotel-warning)' },
            }}
          >
            <SortIcon sx={{ fontSize: 15 }} />
            <Typography variant="caption" sx={{ fontWeight: 700 }}>Attention first</Typography>
          </Box>
        </Box>
      </Box>
    </Paper>
  );
};

export default RoomManagementHeader;
