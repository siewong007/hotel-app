import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Skeleton,
  Typography,
} from '@mui/material';
import { CardGiftcard as GiftIcon } from '@mui/icons-material';
import type { Guest } from '../../../types';
import { useGuestCredits } from '../../guests/hooks/useGuestQueries';

interface GuestCreditsDialogProps {
  guest: Guest | null;
  open: boolean;
  onClose: () => void;
}

/** Free-night credits breakdown by room type — ported from the monolith. */
const GuestCreditsDialog: React.FC<GuestCreditsDialogProps> = ({ guest, open, onClose }) => {
  const guestCreditsQuery = useGuestCredits(guest?.id, open && !!guest);
  const guestCredits = guestCreditsQuery.data ?? null;
  const loading = guestCreditsQuery.isPending && open;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <GiftIcon color="secondary" />
        Free Gift Credits: {guest?.nick_name}
      </DialogTitle>
      <DialogContent>
        {loading ? (
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Skeleton variant="text" width={160} height={24} />
            <Skeleton variant="rounded" height={110} />
          </Box>
        ) : guestCredits ? (
          <Box>
            {guestCredits.credits_by_room_type.length > 0 && (
              <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 1 }}>
                  Credits by Room Type:
                </Typography>
                {guestCredits.credits_by_room_type.map((credit) => (
                  <Box
                    key={credit.id}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      backgroundColor: 'success.light',
                      borderRadius: 1,
                      px: 2,
                      py: 1,
                      mb: 1,
                    }}
                  >
                    <Box>
                      <Typography variant="body1" sx={{ fontWeight: 600 }}>
                        {credit.room_type_name}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        Code: {credit.room_type_code}
                      </Typography>
                    </Box>
                    <Chip
                      icon={<GiftIcon sx={{ fontSize: 16 }} />}
                      label={`${credit.nights_available} night${credit.nights_available !== 1 ? 's' : ''}`}
                      color="success"
                    />
                  </Box>
                ))}
              </Box>
            )}

            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderTop: '2px solid',
                borderColor: 'divider',
                pt: 2,
                mt: 2,
              }}
            >
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                Total Available:
              </Typography>
              <Chip
                icon={<GiftIcon />}
                label={`${guestCredits.total_nights} night${guestCredits.total_nights !== 1 ? 's' : ''}`}
                color="secondary"
                sx={{ fontSize: '1rem', py: 2 }}
              />
            </Box>

            {guestCredits.total_nights === 0 && (
              <Alert severity="info" sx={{ mt: 2 }}>
                This guest has no complimentary credits available.
              </Alert>
            )}
          </Box>
        ) : (
          <Alert severity="info">
            No credits information available.
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default GuestCreditsDialog;
