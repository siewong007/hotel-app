import React, { useMemo } from 'react';
import {
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { DataTable, type ColumnDef } from '../../../../components';
import type { GuestCredit } from './types';
import { useTranslation } from '../../../../i18n';

interface GuestCreditsPanelProps {
  credits: GuestCredit[];
  loading?: boolean;
  onAdd: () => void;
  onEdit: (credit: GuestCredit) => void;
  onDelete: (credit: GuestCredit) => void;
}

const GuestCreditsPanel: React.FC<GuestCreditsPanelProps> = ({
  credits,
  loading = false,
  onAdd,
  onEdit,
  onDelete,
}) => {
  const { t } = useTranslation('bookings');
  const creditColumns = useMemo<ColumnDef<GuestCredit, any>[]>(() => [
    {
      id: 'guest',
      header: t('comp.colGuest'),
      accessorFn: (c) => c.guest_name,
      cell: (info) => {
        const c = info.row.original;
        return (
          <Box>
            <Typography variant="body2">{c.guest_name}</Typography>
            <Typography variant="caption" sx={{
              color: "text.secondary"
            }}>{c.email}</Typography>
          </Box>
        );
      },
    },
    {
      id: 'room_type',
      header: t('comp.colRoomType'),
      accessorFn: (c) => c.room_type_code || c.room_type_name,
      cell: (info) => <Chip label={info.getValue() as string} size="small" variant="outlined" />,
    },
    {
      id: 'notes',
      header: t('comp.colReason2'),
      accessorFn: (c) => c.reason || c.notes || '',
      cell: (info) => (
        <Typography variant="caption" sx={{
          color: "text.secondary"
        }}>
          {(info.getValue() as string) || '-'}
        </Typography>
      ),
    },
    {
      id: 'credits',
      header: t('comp.colCredits'),
      accessorFn: (c) => c.nights_available,
      meta: { align: 'center' },
      cell: (info) => (
        <Chip label={t('comp.nights', { count: info.getValue() as number })} size="small" color="success" />
      ),
    },
    {
      id: 'actions',
      header: t('comp.colActions'),
      enableSorting: false,
      enableColumnFilter: false,
      meta: { align: 'right', stopRowClick: true },
      cell: (info) => {
        const credit = info.row.original;
        return (
          <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
            <Tooltip title={t('comp.editCredits')}>
              <IconButton size="small" color="primary" onClick={() => onEdit(credit)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('comp.deleteCredits')}>
              <IconButton size="small" color="error" onClick={() => onDelete(credit)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        );
      },
    },
  ], [onEdit, onDelete, t]);

  return (
    <Paper sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">
          {t('comp.creditsTitle')}
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={onAdd}
          color="secondary"
        >
          {t('comp.addCredits')}
        </Button>
      </Box>
      {!loading && credits.length === 0 ? (
        <Typography sx={{
          color: "text.secondary"
        }}>{t('comp.noCredits')}</Typography>
      ) : (
        <DataTable<GuestCredit>
          data={credits}
          columns={creditColumns}
          loading={loading}
          getRowId={(row) => `${row.guest_id}-${row.room_type_id}`}
          renderMobileCard={(c) => (
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{c.guest_name}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{c.email}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {c.room_type_code || c.room_type_name}
                  </Typography>
                </Box>
                <Chip label={t('comp.nights', { count: c.nights_available })} size="small" color="success" />
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1 }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', flex: 1, minWidth: 0 }}>
                  {c.reason || c.notes || '-'}
                </Typography>
                <Box sx={{ flexShrink: 0 }}>
                  <IconButton size="small" color="primary" onClick={() => onEdit(c)} aria-label={t('comp.editCredits')}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" color="error" onClick={() => onDelete(c)} aria-label={t('comp.deleteCredits')}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              </Box>
            </Box>
          )}
        />
      )}
    </Paper>
  );
};

export default GuestCreditsPanel;
