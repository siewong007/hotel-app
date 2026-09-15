import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  TextField,
  Button,
} from '@mui/material';
import { Edit as EditIcon } from '@mui/icons-material';
import { useTranslation } from '../../../../../i18n/useTranslation';

interface RoomNotesDialogProps {
  open: boolean;
  onClose: () => void;
  roomNumber?: string;
  notes: string;
  onNotesChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
}

const RoomNotesDialog: React.FC<RoomNotesDialogProps> = ({
  open,
  onClose,
  roomNumber,
  notes,
  onNotesChange,
  onSave,
  saving,
}) => {
  const { t } = useTranslation('rooms');
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ bgcolor: 'primary.main', color: 'var(--hotel-on-primary)', py: 2, px: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <EditIcon sx={{ fontSize: 24 }} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            {t('notesDialog.title', { room: roomNumber })}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={3}
          maxRows={6}
          label={t('fields.notes')}
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          sx={{ mt: 2 }}
          placeholder={t('notesDialog.placeholder')}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'var(--hotel-surface-raised)', borderTop: 1, borderColor: 'divider' }}>
        <Button onClick={onClose} variant="outlined">{t('common:actions.cancel')}</Button>
        <Button onClick={onSave} variant="contained" disabled={saving}>
          {saving ? t('common:state.saving') : t('common:actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RoomNotesDialog;
