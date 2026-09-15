import {
  Box,
  Button,
  Chip,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useMemo, useState } from 'react';
import EmptyState from '../../../components/common/EmptyState';
import StatusChip from '../../../components/common/StatusChip';
import { FilterSheet } from '../../../components/common/FilterSheet';
import { useIsPhone } from '../../../hooks/useIsPhone';
import { statusLabel } from '../../../i18n/statusLabel';
import { useTranslation } from '../../../i18n/useTranslation';
import type { HousekeepingBoardRoom } from '../../../types/housekeeping.types';
import {
  compareRoomsByUrgency,
  PRIORITIES,
  roomNeedsAttention,
  roomStatusMeta,
  ROOM_LANE_ORDER,
} from '../housekeepingConfig';
import RoomTaskCard from './RoomTaskCard';
import type {
  HousekeepingActionContext,
  HousekeepingActionHandlers,
} from './RoomTaskCard';

export interface BoardFilters {
  search: string;
  floor: string;
  status: string;
  priority: string;
  attentionOnly: boolean;
}

export const EMPTY_BOARD_FILTERS: BoardFilters = {
  search: '',
  floor: 'all',
  status: 'all',
  priority: 'all',
  attentionOnly: false,
};

interface BoardViewProps extends HousekeepingActionContext {
  rooms: HousekeepingBoardRoom[];
  isLoading: boolean;
  filters: BoardFilters;
  onFiltersChange: (filters: BoardFilters) => void;
  actions: HousekeepingActionHandlers;
}

const cardGridSx = {
  display: 'grid',
  // Every track is `minmax(0, 1fr)`, including the single xs column. A bare
  // `1fr` is `minmax(auto, 1fr)`, so the track refuses to shrink below its
  // content's min-content width — the xs column measured 357px inside a 320px
  // viewport because a room card's chip row would not compress, and
  // `body { overflow-x: clip }` hid the result instead of showing a scrollbar.
  gridTemplateColumns: {
    xs: 'minmax(0, 1fr)',
    sm: 'repeat(2, minmax(0, 1fr))',
    xl: 'repeat(3, minmax(0, 1fr))',
  },
  gap: 1.5,
  alignItems: 'start',
} as const;

function BoardSkeleton() {
  return (
    <Stack spacing={2.5}>
      {[0, 1].map((lane) => (
        <Box key={lane}>
          <Skeleton variant="text" width={180} sx={{ mb: 1 }} />
          <Box sx={cardGridSx}>
            {[0, 1, 2].map((card) => (
              <Skeleton key={card} variant="rounded" height={132} />
            ))}
          </Box>
        </Box>
      ))}
    </Stack>
  );
}

export default function BoardView({
  rooms,
  isLoading,
  filters,
  onFiltersChange,
  actions,
  ...ctx
}: BoardViewProps) {
  const { t } = useTranslation('housekeeping');
  const floors = useMemo(
    () =>
      Array.from(
        new Set(rooms.map((room) => room.floor).filter((floor): floor is number => floor != null)),
      ).sort((a, b) => a - b),
    [rooms],
  );

  const statuses = useMemo(
    () =>
      ROOM_LANE_ORDER.filter((status) => rooms.some((room) => room.status === status)),
    [rooms],
  );

  const filteredRooms = useMemo(
    () =>
      rooms.filter((room) => {
        if (filters.attentionOnly && !roomNeedsAttention(room)) return false;
        if (filters.search.trim()) {
          const needle = filters.search.trim().toLowerCase();
          const haystack = `${room.room_number} ${room.room_type} ${room.open_task?.assigned_to_name ?? ''}`.toLowerCase();
          if (!haystack.includes(needle)) return false;
        }
        if (filters.floor !== 'all' && String(room.floor) !== filters.floor) return false;
        if (filters.status !== 'all' && room.status !== filters.status) return false;
        if (filters.priority !== 'all' && room.open_task?.priority !== filters.priority) return false;
        return true;
      }),
    [rooms, filters],
  );

  const groupedRooms = useMemo(() => {
    const groups = new Map<string, HousekeepingBoardRoom[]>();
    for (const room of filteredRooms) {
      const key = room.status || 'available';
      groups.set(key, [...(groups.get(key) ?? []), room]);
    }
    return ROOM_LANE_ORDER.map((status) => [status, groups.get(status) ?? []] as const)
      .filter(([, laneRooms]) => laneRooms.length > 0);
  }, [filteredRooms]);

  const activeFilterCount =
    (filters.search.trim() ? 1 : 0) +
    (filters.floor !== 'all' ? 1 : 0) +
    (filters.status !== 'all' ? 1 : 0) +
    (filters.priority !== 'all' ? 1 : 0) +
    (filters.attentionOnly ? 1 : 0);

  const set = (patch: Partial<BoardFilters>) => onFiltersChange({ ...filters, ...patch });
  const isPhone = useIsPhone();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const secondaryFilters = (
    <>
      <FormControl size="small" fullWidth={isPhone} sx={{ minWidth: isPhone ? 0 : 110 }}>
        <InputLabel id="housekeeping-floor-filter">{t('board.floor')}</InputLabel>
        <Select
          labelId="housekeeping-floor-filter"
          label={t('board.floor')}
          value={filters.floor}
          onChange={(event) => set({ floor: event.target.value })}
        >
          <MenuItem value="all">{t('board.allFloors')}</MenuItem>
          {floors.map((floor) => (
            <MenuItem key={floor} value={String(floor)}>
              {t('rooms:header.floorN', { floor })}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControl size="small" fullWidth={isPhone} sx={{ minWidth: isPhone ? 0 : 140 }}>
        <InputLabel id="housekeeping-status-filter">{t('board.roomStatus')}</InputLabel>
        <Select
          labelId="housekeeping-status-filter"
          label={t('board.roomStatus')}
          value={filters.status}
          onChange={(event) => set({ status: event.target.value })}
        >
          <MenuItem value="all">{t('board.allStatuses')}</MenuItem>
          {statuses.map((status) => (
            <MenuItem key={status} value={status}>
              {statusLabel(t, 'room', status)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControl size="small" fullWidth={isPhone} sx={{ minWidth: isPhone ? 0 : 130 }}>
        <InputLabel id="housekeeping-priority-filter">{t('board.priority')}</InputLabel>
        <Select
          labelId="housekeeping-priority-filter"
          label={t('board.priority')}
          value={filters.priority}
          onChange={(event) => set({ priority: event.target.value })}
        >
          <MenuItem value="all">{t('board.allPriorities')}</MenuItem>
          {PRIORITIES.map((priority) => (
            <MenuItem key={priority} value={priority}>
              {statusLabel(t, 'priority', priority)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Chip
        label={t('page.statAttention')}
        color={filters.attentionOnly ? 'primary' : 'default'}
        variant={filters.attentionOnly ? 'filled' : 'outlined'}
        onClick={() => set({ attentionOnly: !filters.attentionOnly })}
        aria-pressed={filters.attentionOnly}
        sx={{ fontWeight: 600 }}
      />
      {activeFilterCount > 0 ? (
        <Chip
          label={t('board.clear', { count: activeFilterCount })}
          variant="outlined"
          onDelete={() => onFiltersChange(EMPTY_BOARD_FILTERS)}
          onClick={() => onFiltersChange(EMPTY_BOARD_FILTERS)}
        />
      ) : null}
    </>
  );

  const searchField = (
    <TextField
      size="small"
      placeholder={t('board.searchPlaceholder')}
      value={filters.search}
      onChange={(event) => set({ search: event.target.value })}
      slotProps={{
        htmlInput: { 'aria-label': t('board.searchAria') },
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
        },
      }}
      sx={{ minWidth: { xs: '100%', sm: 220 } }}
    />
  );

  return (
    <Stack spacing={2}>
      {isPhone ? (
        <>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>{searchField}</Box>
            <Button
              variant="outlined"
              size="small"
              onClick={() => setFiltersOpen(true)}
              sx={{ whiteSpace: 'nowrap', minHeight: 40 }}
            >
              {t('common:filters.title')}{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </Button>
          </Stack>
          <FilterSheet
            open={filtersOpen}
            onClose={() => setFiltersOpen(false)}
            onReset={() => onFiltersChange(EMPTY_BOARD_FILTERS)}
          >
            {secondaryFilters}
          </FilterSheet>
        </>
      ) : (
        <Stack direction="row" spacing={1.25} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          {searchField}
          {secondaryFilters}
        </Stack>
      )}

      {isLoading ? (
        <BoardSkeleton />
      ) : groupedRooms.length === 0 ? (
        <EmptyState
          title={rooms.length === 0 ? t('board.emptyNoRooms') : t('board.emptyFiltered')}
          description={
            rooms.length === 0
              ? t('board.emptyNoRoomsBody')
              : t('board.emptyFilteredBody')
          }
          action={
            activeFilterCount > 0 ? (
              <Chip
                label={t('board.clearAll')}
                variant="outlined"
                onClick={() => onFiltersChange(EMPTY_BOARD_FILTERS)}
              />
            ) : undefined
          }
        />
      ) : (
        <Stack spacing={2.5}>
          {groupedRooms.map(([status, laneRooms]) => {
            const meta = roomStatusMeta(status);
            return (
              <Box key={status} component="section" aria-label={t('board.laneAria', { status: statusLabel(t, 'room', status) })}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
                  <StatusChip status={status} domain="room" tone={meta.tone} variant="filled" />
                  <Chip size="small" variant="outlined" label={laneRooms.length} />
                  {meta.hintKey ? (
                    <Typography
                      variant="caption"
                      sx={{ color: 'text.secondary', display: { xs: 'none', sm: 'block' } }}
                    >
                      {t(meta.hintKey)}
                    </Typography>
                  ) : null}
                </Stack>
                <Box sx={cardGridSx}>
                  {laneRooms
                    .slice()
                    .sort(compareRoomsByUrgency)
                    .map((room) => (
                      <RoomTaskCard key={room.id} room={room} actions={actions} {...ctx} />
                    ))}
                </Box>
              </Box>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
