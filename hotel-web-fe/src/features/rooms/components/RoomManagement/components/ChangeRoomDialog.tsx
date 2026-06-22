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
      <DialogTitle sx={{ bgcolor: 'primary.main', color: 'white', py: 2, px: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <HotelIcon sx={{ fontSize: 28 }} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            Change Room - Current: {currentRoom?.room_number || 'N/A'}
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ pt: 3 }}>
        <Grid container spacing={3}>
          {/* Current Room Info */}
          <Grid size={12}>
            <Paper sx={{ p: 2, bgcolor: 'grey.100' }}>
              <Typography variant="subtitle2" gutterBottom>
                Current Room
              </Typography>
              <Grid container spacing={1}>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">
                    Room Number:
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" fontWeight="bold">
                    {currentRoom?.room_number}
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">
                    Room Type:
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2">
                    {currentRoom?.room_type}
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2" color="text.secondary">
                    Current Rate:
                  </Typography>
                </Grid>
                <Grid size={6}>
                  <Typography variant="body2">
                    {currencySymbol}{toMoneyNumber(currentRoom?.price_per_night).toFixed(2)} / night
                  </Typography>
                </Grid>
              </Grid>
            </Paper>
          </Grid>

          {/* New Room Selection */}
          <Grid size={12}>
            <FormControl fullWidth required>
              <InputLabel>Select New Room</InputLabel>
              <Select
                value={selectedNewRoom?.id || ''}
                onChange={(e) => {
                  const room = rooms.find(r => r.id === e.target.value);
                  onSelectNewRoom(room || null);
                }}
                label="Select New Room"
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
                      Room {room.room_number} - {room.room_type} ({currencySymbol}{toMoneyNumber(room.price_per_night).toFixed(2)}/night)
                    </MenuItem>
                  ))}
              </Select>
            </FormControl>
          </Grid>

          {/* Custom Rate */}
          <Grid size={12}>
            <TextField
              fullWidth
              label="Custom Rate (per night)"
              type="number"
              value={customRate}
              onChange={(e) => onCustomRateChange(e.target.value)}
              placeholder={selectedNewRoom ? toMoneyNumber(selectedNewRoom.price_per_night).toFixed(2) : ''}
              helperText={selectedNewRoom ? `Default room rate: ${currencySymbol}${toMoneyNumber(selectedNewRoom.price_per_night).toFixed(2)}/night. Leave empty to use default.` : 'Select a room first, or enter a custom rate.'}
              InputProps={{
                startAdornment: <Typography sx={{ mr: 0.5, color: 'text.secondary' }}>{currencySymbol}</Typography>,
              }}
              inputProps={{ min: 0, step: '0.01' }}
            />
          </Grid>

          {/* Price Difference */}
          {selectedNewRoom && currentRoom && (
            <>
              <Grid size={12}>
                <Paper sx={{ p: 2, bgcolor: 'info.lighter' }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Price Summary
                  </Typography>
                  <Grid container spacing={1}>
                    <Grid size={6}>
                      <Typography variant="body2" color="text.secondary">
                        New Rate:
                      </Typography>
                    </Grid>
                    <Grid size={6}>
                      <Typography variant="body2" fontWeight="bold">
                        {currencySymbol}{effectiveSelectedRate.toFixed(2)} / night
                        {hasCustomRate && (
                          <Typography component="span" variant="caption" color="text.secondary"> (custom)</Typography>
                        )}
                      </Typography>
                    </Grid>
                    <Grid size={6}>
                      <Typography variant="body2" color="text.secondary">
                        Difference per Night:
                      </Typography>
                    </Grid>
                    <Grid size={6}>
                      <Typography
                        variant="body2"
                        fontWeight="bold"
                        color={(() => {
                          const diff = subtractMoney(effectiveSelectedRate, currentRoom.price_per_night);
                          return isGreaterMoney(diff, 0) ? 'error.main' : isLessMoney(diff, 0) ? 'success.main' : 'text.primary';
                        })()}
                      >
                        {(() => {
                          const diff = subtractMoney(effectiveSelectedRate, currentRoom.price_per_night);
                          return isGreaterMoney(diff, 0)
                            ? `+${currencySymbol}${diff.toFixed(2)} (Additional Charge)`
                            : isLessMoney(diff, 0)
                            ? `-${currencySymbol}${Math.abs(diff).toFixed(2)} (Credit)`
                            : `${currencySymbol}0.00 (No Change)`;
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

      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
        <Button onClick={onCancel} disabled={changing}>
          Cancel
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
          {changing ? 'Changing Room...' : 'Confirm Room Change'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ChangeRoomDialog;
