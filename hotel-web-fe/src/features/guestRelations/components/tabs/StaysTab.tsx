import React from 'react';
import { Box, Link as MuiLink, Typography } from '@mui/material';
import { OpenInNewOutlined as OpenIcon } from '@mui/icons-material';
import type { GuestProfileBooking, GuestSummary } from '../../../../types';
import { useTranslation } from '../../../../i18n/useTranslation';
import { Link } from '../../../../router';
import { GuestReservationsTable } from '../../../guests/components/GuestProfileParts';

interface StaysTabProps {
  reservations: GuestProfileBooking[];
  summary: GuestSummary;
}

/**
 * Guest 360 stays list — the same reservations table the legacy profile
 * dialog renders (shared via GuestReservationsTable), plus a per-row deep
 * link into the booking detail route (`/bookings/$bookingId`).
 */
const StaysTab: React.FC<StaysTabProps> = ({ reservations, summary }) => {
  const { t } = useTranslation('guests');
  return (
  <Box>
    <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
      {t('stays.reservations', { count: reservations.length })}
      {' · '}
      {t('stays.nightsStayed', { count: summary.total_nights })}
    </Typography>
    <GuestReservationsTable
      reservations={reservations}
      renderBookingActions={(booking) => (
        <MuiLink
          component={Link}
          to={`/bookings/${booking.id}`}
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
          {t('stays.openInBookings')}
          <OpenIcon sx={{ fontSize: 13 }} />
        </MuiLink>
      )}
    />
  </Box>
  );
};

export default StaysTab;
