import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  Grid,
  Paper,
  TextField,
  Alert,
  Button,
  CircularProgress,
} from '@mui/material';
import { CardGiftcard as GiftIcon } from '@mui/icons-material';
import { Room, BookingWithDetails } from '../../../../../types';
import { toMoneyNumber } from '../../../../../utils/money';
import { useTranslation } from '../../../../../i18n/useTranslation';
import { formatHotelDate } from '../../../../../utils/date';

interface MarkComplimentaryDialogProps {
  open: boolean;
  onClose: () => void;
  onCancel: () => void;
  booking: BookingWithDetails | null;
  room: Room | null;
  currencySymbol: string;
  reason: string;
  onReasonChange: (value: string) => void;
  processing: boolean;
  onConfirm: () => void;
}

const MarkComplimentaryDialog: React.FC<MarkComplimentaryDialogProps> = ({
  open,
  onClose,
  onCancel,
  booking,
  room,
  currencySymbol,
  reason,
  onReasonChange,
  processing,
  onConfirm,
}) => {
  const { t } = useTranslation('rooms');
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle sx={{ bgcolor: 'secondary.main', color: 'var(--hotel-on-primary)', py: 2, px: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <GiftIcon sx={{ fontSize: 28 }} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            {t('complimentary.title')}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        {booking && (
          <Grid container spacing={3}>
            {/* Booking Info */}
            <Grid size={12}>
              <Paper sx={{ p: 2, bgcolor: 'var(--hotel-surface-raised)' }}>
                <Typography variant="subtitle2" gutterBottom>
                  {t('complimentary.bookingDetails')}
                </Typography>
                <Grid container spacing={1}>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>
                      {t('fields.room')}:
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      fontWeight: "bold"
                    }}>
                      {room?.room_number} - {room?.room_type}
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>
                      {t('fields.guest')}:
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      fontWeight: "bold"
                    }}>
                      {booking.guest_name}
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>
                      {t('complimentary.checkInDate')}:
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2">
                      {formatHotelDate(booking.check_in_date)}
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>
                      {t('complimentary.checkOutDate')}:
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2">
                      {formatHotelDate(booking.check_out_date)}
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>
                      {t('complimentary.originalAmount')}:
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{ textDecoration: 'line-through', color: 'error.main' }}>
                      {currencySymbol}{toMoneyNumber(booking.total_amount).toFixed(2)}
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>
                      {t('complimentary.newAmount')}:
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: "bold",
                        color: "success.main"
                      }}>
                      {t('complimentary.newAmountValue', { symbol: currencySymbol })}
                    </Typography>
                  </Grid>
                </Grid>
              </Paper>
            </Grid>

            {/* Reason Input */}
            <Grid size={12}>
              <TextField
                fullWidth
                label={t('complimentary.reasonLabel')}
                placeholder={t('complimentary.reasonPlaceholder')}
                value={reason}
                onChange={(e) => onReasonChange(e.target.value)}
                multiline
                rows={2}
              />
            </Grid>

            {/* Info Alert */}
            <Grid size={12}>
              <Alert severity="info" sx={{ mt: 1 }}>
                {t('complimentary.info', { symbol: currencySymbol })}
              </Alert>
            </Grid>
          </Grid>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'var(--hotel-surface-raised)', borderTop: 1, borderColor: 'divider' }}>
        <Button onClick={onCancel} disabled={processing}>
          {t('common:actions.cancel')}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained"
          color="secondary"
          onClick={onConfirm}
          disabled={processing}
          startIcon={processing ? <CircularProgress size={20} /> : <GiftIcon />}
          size="large"
        >
          {processing ? t('common:state.processing') : t('complimentary.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default MarkComplimentaryDialog;
