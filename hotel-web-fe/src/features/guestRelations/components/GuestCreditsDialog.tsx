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
import { useTranslation } from '../../../i18n/useTranslation';
import { useGuestCredits } from '../../guests/hooks/useGuestQueries';

interface GuestCreditsDialogProps {
  guest: Guest | null;
  open: boolean;
  onClose: () => void;
}

/** Free-night credits breakdown by room type — ported from the monolith. */
const GuestCreditsDialog: React.FC<GuestCreditsDialogProps> = ({ guest, open, onClose }) => {
  const { t } = useTranslation('guests');
  const guestCreditsQuery = useGuestCredits(guest?.id, open && !!guest);
  const guestCredits = guestCreditsQuery.data ?? null;
  const loading = guestCreditsQuery.isPending && open;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <GiftIcon color="secondary" />
        {t('credits.title', { name: guest?.nick_name ?? '' })}
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
                  {t('credits.byRoomType')}
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
                        {t('credits.code', { code: credit.room_type_code })}
                      </Typography>
                    </Box>
                    <Chip
                      icon={<GiftIcon sx={{ fontSize: 16 }} />}
                      label={t('stays.nights', { count: credit.nights_available })}
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
                {t('credits.totalAvailable')}
              </Typography>
              <Chip
                icon={<GiftIcon />}
                label={t('stays.nights', { count: guestCredits.total_nights })}
                color="secondary"
                sx={{ fontSize: '1rem', py: 2 }}
              />
            </Box>

            {guestCredits.total_nights === 0 && (
              <Alert severity="info" sx={{ mt: 2 }}>
                {t('credits.noneAvailable')}
              </Alert>
            )}
          </Box>
        ) : (
          <Alert severity="info">
            {t('credits.unavailable')}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:actions.close')}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default GuestCreditsDialog;
