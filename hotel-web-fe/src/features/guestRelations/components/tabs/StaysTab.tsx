import React from 'react';
import { Box, Link as MuiLink, Typography } from '@mui/material';
import { OpenInNewOutlined as OpenIcon } from '@mui/icons-material';
import type { GuestProfileBooking, GuestSummary } from '../../../../types';
import { Link } from '../../../../router';
import { GuestReservationsTable } from '../../../guests/components/GuestProfileParts';

interface StaysTabProps {
  reservations: GuestProfileBooking[];
  summary: GuestSummary;
}

/**
 * Guest 360 stays list — the same reservations table the legacy profile
 * dialog renders (shared via GuestReservationsTable), plus a per-row deep
 * link into the bookings workspace (`?booking_id=` selects the row and opens
 * its detail panel there).
 */
const StaysTab: React.FC<StaysTabProps> = ({ reservations, summary }) => (
  <Box>
    <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
      {reservations.length} reservation{reservations.length === 1 ? '' : 's'}
      {' · '}
      {summary.total_nights} night{summary.total_nights === 1 ? '' : 's'} stayed
    </Typography>
    <GuestReservationsTable
      reservations={reservations}
      renderBookingActions={(booking) => (
        <MuiLink
          component={Link}
          to="/bookings"
          search={{ booking_id: booking.id }}
          underline="hover"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          Open in Bookings
          <OpenIcon sx={{ fontSize: 13 }} />
        </MuiLink>
      )}
    />
  </Box>
);

export default StaysTab;
