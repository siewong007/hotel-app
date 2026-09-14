import React from 'react';
import { Box, FormControl, InputLabel, MenuItem, Select } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import ModernDatePicker from '../../../components/common/ModernDatePicker';
import { ReportsService } from '../../../api/reports.service';
import { RoomsService } from '../../../api/rooms.service';
import type { RevenueOverviewParams } from '../types';

interface RevenueFiltersProps {
  value: RevenueOverviewParams;
  onChange: (next: RevenueOverviewParams) => void;
}

/**
 * Stay-date window + optional room-type/channel narrowing. Filters apply to
 * both the stay-date KPIs and the booking-date attribution sections.
 */
const RevenueFilters: React.FC<RevenueFiltersProps> = ({ value, onChange }) => {
  const roomTypes = useQuery({
    queryKey: ['room-types'],
    queryFn: () => RoomsService.getRoomTypes(),
    staleTime: 5 * 60 * 1000,
  });
  const channels = useQuery({
    queryKey: ['booking-channels'],
    queryFn: () => ReportsService.listBookingChannels(),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(4, minmax(0, 1fr))' },
        gap: 2,
        mb: 3,
      }}
    >
      <ModernDatePicker
        label="From (stay date)"
        value={value.from ?? ''}
        onChange={(from) => onChange({ ...value, from: from || undefined })}
        margin="none"
        size="small"
        maxDate={value.to}
      />
      <ModernDatePicker
        label="To (last night)"
        value={value.to ?? ''}
        onChange={(to) => onChange({ ...value, to: to || undefined })}
        margin="none"
        size="small"
        minDate={value.from}
      />
      <FormControl size="small" fullWidth>
        <InputLabel id="revenue-room-type-label">Room type</InputLabel>
        <Select
          labelId="revenue-room-type-label"
          label="Room type"
          value={value.room_type_id === undefined ? '' : String(value.room_type_id)}
          onChange={(event) =>
            onChange({
              ...value,
              room_type_id:
                event.target.value === '' ? undefined : Number(event.target.value),
            })
          }
        >
          <MenuItem value="">All room types</MenuItem>
          {(roomTypes.data ?? []).map((roomType) => (
            <MenuItem key={roomType.id} value={String(roomType.id)}>
              {roomType.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControl size="small" fullWidth>
        <InputLabel id="revenue-channel-label">Channel</InputLabel>
        <Select
          labelId="revenue-channel-label"
          label="Channel"
          value={value.channel_id === undefined ? '' : String(value.channel_id)}
          onChange={(event) =>
            onChange({
              ...value,
              channel_id:
                event.target.value === '' ? undefined : Number(event.target.value),
            })
          }
        >
          <MenuItem value="">All channels</MenuItem>
          {(channels.data ?? []).map((channel) => (
            <MenuItem key={channel.id} value={String(channel.id)}>
              {channel.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Box>
  );
};

export default RevenueFilters;
