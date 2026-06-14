import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { Edit as EditIcon } from '@mui/icons-material';

import type { Room } from '../../../../types';

interface RoomNotesDialogProps {
  open: boolean;
  room: Room | null;
  notes: string;
  saving: boolean;
  onClose: () => void;
  onNotesChange: (notes: string) => void;
  onSubmit: () => void;
}

const RoomNotesDialog = ({
  open,
  room,
  notes,
  saving,
  onClose,
  onNotesChange,
  onSubmit,
}: RoomNotesDialogProps) => (
  <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
    <DialogTitle sx={{ bgcolor: 'primary.main', color: 'white', py: 2, px: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <EditIcon sx={{ fontSize: 24 }} />
        <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
          Room Notes - {room?.room_number}
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
        label="Notes"
        value={notes}
        onChange={(event) => onNotesChange(event.target.value)}
        sx={{ mt: 2 }}
        placeholder="Enter room notes..."
      />
    </DialogContent>
    <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
      <Button onClick={onClose} variant="outlined">Cancel</Button>
      <Button onClick={onSubmit} variant="contained" disabled={saving}>
        {saving ? 'Saving...' : 'Save'}
      </Button>
    </DialogActions>
  </Dialog>
);

export default RoomNotesDialog;
