import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import StatusChip from '../../../components/common/StatusChip';
import { errorMessage } from '../../../utils/errorMessage';
import { statusLabel, useTranslation } from '../../../i18n';
import type { HousekeepingBoardRoom } from '../../../types/housekeeping.types';
import type { RoomStatusUpdateInput } from '../../../types/room.types';
import { roomStatusMeta, ROOM_STATUS_TRANSITIONS } from '../housekeepingConfig';

const TARGET_HINT_KEYS: Record<string, string> = {
  available: 'statusDialog.hintAvailable',
  dirty: 'statusDialog.hintDirty',
  maintenance: 'statusDialog.hintMaintenance',
  out_of_order: 'statusDialog.hintOutOfOrder',
};

/** Minimal shape — `Room` and `HousekeepingBoardRoom` both satisfy it. */
export interface RoomStatusUpdateRoom {
  id: string | number;
  room_number: string;
  status?: string;
}

interface RoomStatusUpdateDialogProps {
  open: boolean;
  room: RoomStatusUpdateRoom | null;
  onClose: () => void;
  onSubmit: (roomId: string | number, input: RoomStatusUpdateInput) => Promise<void>;
}

export default function RoomStatusUpdateDialog({
  open,
  room,
  onClose,
  onSubmit,
}: RoomStatusUpdateDialogProps) {
  const { t } = useTranslation('rooms');
  const [status, setStatus] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStatus('');
      setNotes('');
      setError(null);
    }
  }, [open]);

  if (!room) return null;

  const currentStatus = room.status ?? '';

  // Only targets the DB transition table accepts from this room's status —
  // `occupied`/`reserved`/`reserved_dirty`/`cleaning` stay booking-/system-
  // driven and are never offered (see ROOM_STATUS_TRANSITIONS).
  const targets = ROOM_STATUS_TRANSITIONS[currentStatus] ?? [];

  const handleSubmit = async () => {
    if (!status) {
      setError(t('statusDialog.selectStatus'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(room.id, {
        status: status as RoomStatusUpdateInput['status'],
        notes: notes.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(errorMessage(err, t('statusDialog.updateFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('statusDialog.title', { room: room.room_number })}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t('statusDialog.current')}
            </Typography>
            <StatusChip status={currentStatus} tone={roomStatusMeta(currentStatus).tone} />
          </Stack>
          <FormControl fullWidth required>
            <InputLabel id="room-status-target">{t('statusDialog.newStatus')}</InputLabel>
            <Select
              labelId="room-status-target"
              label={t('statusDialog.newStatus')}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              disabled={saving}
            >
              {targets.map((target) => (
                <MenuItem key={target} value={target}>
                  {statusLabel(t, 'room', target)} — {t(TARGET_HINT_KEYS[target] ?? 'statusDialog.hintMaintenance')}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label={t('statusDialog.notesLabel')}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            multiline
            minRows={2}
            fullWidth
            disabled={saving}
            placeholder={t('statusDialog.notesPlaceholder')}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('common:actions.cancel')}
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving || !status}>
          {saving ? t('statusDialog.updating') : t('statusDialog.submit')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
