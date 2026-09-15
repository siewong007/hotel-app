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
import { useTranslation } from '../../../../../i18n';

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
}) => {
  const { t } = useTranslation('finance');
  return (
  <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
    <DialogTitle>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1
        }}>
        <DeleteIcon color="error" />
        {t('ledger.deleteCompany')}
      </Box>
    </DialogTitle>
    <DialogContent>
      <Alert severity="warning" sx={{ mb: 2 }}>
        {t('common:confirm.areYouSure')}
      </Alert>
      <Typography>
        {t('ledger.deleteCompanyConfirm', { name: company?.company_name ?? '' })}
      </Typography>
      {company && (
        <Box sx={{ mt: 2, p: 2, bgcolor: 'var(--hotel-surface-sunken)', borderRadius: 1 }}>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
            <strong>{t('ledger.field.contact')}:</strong> {company.contact_person || t('common:field.none')}
          </Typography>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
            <strong>{t('common:field.email')}:</strong> {company.contact_email || t('common:field.none')}
          </Typography>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
            <strong>{t('common:field.phone')}:</strong> {company.contact_phone || t('common:field.none')}
          </Typography>
        </Box>
      )}
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
      <Button
        onClick={onConfirm}
        variant="contained"
        color="error"
        disabled={deleting}
        startIcon={deleting ? <CircularProgress size={20} /> : <DeleteIcon />}
      >
        {deleting ? t('common:state.deleting') : t('ledger.deleteCompany')}
      </Button>
    </DialogActions>
  </Dialog>
  );
};

export default DeleteCompanyDialog;
