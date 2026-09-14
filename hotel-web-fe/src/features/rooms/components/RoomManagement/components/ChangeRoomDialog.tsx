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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Button,
  CircularProgress,
} from '@mui/material';
import { Hotel as HotelIcon } from '@mui/icons-material';
import { Room } from '../../../../../types';
import { isGreaterMoney, isLessMoney, isPositiveMoney, subtractMoney, toMoneyNumber } from '../../../../../utils/money';
import { useTranslation } from '../../../../../i18n/useTranslation';

interface ChangeRoomDialogProps {
  open: boolean;
  onClose: () => void;
  onCancel: () => void;
  currentRoom: Room | null;
  rooms: Room[];
  selectedNewRoom: Room | null;
  onSelectNewRoom: (room: Room | null) => void;
  customRate: string;
  onCustomRateChange: (value: string) => void;
  currencySymbol: string;
  changing: boolean;
  onConfirm: () => void;
}

const ChangeRoomDialog: React.FC<ChangeRoomDialogProps> = ({
  open,
  onClose,
  onCancel,
  currentRoom,
  rooms,
  selectedNewRoom,
  onSelectNewRoom,
  customRate,
  onCustomRateChange,
  currencySymbol,
  changing,
  onConfirm,
}) => {
  const { t } = useTranslation('rooms');
  const hasCustomRate = customRate.trim() !== '' && isPositiveMoney(customRate);
  const effectiveSelectedRate = selectedNewRoom
    ? (hasCustomRate ? toMoneyNumber(customRate) : toMoneyNumber(selectedNewRoom.price_per_night))
    : 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle sx={{ bgcolor: 'primary.main', color: 'var(--hotel-on-primary)', py: 2, px: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <HotelIcon sx={{ fontSize: 28 }} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            {t('changeRoom.title', { room: currentRoom?.room_number || 'N/A' })}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        <Grid container spacing={3}>
          {/* Current Room Info */}
          <Grid size={12}>
            <Paper sx={{ p: 2, bgcolor: 'var(--hotel-surface-raised)' }}>
              <Typography variant="subtitle2" gutterBottom>
                {t('changeRoom.currentRoom')}
              </Typography>
              <Grid container spacing={1}>
                <Grid size={6}>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    {t('fields.roomNumber')}:
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" sx={{
                    fontWeight: "bold"
                  }}>
                    {currentRoom?.room_number}
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    {t('fields.roomType')}:
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2">
                    {currentRoom?.room_type}
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    {t('changeRoom.currentRate')}:
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2">
                    {t('changeRoom.ratePerNight', { symbol: currencySymbol, rate: toMoneyNumber(currentRoom?.price_per_night).toFixed(2) })}
                  </Typography>
                </Grid>
              </Grid>
            </Paper>
          </Grid>

          {/* New Room Selection */}
          <Grid size={12}>
            <FormControl fullWidth required>
              <InputLabel>{t('changeRoom.selectNewRoom')}</InputLabel>
              <Select
                value={selectedNewRoom?.id || ''}
                onChange={(e) => {
                  const room = rooms.find(r => r.id === e.target.value);
                  onSelectNewRoom(room || null);
                }}
                label={t('changeRoom.selectNewRoom')}
              >
                {rooms
                  .filter(r => r.status === 'available' && r.id !== currentRoom?.id)
                  .sort((a, b) => {
                    const numA = parseInt(a.room_number, 10);
                    const numB = parseInt(b.room_number, 10);
                    if (!isNaN(numA) && !isNaN(numB)) {
                      return numA - numB;
                    }
                    return a.room_number.localeCompare(b.room_number);
                  })
                  .map((room) => (
                    <MenuItem key={room.id} value={room.id}>
                      {t('changeRoom.roomOption', { number: room.room_number, type: room.room_type, symbol: currencySymbol, rate: toMoneyNumber(room.price_per_night).toFixed(2) })}
                    </MenuItem>
                  ))}
              </Select>
            </FormControl>
          </Grid>

          {/* Custom Rate */}
          <Grid size={12}>
            <TextField
              fullWidth
              label={t('changeRoom.customRateLabel')}
              type="number"
              value={customRate}
              onChange={(e) => onCustomRateChange(e.target.value)}
              placeholder={selectedNewRoom ? toMoneyNumber(selectedNewRoom.price_per_night).toFixed(2) : ''}
              helperText={selectedNewRoom ? t('changeRoom.defaultRateHint', { symbol: currencySymbol, rate: toMoneyNumber(selectedNewRoom.price_per_night).toFixed(2) }) : t('changeRoom.selectRoomHint')}
              slotProps={{
                input: {
                  startAdornment: <Typography sx={{ mr: 0.5, color: 'text.secondary' }}>{currencySymbol}</Typography>,
                },

                htmlInput: { min: 0, step: '0.01' }
              }} />
          </Grid>

          {/* Price Difference */}
          {selectedNewRoom && currentRoom && (
            <>
              <Grid size={12}>
                <Paper sx={{ p: 2, bgcolor: 'info.lighter' }}>
                  <Typography variant="subtitle2" gutterBottom>
                    {t('changeRoom.priceSummary')}
                  </Typography>
                  <Grid container spacing={1}>
                    <Grid size={6}>
                      <Typography variant="body2" sx={{
                        color: "text.secondary"
                      }}>
                        {t('changeRoom.newRate')}:
                      </Typography>
                    </Grid>
                    <Grid size={6}>
                      <Typography variant="body2" sx={{
                        fontWeight: "bold"
                      }}>
                        {t('changeRoom.ratePerNight', { symbol: currencySymbol, rate: effectiveSelectedRate.toFixed(2) })}
                        {hasCustomRate && (
                          <Typography component="span" variant="caption" sx={{
                            color: "text.secondary"
                          }}> {t('changeRoom.customTag')}</Typography>
                        )}
                      </Typography>
                    </Grid>
                    <Grid size={6}>
                      <Typography variant="body2" sx={{
                        color: "text.secondary"
                      }}>
                        {t('changeRoom.differencePerNight')}:
                      </Typography>
                    </Grid>
                    <Grid size={6}>
                      <Typography
                        variant="body2"
                        color={(() => {
                          const diff = subtractMoney(effectiveSelectedRate, currentRoom.price_per_night);
                          return isGreaterMoney(diff, 0) ? 'error.main' : isLessMoney(diff, 0) ? 'success.main' : 'text.primary';
                        })()}
                        sx={{
                          fontWeight: "bold"
                        }}
                      >
                        {(() => {
                          const diff = subtractMoney(effectiveSelectedRate, currentRoom.price_per_night);
                          return isGreaterMoney(diff, 0)
                            ? t('changeRoom.diffCharge', { symbol: currencySymbol, amount: diff.toFixed(2) })
                            : isLessMoney(diff, 0)
                            ? t('changeRoom.diffCredit', { symbol: currencySymbol, amount: Math.abs(diff).toFixed(2) })
                            : t('changeRoom.diffNone', { symbol: currencySymbol });
                        })()}
                      </Typography>
                    </Grid>
                  </Grid>
                </Paper>
              </Grid>
            </>
          )}
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'var(--hotel-surface-raised)', borderTop: 1, borderColor: 'divider' }}>
        <Button onClick={onCancel} disabled={changing}>
          {t('common:actions.cancel')}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained"
          onClick={onConfirm}
          disabled={!selectedNewRoom || changing}
          startIcon={changing ? <CircularProgress size={20} /> : null}
          size="large"
          color="warning"
        >
          {changing ? t('changeRoom.changing') : t('changeRoom.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ChangeRoomDialog;
