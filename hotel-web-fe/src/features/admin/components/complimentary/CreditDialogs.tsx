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
import { useTranslation } from '../../../../i18n';

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
  const { t } = useTranslation('bookings');
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
        message: t('comp.addDialog.validation'),
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
      emitApiNotification({ message: t('comp.addDialog.added'), severity: 'success' });
      onClose();
      await onCompleted();
    } catch (err) {
      emitApiNotification({ message: errorMessage(err, t('comp.addDialog.addFailed')), severity: 'error' });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('comp.addDialog.title')}</DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1 }}>
          <Grid container spacing={2}>
            <Grid size={12}>
              <Autocomplete
                options={guests}
                getOptionLabel={(option) => `${option.nick_name}${option.email ? ` (${option.email})` : ''}`}
                value={guests.find(g => g.id === formData.guest_id) || null}
                onChange={(_, newValue) => setFormData({ ...formData, guest_id: newValue?.id || 0 })}
                renderInput={(params) => <TextField {...params} label={t('comp.addDialog.selectGuest')} />}
              />
            </Grid>
            <Grid size={12}>
              <FormControl fullWidth>
                <InputLabel>{t('comp.addDialog.roomType')}</InputLabel>
                <Select
                  value={formData.room_type_id || ''}
                  label={t('comp.addDialog.roomType')}
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
                label={t('comp.addDialog.nights')}
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
                label={t('comp.addDialog.reason')}
                multiline
                rows={2}
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                placeholder={t('comp.addDialog.reasonPlaceholder')}
                helperText={t('comp.addDialog.reasonCounter', { count: formData.reason.length })}
                slotProps={{ htmlInput: { maxLength: 500 } }}
              />
            </Grid>
          </Grid>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button
          onClick={handleAdd}
          variant="contained"
          color="secondary"
          disabled={processing || !formData.reason.trim()}
        >
          {processing ? t('comp.addDialog.adding') : t('comp.addDialog.confirm')}
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
  const { t } = useTranslation('bookings');
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
      emitApiNotification({ message: t('comp.editCredit.updated'), severity: 'success' });
      onClose();
      await onCompleted();
    } catch (err) {
      emitApiNotification({ message: errorMessage(err, t('comp.editCredit.updateFailed')), severity: 'error' });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('comp.editCredit.title')}</DialogTitle>
      <DialogContent>
        {credit && (
          <Box sx={{ pt: 1 }}>
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2">
                <strong>{t('comp.editCredit.guestLabel')}</strong> {credit.guest_name}
              </Typography>
              <Typography variant="body2">
                <strong>{t('comp.editCredit.roomTypeLabel')}</strong> {credit.room_type_name}
              </Typography>
            </Alert>
            <Grid container spacing={2}>
              <Grid size={12}>
                <TextField
                  fullWidth
                  label={t('comp.editCredit.nightsAvailable')}
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
                  label={t('comp.editCredit.notes')}
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
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button onClick={handleUpdate} variant="contained" disabled={processing}>
          {processing ? t('comp.editCredit.updating') : t('comp.editCredit.confirm')}
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
  const { t } = useTranslation('bookings');
  const [processing, setProcessing] = useState(false);

  const handleDelete = async () => {
    if (!credit) return;
    try {
      setProcessing(true);
      await BookingsService.deleteGuestCredits(credit.guest_id, credit.room_type_id);
      emitApiNotification({ message: t('comp.deleteCredit.deleted'), severity: 'success' });
      onClose();
      await onCompleted();
    } catch (err) {
      emitApiNotification({ message: errorMessage(err, t('comp.deleteCredit.deleteFailed')), severity: 'error' });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('comp.deleteCredit.title')}</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('comp.deleteCredit.warning')}
        </Alert>
        {credit && (
          <Box>
            <Typography variant="body2">
              <strong>{t('comp.editCredit.guestLabel')}</strong> {credit.guest_name}
            </Typography>
            <Typography variant="body2">
              <strong>{t('comp.editCredit.roomTypeLabel')}</strong> {credit.room_type_name}
            </Typography>
            <Typography variant="body2">
              <strong>{t('comp.deleteCredit.nightsToDelete')}</strong> {credit.nights_available}
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button onClick={handleDelete} variant="contained" color="error" disabled={processing}>
          {processing ? t('comp.deleteCredit.deleting') : t('comp.deleteCredit.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
