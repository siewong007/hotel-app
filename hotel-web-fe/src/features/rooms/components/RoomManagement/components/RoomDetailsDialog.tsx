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
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ bgcolor: 'primary.main', color: 'white', py: 2, px: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <SettingsIcon sx={{ fontSize: 28 }} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 600 }}>
            Room Properties - {room?.room_number}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: 3 }}>
        {room && (
          <Box sx={{ mt: 2 }}>
            <Grid container spacing={2}>
              <Grid size={6}>
                <Typography variant="caption" color="text.secondary">Room Number</Typography>
                <Typography variant="body1" fontWeight={600}>{room.room_number}</Typography>
              </Grid>
              <Grid size={6}>
                <Typography variant="caption" color="text.secondary">Room Type</Typography>
                <Typography variant="body1" fontWeight={600}>{room.room_type}</Typography>
              </Grid>
              <Grid size={6}>
                <Typography variant="caption" color="text.secondary">Price per Night</Typography>
                <Typography variant="body1" fontWeight={600}>{formatCurrency(Number(room.price_per_night))}</Typography>
              </Grid>
              <Grid size={6}>
                <Typography variant="caption" color="text.secondary">Max Occupancy</Typography>
                <Typography variant="body1" fontWeight={600}>{room.max_occupancy} guests</Typography>
              </Grid>
              <Grid size={12}>
                <Typography variant="caption" color="text.secondary">Status</Typography>
                <Typography variant="body1" fontWeight={600}>{room.status}</Typography>
              </Grid>
              {room.description && (
                <Grid size={12}>
                  <Typography variant="caption" color="text.secondary">Description</Typography>
                  <Typography variant="body2">{room.description}</Typography>
                </Grid>
              )}
            </Grid>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: 1, borderColor: 'divider' }}>
        <Button onClick={onClose} variant="outlined">Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default RoomDetailsDialog;
