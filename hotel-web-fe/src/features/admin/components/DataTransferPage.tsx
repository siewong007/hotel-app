import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
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
import { useTranslation } from '../../../i18n';
import PageHeader from '../../../components/common/PageHeader';
import { shouldUseDesktopRuntime } from '../../../desktop/runtimeApi';
import DesktopBackupsCard from './data-transfer/DesktopBackupsCard';
import ExportPanel from './data-transfer/ExportPanel';
import ImportWizard from './data-transfer/ImportWizard';
import TransferHistoryList from './data-transfer/TransferHistoryList';
import { useTransferHistoryQuery } from '../hooks/useDataTransferQueries';
import { mapServerHistoryEntry } from './data-transfer/utils';
import type { ToastSeverity } from './data-transfer/types';

type Tab = 'export' | 'import' | 'history';

const DataTransferPage: React.FC = () => {
  const theme = useTheme();
  const { t } = useTranslation('dataTransfer');
  const { hasPermission } = useAuth();

  // Each section maps to its server-enforced permission — the client gates
  // mirror the API checks, never replace them.
  const canView = hasPermission('data_transfer:view');
  const canExport =
    hasPermission('data_transfer:export') || hasPermission('data_transfer:export_sensitive');
  const canImport = hasPermission('data_transfer:import');

  const visibleTabs = useMemo(
    () =>
      ([
        canExport ? 'export' : null,
        canImport ? 'import' : null,
        'history',
      ] as const).filter((tab): tab is Tab => tab !== null),
    [canExport, canImport],
  );

  const [tab, setTab] = useState<Tab>('export');
  const [toast, setToast] = useState<{ open: boolean; msg: string; severity: ToastSeverity }>({
    open: false,
    msg: '',
    severity: 'success',
  });

  const historyQuery = useTransferHistoryQuery(100);
  const historyEntries = useMemo(
    () =>
      (historyQuery.data?.entries ?? []).map((row) =>
        mapServerHistoryEntry(row, {
          exportType: (exportType) =>
            exportType === 'full' || exportType === 'backup'
              ? t(`history.exportTypes.${exportType}`)
              : t('history.exportTypes.standard'),
          reAuth: t('history.reAuth'),
          reAuthDenied: t('history.reAuthDenied'),
          importStarted: t('history.importStarted'),
          entities: (count) => t('history.entitiesCount', { count }),
          unknownUser: t('history.unknownUser'),
        }),
      ),
    [historyQuery.data, t],
  );

  if (!canView) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">{t('page.noPermission')}</Alert>
      </Box>
    );
  }

  // Fall back to the first visible tab when a permission the current tab
  // needed isn't held (e.g. import-only account landing on 'export').
  const activeTab: Tab = visibleTabs.includes(tab) ? tab : visibleTabs[0];

  const notify = (msg: string, severity: ToastSeverity = 'success') =>
    setToast({ open: true, msg, severity });

  return (
    <Box sx={{ p: 3, maxWidth: 1320, mx: 'auto' }}>
      <PageHeader
        sx={{ mb: 2 }}
        title={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {t('page.title')}
            <Chip
              label={t('page.permissionChip')}
              size="small"
              variant="outlined"
              sx={{ height: 22, fontSize: 11, fontWeight: 600, fontFamily: 'monospace' }}
            />
          </Box>
        }
        subtitle={
          <Box component="span" sx={{ maxWidth: 680, display: 'inline-block' }}>
            {t('page.subtitle')}
          </Box>
        }
      />

      {visibleTabs.length > 1 && (
        <ToggleButtonGroup
          value={activeTab}
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
          {canExport && (
            <ToggleButton value="export">
              <DownloadIcon sx={{ fontSize: 18, mr: 0.75 }} /> {t('page.tabs.export')}
            </ToggleButton>
          )}
          {canImport && (
            <ToggleButton value="import">
              <UploadIcon sx={{ fontSize: 18, mr: 0.75 }} /> {t('page.tabs.import')}
            </ToggleButton>
          )}
          <ToggleButton value="history">
            <HistoryIcon sx={{ fontSize: 18, mr: 0.75 }} /> {t('page.tabs.history')}
          </ToggleButton>
        </ToggleButtonGroup>
      )}

      {activeTab === 'export' && canExport && <ExportPanel notify={notify} />}
      {activeTab === 'import' && canImport && (
        <ImportWizard notify={notify} onFinished={() => setTab('history')} />
      )}
      {activeTab === 'history' && (
        <TransferHistoryList entries={historyEntries} loading={historyQuery.isLoading} />
      )}

      {/* Desktop-only managed backups; restore overwrites the same data the
          import flow does, so it carries the same permission — the card
          double-gates on both checks. */}
      {canImport && shouldUseDesktopRuntime() && <DesktopBackupsCard notify={notify} />}

      <Snackbar
        open={toast.open}
        autoHideDuration={3800}
        onClose={() => setToast((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        sx={{ top: { xs: 72, sm: 88 } }}
      >
        <Alert
          onClose={() => setToast((prev) => ({ ...prev, open: false }))}
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
