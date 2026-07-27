import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Alert,
  Box,
  Typography,
  CircularProgress,
} from '@mui/material';
import { Delete as DeleteIcon } from '@mui/icons-material';
import type { Company } from '../../../../../types';

interface DeleteCompanyDialogProps {
  open: boolean;
  onClose: () => void;
  company: Company | null;
  deleting: boolean;
  onConfirm: () => void;
}

const DeleteCompanyDialog: React.FC<DeleteCompanyDialogProps> = ({
  open,
  onClose,
  company,
  deleting,
  onConfirm,
}) => (
  <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
    <DialogTitle>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1
        }}>
        <DeleteIcon color="error" />
        Delete Company
      </Box>
    </DialogTitle>
    <DialogContent>
      <Alert severity="warning" sx={{ mb: 2 }}>
        This action cannot be undone.
      </Alert>
      <Typography>
        Are you sure you want to delete the company <strong>"{company?.company_name}"</strong>?
      </Typography>
      {company && (
        <Box sx={{ mt: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
            <strong>Contact:</strong> {company.contact_person || 'N/A'}
          </Typography>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
            <strong>Email:</strong> {company.contact_email || 'N/A'}
          </Typography>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
            <strong>Phone:</strong> {company.contact_phone || 'N/A'}
          </Typography>
        </Box>
      )}
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose}>Cancel</Button>
      <Button
        onClick={onConfirm}
        variant="contained"
        color="error"
        disabled={deleting}
        startIcon={deleting ? <CircularProgress size={20} /> : <DeleteIcon />}
      >
        {deleting ? 'Deleting...' : 'Delete Company'}
      </Button>
    </DialogActions>
  </Dialog>
);

export default DeleteCompanyDialog;
