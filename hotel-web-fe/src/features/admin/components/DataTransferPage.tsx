import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Snackbar,
  ToggleButton,
  ToggleButtonGroup,
  useTheme,
  alpha,
} from '@mui/material';
import {
  Download as DownloadIcon,
  Upload as UploadIcon,
  History as HistoryIcon,
} from '@mui/icons-material';
import { useAuth } from '../../../auth/AuthContext';
import PageHeader from '../../../components/common/PageHeader';
import ExportPanel from './data-transfer/ExportPanel';
import ImportWizard from './data-transfer/ImportWizard';
import TransferHistoryList from './data-transfer/TransferHistoryList';
import { useTransferHistory } from './data-transfer/useTransferHistory';
import type { ToastSeverity } from './data-transfer/types';

type Tab = 'export' | 'import' | 'history';

const DataTransferPage: React.FC = () => {
  const theme = useTheme();
  const { hasPermission, hasRole, user } = useAuth();

  // Import clears whole tables and remaps references — the backend restricts it
  // to `users.is_super_admin`. The seeded admin account carries that flag but
  // the `admin` role, so check both signals; the flag alone misses nobody who
  // can actually call the endpoints.
  const isSuperAdmin = user?.is_super_admin === true || hasRole('super_admin');

  const [tab, setTab] = useState<Tab>('export');
  const [toast, setToast] = useState<{ open: boolean; msg: string; severity: ToastSeverity }>({
    open: false,
    msg: '',
    severity: 'success',
  });

  const performedBy = user?.full_name || user?.username || 'Unknown user';
  const { entries, pushEntry } = useTransferHistory(performedBy);

  if (!hasPermission('settings:manage')) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">You do not have permission to manage data transfer.</Alert>
      </Box>
    );
  }

  const notify = (msg: string, severity: ToastSeverity = 'success') =>
    setToast({ open: true, msg, severity });

  return (
    <Box sx={{ p: 3, maxWidth: 1320, mx: 'auto' }}>
      <PageHeader
        sx={{ mb: 2 }}
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            Data Transfer
            <Chip
              label="settings:manage"
              size="small"
              variant="outlined"
              sx={{ height: 22, fontSize: 11, fontWeight: 600, fontFamily: 'monospace' }}
            />
          </Box>
        }
        subtitle={
          <Box component="span" sx={{ maxWidth: 680, display: 'inline-block' }}>
            Download a complete business-data backup, or restore one on this server. Imports are staged, previewed,
            and confirmed before any data is written.
          </Box>
        }
        actions={
          isSuperAdmin ? (
            <Button
              variant="outlined"
              startIcon={<HistoryIcon />}
              onClick={() => setTab('history')}
              sx={{ fontWeight: 700 }}
            >
              Transfer history
            </Button>
          ) : undefined
        }
      />

      {isSuperAdmin && (
        <ToggleButtonGroup
          value={tab}
          exclusive
          onChange={(_, v) => v && setTab(v)}
          sx={{
            mb: 3,
            bgcolor: alpha(theme.palette.text.primary, 0.04),
            borderRadius: 2,
            p: 0.5,
            '& .MuiToggleButton-root': {
              border: 'none',
              borderRadius: 1.5,
              px: 2,
              py: 0.75,
              fontWeight: 700,
              textTransform: 'none',
              color: 'text.secondary',
              '&.Mui-selected': {
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                '&:hover': { bgcolor: 'primary.dark' },
              },
            },
          }}
        >
          <ToggleButton value="export">
            <DownloadIcon sx={{ fontSize: 18, mr: 0.75 }} /> Export
          </ToggleButton>
          <ToggleButton value="import">
            <UploadIcon sx={{ fontSize: 18, mr: 0.75 }} /> Import
          </ToggleButton>
          <ToggleButton value="history">
            <HistoryIcon sx={{ fontSize: 18, mr: 0.75 }} /> History
          </ToggleButton>
        </ToggleButtonGroup>
      )}

      {/* Non-super-admins see the export workflow only — no tab strip. */}
      {(tab === 'export' || !isSuperAdmin) && <ExportPanel notify={notify} onRecord={pushEntry} />}
      {isSuperAdmin && tab === 'import' && (
        <ImportWizard notify={notify} onRecord={pushEntry} onFinished={() => setTab('history')} />
      )}
      {isSuperAdmin && tab === 'history' && <TransferHistoryList entries={entries} />}

      <Snackbar
        open={toast.open}
        autoHideDuration={3800}
        onClose={() => setToast((t) => ({ ...t, open: false }))}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        sx={{ top: { xs: 72, sm: 88 } }}
      >
        <Alert
          onClose={() => setToast((t) => ({ ...t, open: false }))}
          severity={toast.severity}
          variant="filled"
          sx={{ borderRadius: 2 }}
        >
          {toast.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default DataTransferPage;
