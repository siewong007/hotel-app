import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Alert,
  Box,
  Button,
  Paper,
  Skeleton,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

import EmptyState from '../../../components/common/EmptyState';
import PageHeader from '../../../components/common/PageHeader';
import { useConfirm } from '../../../components/common/ConfirmProvider';
import { useAuth } from '../../../auth/AuthContext';
import { useTranslation } from '../../../i18n/useTranslation';
import { formatLocalDate } from '../../../utils/date';
import { ChannelDialog } from '../components/ChannelDialog';
import { ChannelMatrix } from '../components/ChannelMatrix';
import { ChannelTable } from '../components/ChannelTable';
import { useChannelMatrix, useChannelMutations, useChannels } from '../hooks/useChannels';
import type { BookingChannel } from '../types';

type ChannelsTab = 'channels' | 'matrix';

const ChannelsPage = () => {
  const { t } = useTranslation('channels');
  const { hasPermission } = useAuth();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const canWrite = hasPermission('channels:write') || hasPermission('channels:manage');

  const [tab, setTab] = useState<ChannelsTab>('channels');
  const [dialog, setDialog] = useState<{ open: boolean; channel: BookingChannel | null }>({
    open: false,
    channel: null,
  });
  const [matrixDate, setMatrixDate] = useState(() => formatLocalDate(new Date()));

  const channels = useChannels();
  const mutations = useChannelMutations();
  const matrix = useChannelMatrix(tab === 'matrix' ? matrixDate : undefined);

  return (
    <Box>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          tab === 'channels' && canWrite ? (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setDialog({ open: true, channel: null })}
            >
              {t('actions.newChannel')}
            </Button>
          ) : undefined
        }
      />

      <Tabs value={tab} onChange={(_, value: ChannelsTab) => setTab(value)} sx={{ mb: 2 }}>
        <Tab value="channels" label={t('tabs.channels')} />
        <Tab value="matrix" label={t('tabs.matrix')} />
      </Tabs>

      {tab === 'channels' && (
        <Paper variant="outlined" sx={{ borderRadius: 3, p: 2 }}>
          {channels.isLoading && <Skeleton variant="rounded" height={240} />}
          {channels.error && <Alert severity="error">{t('list.loadError')}</Alert>}
          {channels.data && channels.data.length === 0 && (
            <EmptyState title={t('list.emptyTitle')} description={t('list.emptyBody')} />
          )}
          {channels.data && channels.data.length > 0 && (
            <ChannelTable
              channels={channels.data}
              canWrite={canWrite}
              onOpen={(channel) =>
                navigate({ to: '/channels/$channelId', params: { channelId: String(channel.id) } })
              }
              onEdit={(channel) => setDialog({ open: true, channel })}
              onDeactivate={async (channel) => {
                if (
                  !(await confirm({
                    title: t('list.deactivateTitle'),
                    message: t('list.deactivateMessage', { name: channel.name }),
                    confirmText: t('list.deactivateConfirm'),
                    severity: 'warning',
                  }))
                ) {
                  return;
                }
                mutations.deactivate.mutate(channel.id);
              }}
            />
          )}
        </Paper>
      )}

      {tab === 'matrix' && (
        <Paper variant="outlined" sx={{ borderRadius: 3, p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
            <TextField
              type="date"
              size="small"
              label={t('matrix.dateLabel')}
              value={matrixDate}
              onChange={(event) => setMatrixDate(event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <Typography variant="body2" color="text.secondary">
              {t('matrix.hint')}
            </Typography>
          </Box>
          {matrix.isLoading && <Skeleton variant="rounded" height={360} />}
          {matrix.error && <Alert severity="error">{t('matrix.loadError')}</Alert>}
          {matrix.data && <ChannelMatrix matrix={matrix.data} />}
        </Paper>
      )}

      <ChannelDialog
        open={dialog.open}
        channel={dialog.channel}
        saving={mutations.create.isPending || mutations.update.isPending}
        onClose={() => setDialog({ open: false, channel: null })}
        onSubmit={(input) => {
          const done = () => setDialog({ open: false, channel: null });
          if (dialog.channel) {
            mutations.update.mutate({ id: dialog.channel.id, input }, { onSuccess: done });
          } else {
            mutations.create.mutate(input, { onSuccess: done });
          }
        }}
      />
    </Box>
  );
};

export default ChannelsPage;
