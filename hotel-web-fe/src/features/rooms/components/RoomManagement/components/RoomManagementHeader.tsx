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
import { useIsPhone } from '../../../../../hooks/useIsPhone';
import { SearchAndFilters } from '../../../../../components/common/SearchAndFilters';
import { useTranslation } from '../../../../../i18n/useTranslation';
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
  const isPhone = useIsPhone();
  const { t } = useTranslation('rooms');

  // Non-default selections surfaced on the phone filter-button badge — the
  // same set handleResetFilters restores (status pills, attribute chips, floor
  // chip, attention-first sort; the room# search stays visible so it is not
  // counted).
  const activeFilterCount =
    (statusFilter !== 'all' ? 1 : 0) +
    (attrFilters.smoking ? 1 : 0) +
    (attrFilters.daily ? 1 : 0) +
    (attrFilters.nodaily ? 1 : 0) +
    (floorFilter !== 'all' ? 1 : 0) +
    (prioritySort ? 1 : 0);

  const handleResetFilters = () => {
    onStatusFilterChange('all');
    if (attrFilters.smoking) onToggleAttr('smoking');
    if (attrFilters.daily) onToggleAttr('daily');
    if (attrFilters.nodaily) onToggleAttr('nodaily');
    onFloorFilterChange('all');
    onRoomSearchChange('');
    if (prioritySort) onTogglePrioritySort();
  };

  // --- Shared controlled filter controls ---------------------------------
  // Both layouts render these same elements: desktop lays them out in one
  // inline row, phone mounts them inside the SearchAndFilters FilterSheet.
  // Values/handlers all come from props, so the sheet's unmount-on-close is
  // safe — no local state lives inside these controls.

  const statusFilterGroup = (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={statusFilter}
      onChange={(_, value) => {
        if (value) onStatusFilterChange(value);
      }}
      sx={{ gap: 0.75, rowGap: 0.75, flexWrap: 'wrap' }}
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
  );

  const attributeChips = ([
    { key: 'smoking' as const, label: t('header.attrSmoking'), count: smokingCount, color: 'var(--hotel-warning)', icon: <SmokingIcon sx={{ fontSize: 15 }} /> },
    { key: 'daily' as const, label: t('header.attrDaily'), count: dailyCleaningCount, color: 'var(--hotel-success)', icon: <SparkleIcon sx={{ fontSize: 15 }} /> },
    { key: 'nodaily' as const, label: t('header.attrNoDaily'), count: noCleaningCount, color: 'var(--hotel-neutral)', icon: <BlockIcon sx={{ fontSize: 15 }} /> },
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
  });

  const floorChips = (['all', ...floors] as (number | 'all')[]).map((floor) => {
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
          {floor === 'all' ? t('header.allFloors') : t('header.floorN', { floor })}
        </Typography>
      </Box>
    );
  });

  const searchField = (
    <TextField
      size="small"
      value={roomSearch}
      onChange={(e) => onRoomSearchChange(e.target.value)}
      placeholder={t('header.roomSearchPlaceholder')}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
            </InputAdornment>
          ),
        },
        htmlInput: { 'aria-label': t('header.roomSearchAria') },
      }}
      sx={{
        width: isPhone ? '100%' : 110,
        '& .MuiInputBase-root': {
          borderRadius: 999,
          fontSize: isPhone ? '0.875rem' : '0.75rem',
          height: isPhone ? 40 : 30,
        },
      }}
    />
  );

  const attentionFirstToggle = (
    <Box
      component="button"
      onClick={onTogglePrioritySort}
      title={t('header.prioritySortTitle')}
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
      <Typography variant="caption" sx={{ fontWeight: 700 }}>{t('header.prioritySort')}</Typography>
    </Box>
  );

  const sheetSectionLabel = (text: string) => (
    <Typography
      variant="caption"
      sx={{ display: 'block', fontWeight: 600, color: 'text.secondary', mb: 0.75 }}
    >
      {text}
    </Typography>
  );

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
              {t('header.title')}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
              {t('header.roomsCount', { count: rooms.length })}
              {(() => {
                const floors = Array.from(
                  new Set(rooms.map((r) => r.floor).filter((f): f is number => f != null))
                ).sort((a, b) => a - b);
                if (floors.length === 0) return '';
                if (floors.length === 1) return ` · ${t('header.floorSingle', { floor: floors[0] })}`;
                return ` · ${t('header.floorRange', { first: floors[0], last: floors[floors.length - 1] })}`;
              })()}
              {' · '}
              {t('header.occupancy', { rate: occupancyRate })}
            </Typography>
          </Box>
        </Box>

        {/* Center: today's date */}
        <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600 }}>
            {formatHotelDate(new Date())} · {t('header.liveStatus')}
          </Typography>
        </Box>

        {/* Quick Stats - soft tinted tiles */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {([
            { count: availableCount, label: t('header.statAvailable'), status: 'available' as const, show: true },
            { count: occupiedCount, label: t('header.statOccupied'), status: 'occupied' as const, show: true },
            { count: reservedCount, label: t('header.statReserved'), status: 'reserved' as const, show: true },
            { count: dirtyCount, label: t('header.statDirty'), status: 'dirty' as const, show: dirtyCount > 0 },
            { count: maintenanceCount, label: t('header.statMaintenance'), status: 'maintenance' as const, show: maintenanceCount > 0 },
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

      {/* Filters: phone → search + badged sheet via SearchAndFilters;
          desktop → the same controls in the original inline row. */}
      {isPhone ? (
        <SearchAndFilters
          search={searchField}
          activeFilterCount={activeFilterCount}
          onReset={handleResetFilters}
          sheetTitle={t('header.filtersTitle')}
        >
          <Box>
            {sheetSectionLabel(t('header.sectionStatus'))}
            {statusFilterGroup}
          </Box>
          <Box>
            {sheetSectionLabel(t('header.sectionAttributes'))}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {attributeChips}
            </Box>
          </Box>
          {floors.length > 1 && (
            <Box>
              {sheetSectionLabel(t('header.sectionFloor'))}
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {floorChips}
              </Box>
            </Box>
          )}
          <Box>
            {sheetSectionLabel(t('header.sectionSort'))}
            {attentionFirstToggle}
          </Box>
        </SearchAndFilters>
      ) : (
        /* Status Filters */
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', px: 2.5, py: 1.25 }}>
          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', mr: 0.5 }}>
            {t('header.filter')}
          </Typography>
          {statusFilterGroup}

          {/* Divider between status filters and quick attribute filters */}
          <Box sx={{ width: '1px', height: 26, bgcolor: 'divider', mx: 0.5 }} />

          {/* Quick attribute filters (independent toggles) */}
          {attributeChips}

          {/* Floor filter — only useful when the property spans floors */}
          {floors.length > 1 && (
            <>
              <Box sx={{ width: '1px', height: 26, bgcolor: 'divider', mx: 0.5 }} />
              {floorChips}
            </>
          )}

          {/* Room-number search + attention-first sort, pushed to the row end */}
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
            {searchField}
            {attentionFirstToggle}
          </Box>
        </Box>
      )}
    </Paper>
  );
};

export default RoomManagementHeader;
