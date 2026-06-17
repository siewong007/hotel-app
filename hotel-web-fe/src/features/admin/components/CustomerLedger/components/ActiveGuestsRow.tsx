// Active company-billed guests strip shown above the ledger detail tabs.
// Each chip's delete affordance triggers checkout for that booking.

import React from 'react';
import { Box, Typography, Chip } from '@mui/material';
import { Logout as CheckOutIcon } from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import type { BookingWithDetails } from '../../../../../types';

interface ActiveGuestsRowProps {
  bookings: BookingWithDetails[];
  onCheckout: (booking: BookingWithDetails) => void;
}

const ActiveGuestsRow: React.FC<ActiveGuestsRowProps> = ({ bookings, onCheckout }) => {
  if (bookings.length === 0) return null;

  return (
    <Box
      sx={{
        px: 2.5,
        py: 1.5,
        bgcolor: (theme) => alpha(theme.palette.success.main, 0.08),
        borderBottom: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 1,
      }}
    >
      <Typography
        variant="caption"
        sx={{
          fontWeight: 700,
          color: 'success.dark',
          letterSpacing: 0.4,
          textTransform: 'uppercase',
        }}
      >
        {bookings.length} active guest{bookings.length > 1 ? 's' : ''}:
      </Typography>
      {bookings.map((booking) => (
        <Chip
          key={booking.id}
          size="small"
          label={
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
              <span>Room {booking.room_number}</span>
              <Box component="span" sx={{ color: 'text.disabled' }}>/</Box>
              <span>{booking.guest_name}</span>
            </Box>
          }
          onDelete={() => onCheckout(booking)}
          deleteIcon={
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.25,
                fontSize: 11,
                fontWeight: 700,
                color: 'error.main',
                px: 0.5,
              }}
            >
              <CheckOutIcon sx={{ fontSize: 13 }} /> Out
            </Box>
          }
          sx={{
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            '& .MuiChip-label': { fontSize: 12 },
          }}
        />
      ))}
    </Box>
  );
};

export default ActiveGuestsRow;
