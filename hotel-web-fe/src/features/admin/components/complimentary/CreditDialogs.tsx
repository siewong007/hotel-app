import React, { useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { BookingsService } from '../../../../api';
import { errorMessage } from '../../../../utils';
import { emitApiNotification } from '../../../../utils/apiNotifications';
import type { GuestCredit, GuestOption, RoomTypeOption } from './types';

interface AddCreditDialogProps {
  open: boolean;
  guests: GuestOption[];
  roomTypes: RoomTypeOption[];
  onClose: () => void;
  onCompleted: () => void | Promise<void>;
}

export const AddCreditDialog: React.FC<AddCreditDialogProps> = ({
  open,
  guests,
  roomTypes,
  onClose,
  onCompleted,
}) => {
  const [formData, setFormData] = useState({
    guest_id: 0,
    room_type_id: 0,
    nights: 1,
    reason: '',
  });
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (open) {
      setFormData({ guest_id: 0, room_type_id: 0, nights: 1, reason: '' });
    }
  }, [open]);

  const handleAdd = async () => {
    const reason = formData.reason.trim();
    if (!formData.guest_id || !formData.room_type_id || formData.nights <= 0 || !reason) {
      emitApiNotification({
        message: 'Please select a guest and room type, enter the number of nights, and provide a reason',
        severity: 'error',
      });
      return;
    }
    try {
      setProcessing(true);
      await BookingsService.addGuestCredits({
        guest_id: formData.guest_id,
        room_type_id: formData.room_type_id,
        nights: formData.nights,
        reason,
      });
      emitApiNotification({ message: 'Credits added successfully', severity: 'success' });
      onClose();
      await onCompleted();
    } catch (err) {
      emitApiNotification({ message: errorMessage(err, 'Failed to add credits'), severity: 'error' });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Complimentary Credits</DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1 }}>
          <Grid container spacing={2}>
            <Grid size={12}>
              <Autocomplete
                options={guests}
                getOptionLabel={(option) => `${option.nick_name}${option.email ? ` (${option.email})` : ''}`}
                value={guests.find(g => g.id === formData.guest_id) || null}
                onChange={(_, newValue) => setFormData({ ...formData, guest_id: newValue?.id || 0 })}
                renderInput={(params) => <TextField {...params} label="Select Guest *" />}
              />
            </Grid>
            <Grid size={12}>
              <FormControl fullWidth>
                <InputLabel>Room Type *</InputLabel>
                <Select
                  value={formData.room_type_id || ''}
                  label="Room Type *"
                  onChange={(e) => setFormData({ ...formData, room_type_id: Number(e.target.value) })}
                >
                  {roomTypes.map((rt) => (
                    <MenuItem key={rt.id} value={rt.id}>
                      {rt.name} {rt.code ? `(${rt.code})` : ''}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                label="Number of Nights *"
                type="number"
                value={formData.nights}
                onChange={(e) => setFormData({ ...formData, nights: parseInt(e.target.value) || 0 })}
                slotProps={{
                  htmlInput: { min: 1 }
                }}
              />
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                required
                label="Reason"
                multiline
                rows={2}
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                placeholder="e.g., Loyalty reward or service recovery"
                helperText={`${formData.reason.length}/500 characters`}
                slotProps={{ htmlInput: { maxLength: 500 } }}
              />
            </Grid>
          </Grid>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          onClick={handleAdd}
          variant="contained"
          color="secondary"
          disabled={processing || !formData.reason.trim()}
        >
          {processing ? 'Adding...' : 'Add Credits'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

interface CreditDialogProps {
  open: boolean;
  credit: GuestCredit | null;
  onClose: () => void;
  onCompleted: () => void | Promise<void>;
}

export const EditCreditDialog: React.FC<CreditDialogProps> = ({
  open,
  credit,
  onClose,
  onCompleted,
}) => {
  const [formData, setFormData] = useState({
    nights_available: 0,
    notes: '',
  });
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (open && credit) {
      setFormData({
        nights_available: credit.nights_available,
        notes: credit.notes || '',
      });
    }
  }, [open, credit]);

  const handleUpdate = async () => {
    if (!credit) return;
    try {
      setProcessing(true);
      await BookingsService.updateGuestCredits(
        credit.guest_id,
        credit.room_type_id,
        {
          nights_available: formData.nights_available,
          notes: formData.notes || undefined,
        }
      );
      emitApiNotification({ message: 'Credits updated successfully', severity: 'success' });
      onClose();
      await onCompleted();
    } catch (err) {
      emitApiNotification({ message: errorMessage(err, 'Failed to update credits'), severity: 'error' });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Edit Complimentary Credits</DialogTitle>
      <DialogContent>
        {credit && (
          <Box sx={{ pt: 1 }}>
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2">
                <strong>Guest:</strong> {credit.guest_name}
              </Typography>
              <Typography variant="body2">
                <strong>Room Type:</strong> {credit.room_type_name}
              </Typography>
            </Alert>
            <Grid container spacing={2}>
              <Grid size={12}>
                <TextField
                  fullWidth
                  label="Nights Available *"
                  type="number"
                  value={formData.nights_available}
                  onChange={(e) => setFormData({ ...formData, nights_available: parseInt(e.target.value) || 0 })}
                  slotProps={{
                    htmlInput: { min: 0 }
                  }}
                />
              </Grid>
              <Grid size={12}>
                <TextField
                  fullWidth
                  label="Notes"
                  multiline
                  rows={2}
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                />
              </Grid>
            </Grid>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleUpdate} variant="contained" disabled={processing}>
          {processing ? 'Updating...' : 'Update Credits'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export const DeleteCreditDialog: React.FC<CreditDialogProps> = ({
  open,
  credit,
  onClose,
  onCompleted,
}) => {
  const [processing, setProcessing] = useState(false);

  const handleDelete = async () => {
    if (!credit) return;
    try {
      setProcessing(true);
      await BookingsService.deleteGuestCredits(credit.guest_id, credit.room_type_id);
      emitApiNotification({ message: 'Credits deleted successfully', severity: 'success' });
      onClose();
      await onCompleted();
    } catch (err) {
      emitApiNotification({ message: errorMessage(err, 'Failed to delete credits'), severity: 'error' });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Delete Complimentary Credits</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Are you sure you want to delete these complimentary credits? This action cannot be undone.
        </Alert>
        {credit && (
          <Box>
            <Typography variant="body2">
              <strong>Guest:</strong> {credit.guest_name}
            </Typography>
            <Typography variant="body2">
              <strong>Room Type:</strong> {credit.room_type_name}
            </Typography>
            <Typography variant="body2">
              <strong>Nights to Delete:</strong> {credit.nights_available}
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleDelete} variant="contained" color="error" disabled={processing}>
          {processing ? 'Deleting...' : 'Delete Credits'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
