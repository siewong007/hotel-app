import React from 'react';
import { Box, Typography, IconButton } from '@mui/material';
import { Hotel as HotelIcon, Close as CloseIcon } from '@mui/icons-material';
import { Room } from '../../../../../types';
import { BookingTokens } from '../bookingTokens';

interface BookingModalHeaderProps {
  D: BookingTokens;
  room: Room | null;
  roomCount: number;
  selectedRoomNumbers: string;
  roomIsAvailable: boolean | null;
  processing: boolean;
  onClose: () => void;
}

const BookingModalHeader: React.FC<BookingModalHeaderProps> = ({
  D,
  room,
  roomCount,
  selectedRoomNumbers,
  roomIsAvailable,
  processing,
  onClose,
}) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, px: 2.75, py: 2, borderBottom: `1px solid ${D.border}`, bgcolor: D.surface }}>
    <Box sx={{
      width: 40,
      height: 40,
      borderRadius: 1.25,
      background: `linear-gradient(135deg, ${D.emerald}, ${D.emeraldDeep})`,
      display: 'grid',
      placeItems: 'center',
      color: '#fff',
    }}>
      <HotelIcon sx={{ fontSize: 22 }} />
    </Box>
    <Box>
      <Typography sx={{ m: 0, fontSize: 17, fontWeight: 700, color: D.ink, lineHeight: 1.2 }}>
        New Booking
      </Typography>
      <Typography sx={{ m: 0, mt: '2px', fontSize: 12, color: D.ink3 }}>
        Set type, guest, dates and rate — all on one screen
      </Typography>
    </Box>
    <Box sx={{ flex: 1 }} />
    {room && (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, bgcolor: D.surface2, border: `1px solid ${D.border}`, borderRadius: 1.25, px: 1.5, py: 0.75 }}>
        <Typography sx={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.5px', color: D.ink, lineHeight: 1 }}>
          {roomCount > 1 ? `${roomCount} rooms` : room.room_number}
        </Typography>
        <Box>
          <Typography sx={{ fontSize: 10, fontWeight: 700, color: D.ink3, letterSpacing: 0.6, textTransform: 'uppercase' }}>
            {roomCount > 1 ? selectedRoomNumbers : room.room_type}
          </Typography>
          <Typography sx={{ fontSize: 11, fontWeight: 700, color: D.green, mt: '1px' }}>
            ● {roomIsAvailable === false ? 'Unavailable' : 'Available'}
          </Typography>
        </Box>
      </Box>
    )}
    <IconButton
      onClick={onClose}
      disabled={processing}
      aria-label="Close"
      sx={{
        width: 32,
        height: 32,
        borderRadius: 1,
        color: D.ink3,
        border: '1px solid transparent',
        '&:hover': { borderColor: D.border, bgcolor: D.surface2, color: D.ink },
      }}
    >
      <CloseIcon sx={{ fontSize: 18 }} />
    </IconButton>
  </Box>
);

export default BookingModalHeader;
