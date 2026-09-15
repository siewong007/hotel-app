import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  Grid,
  Button,
} from '@mui/material';
import { Settings as SettingsIcon } from '@mui/icons-material';
import { Room } from '../../../../../types';
import { useTranslation } from '../../../../../i18n/useTranslation';
import { statusLabel } from '../../../../../i18n/statusLabel';
import { toMoneyNumber } from '../../../../../utils/money';

interface RoomDetailsDialogProps {
  open: boolean;
  onClose: () => void;
  room: Room | null;
  formatCurrency: (value: number) => string;
}

const RoomDetailsDialog: React.FC<RoomDetailsDialogProps> = ({
  open,
  onClose,
  room,
  formatCurrency,
}) => {
  const { t } = useTranslation('rooms');
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ bgcolor: 'primary.main', color: 'var(--hotel-on-primary)', py: 2, px: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <SettingsIcon sx={{ fontSize: 28 }} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            {t('detailsDialog.title', { room: room?.room_number })}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        {room && (
          <Box sx={{ mt: 2 }}>
            <Grid container spacing={2}>
              <Grid size={6}>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>{t('fields.roomNumber')}</Typography>
                <Typography variant="body1" sx={{
                  fontWeight: 600
                }}>{room.room_number}</Typography>
              </Grid>
              <Grid size={6}>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>{t('fields.roomType')}</Typography>
                <Typography variant="body1" sx={{
                  fontWeight: 600
                }}>{room.room_type}</Typography>
              </Grid>
              <Grid size={6}>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>{t('fields.pricePerNight')}</Typography>
                <Typography variant="body1" sx={{
                  fontWeight: 600
                }}>{formatCurrency(toMoneyNumber(room.price_per_night))}</Typography>
              </Grid>
              <Grid size={6}>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>{t('fields.maxOccupancy')}</Typography>
                <Typography variant="body1" sx={{
                  fontWeight: 600
                }}>{t('common:count.guests', { count: room.max_occupancy ?? 0 })}</Typography>
              </Grid>
              <Grid size={12}>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>{t('fields.status')}</Typography>
                <Typography variant="body1" sx={{
                  fontWeight: 600
                }}>{statusLabel(t, 'room', room.status)}</Typography>
              </Grid>
              {room.description && (
                <Grid size={12}>
                  <Typography variant="caption" sx={{
                    color: "text.secondary"
                  }}>{t('fields.description')}</Typography>
                  <Typography variant="body2">{room.description}</Typography>
                </Grid>
              )}
            </Grid>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'var(--hotel-surface-raised)', borderTop: 1, borderColor: 'divider' }}>
        <Button onClick={onClose} variant="outlined">{t('common:actions.close')}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default RoomDetailsDialog;
