import React from 'react';
import { Box, Typography, TextField, Autocomplete } from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import { Room } from '../../../../../types';
import { BookingTokens } from '../bookingTokens';
import SectionHeader from './SectionHeader';

interface RoomPickerSectionProps {
  D: BookingTokens;
  selectedRooms: Room[];
  onRoomsChange: (rooms: Room[]) => void;
  availableRooms: Room[];
  loadingAvailableRooms: boolean;
  checkInDate: string;
  checkOutDate: string;
  currencySymbol: string;
  selectedRoomNumbers: string;
}

/**
 * Multi-room picker shown only when the modal is opened without a
 * pre-selected room (e.g. the "Add booking" CTA on the Bookings page).
 */
const RoomPickerSection: React.FC<RoomPickerSectionProps> = ({
  D,
  selectedRooms,
  onRoomsChange,
  availableRooms,
  loadingAvailableRooms,
  checkInDate,
  checkOutDate,
  currencySymbol,
  selectedRoomNumbers,
}) => (
  <Box sx={{ mb: 2.75 }}>
    <SectionHeader D={D} number="①" label="Room" />
    <Autocomplete
      multiple
      size="small"
      value={selectedRooms}
      onChange={(_, value) => onRoomsChange(value)}
      options={
        checkInDate && checkOutDate
          ? availableRooms
          : []
      }
      loading={loadingAvailableRooms}
      getOptionLabel={(o) => o ? `Room ${o.room_number} · ${o.room_type}` : ''}
      isOptionEqualToValue={(o, v) => String(o.id) === String(v?.id)}
      renderOption={(props, option) => {
        const { key, ...rest } = props;
        const price = typeof option.price_per_night === 'string'
          ? parseFloat(option.price_per_night)
          : (option.price_per_night || 0);
        return (
          <Box component="li" key={key} {...rest} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ fontWeight: 800, fontSize: 16, letterSpacing: '-0.5px', color: D.ink, minWidth: 38 }}>
              {option.room_number}
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ fontSize: 13, fontWeight: 600, color: D.ink, textTransform: 'capitalize' }}>
                {option.room_type}
              </Box>
              <Box sx={{ fontSize: 11, color: D.ink3 }}>
                {price > 0 ? `${currencySymbol} ${price.toFixed(2)} / night` : 'Rate not set'}
                {option.floor != null ? ` · Floor ${option.floor}` : ''}
              </Box>
            </Box>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder={
            !checkInDate || !checkOutDate
              ? 'Pick rooms (set dates below to filter by availability)'
              : loadingAvailableRooms
                ? 'Loading available rooms…'
                : 'Select one or more rooms'
          }
          sx={{ bgcolor: D.surface }}
          InputProps={{
            ...params.InputProps,
            startAdornment: (
              <>
                <Box sx={{ pl: 0.5, pr: 0.75, color: D.ink3, display: 'inline-flex' }}>
                  <SearchIcon sx={{ fontSize: 16 }} />
                </Box>
                {params.InputProps.startAdornment}
              </>
            ),
          }}
        />
      )}
    />
    {checkInDate && checkOutDate && availableRooms.length === 0 && !loadingAvailableRooms && (
      <Typography sx={{ mt: 0.75, fontSize: 11, color: D.ink3, fontStyle: 'italic' }}>
        No rooms available for the selected dates — pick different dates below.
      </Typography>
    )}
    {selectedRooms.length > 1 && (
      <Typography sx={{ mt: 0.75, fontSize: 11, color: D.emerald, fontWeight: 700 }}>
        {selectedRooms.length} rooms selected: {selectedRoomNumbers}
      </Typography>
    )}
  </Box>
);

export default RoomPickerSection;
