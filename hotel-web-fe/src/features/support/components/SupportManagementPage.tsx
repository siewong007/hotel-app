import {
  Alert,
  Badge,
  Box,
  Button,
  Container,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Refresh as RefreshIcon, Search as SearchIcon } from '@mui/icons-material';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../auth/AuthContext';
import { getQueryErrorMessage } from '../../../api/queryConfig';
import { useTranslation } from '../../../i18n/useTranslation';
import { statusLabel } from '../../../i18n/statusLabel';
import type {
  SupportActionPayload,
  SupportConversationListParams,
  SupportConversationStatus,
  SupportQueueMetrics,
  SupportPriority,
  SupportQueue,
} from '../types';
import {
  SUPPORT_PRIORITY_OPTIONS,
  SUPPORT_QUEUE_TABS,
  SUPPORT_STATUS_OPTIONS,
} from '../types';
import {
  useSendSupportMessage,
  useSupportAction,
  useSupportAgents,
  useSupportConversation,
  useSupportConversations,
} from '../hooks/useSupportQueries';
import SupportConversationDetail from './SupportConversationDetail';
import SupportConversationList from './SupportConversationList';

const INITIAL_PARAMS: SupportConversationListParams = {
  queue: 'waiting_for_staff',
  page: 1,
  page_size: 20,
};

function metricForQueue(queue: SupportQueue, metrics?: SupportQueueMetrics): number | undefined {
  switch (queue) {
    case 'unassigned':
      return metrics?.unassigned;
    case 'waiting_for_staff':
      return metrics?.waiting_for_staff;
    case 'waiting_for_guest':
      return metrics?.waiting_for_guest;
    case 'at_risk':
      return metrics?.at_risk ?? metrics?.breached;
    default:
      return undefined;
  }
}

export default function SupportManagementPage() {
  const { hasPermission, user } = useAuth();
  const { t } = useTranslation('support');
  const [params, setParams] = useState<SupportConversationListParams>(INITIAL_PARAMS);
  const [selectedConversationId, setSelectedConversationId] = useState<number>();
  const deferredSearch = useDeferredValue(params.search);
  const queryParams = useMemo(() => ({ ...params, search: deferredSearch }), [deferredSearch, params]);

  const canWrite = hasPermission('support:write') || hasPermission('support:manage');
  const canAssign = hasPermission('support:assign') || hasPermission('support:manage');
  const canEscalate = hasPermission('support:escalate') || hasPermission('support:manage');
  const canManage = hasPermission('support:manage');
  const queueQuery = useSupportConversations(queryParams);
  const detailQuery = useSupportConversation(selectedConversationId);
  const agentsQuery = useSupportAgents(canAssign);
  const actionMutation = useSupportAction();
  const messageMutation = useSendSupportMessage();
  const isBusy = actionMutation.isPending || messageMutation.isPending;

  const listData = queueQuery.data;
  const conversations = useMemo(() => listData?.items ?? [], [listData]);
  const queryError = queueQuery.error || detailQuery.error || agentsQuery.error;

  useEffect(() => {
    if (!selectedConversationId && conversations[0]) {
      setSelectedConversationId(conversations[0].id);
    }
  }, [conversations, selectedConversationId]);

  const updateParams = (updates: Partial<SupportConversationListParams>) => {
    setParams(current => ({ ...current, ...updates, page: updates.page ?? 1 }));
  };

  const handleQueueChange = (_: React.SyntheticEvent, queue: SupportQueue) => {
    updateParams({ queue, page: 1 });
  };

  const handleAction = async (payload: SupportActionPayload) => {
    if (!selectedConversationId) throw new Error(t('detail.actionFailed'));
    await actionMutation.mutateAsync({ conversationId: selectedConversationId, payload });
  };

  const handleSendMessage = async (payload: { message: string; client_message_id: string; expected_version: number }) => {
    if (!selectedConversationId) throw new Error(t('detail.sendFailed'));
    await messageMutation.mutateAsync({ conversationId: selectedConversationId, payload });
  };

  const refresh = () => {
    void queueQuery.refetch();
    if (selectedConversationId) void detailQuery.refetch();
  };

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Stack spacing={2}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          sx={{
            justifyContent: "space-between",
            alignItems: { sm: 'center' },
            gap: 1
          }}>
          <Box>
            <Typography variant="h5">{t('page.title')}</Typography>
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>
              {t('page.subtitle')}
            </Typography>
          </Box>
          <Tooltip title={t('page.refreshTooltip')}>
            <span>
              <IconButton
                aria-label={t('page.refreshAria')}
                onClick={refresh}
                disabled={queueQuery.isFetching || detailQuery.isFetching}
              >
                <RefreshIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>

        {!canWrite ? (
          <Alert severity="info">{t('page.readOnly')}</Alert>
        ) : null}
        {queryError ? (
          <Alert severity="error">{getQueryErrorMessage(queryError, t('page.loadFailed'))}</Alert>
        ) : null}

        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <Tabs
            value={params.queue ?? 'waiting_for_staff'}
            onChange={handleQueueChange}
            variant="scrollable"
            scrollButtons="auto"
            aria-label={t('page.tabsAria')}
            sx={{ px: 1, borderBottom: 1, borderColor: 'divider' }}
          >
            {SUPPORT_QUEUE_TABS.map(tab => {
              const count = metricForQueue(tab.value, listData?.metrics);
              return (
                <Tab
                  key={tab.value}
                  value={tab.value}
                  label={count === undefined ? t(tab.labelKey) : (
                    <Badge color="primary" badgeContent={count} max={999} sx={{ '& .MuiBadge-badge': { right: -12, top: 5 } }}>
                      <Box component="span" sx={{ pr: 1 }}>{t(tab.labelKey)}</Box>
                    </Badge>
                  )}
                />
              );
            })}
          </Tabs>

          <Box sx={{ p: 1.5, bgcolor: 'background.default', borderBottom: 1, borderColor: 'divider' }}>
            <Stack direction={{ xs: 'column', md: 'row' }} sx={{
              gap: 1
            }}>
              <TextField
                size="small"
                label={t('page.searchLabel')}
                placeholder={t('page.searchPlaceholder')}
                value={params.search ?? ''}
                onChange={(event) => updateParams({ search: event.target.value })}
                sx={{ minWidth: { md: 300 }, flex: 1 }}
                slotProps={{
                  input: { startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> }
                }}
              />
              <FormControl size="small" sx={{ minWidth: 180 }}>
                <InputLabel id="support-status-filter">{t('page.statusLabel')}</InputLabel>
                <Select
                  labelId="support-status-filter"
                  label={t('page.statusLabel')}
                  value={params.status ?? 'all'}
                  onChange={(event) => updateParams({
                    status: event.target.value === 'all' ? undefined : event.target.value as SupportConversationStatus,
                  })}
                >
                  <MenuItem value="all">{t('page.allStatuses')}</MenuItem>
                  {SUPPORT_STATUS_OPTIONS.map(status => (
                    <MenuItem key={status} value={status}>{statusLabel(t, 'support', status)}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel id="support-priority-filter">{t('page.priorityLabel')}</InputLabel>
                <Select
                  labelId="support-priority-filter"
                  label={t('page.priorityLabel')}
                  value={params.priority ?? 'all'}
                  onChange={(event) => updateParams({
                    priority: event.target.value === 'all' ? undefined : event.target.value as SupportPriority,
                  })}
                >
                  <MenuItem value="all">{t('page.allPriorities')}</MenuItem>
                  {SUPPORT_PRIORITY_OPTIONS.map(priority => (
                    <MenuItem key={priority} value={priority}>{statusLabel(t, 'priority', priority)}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button variant="text" onClick={() => setParams(INITIAL_PARAMS)}>{t('common:actions.reset')}</Button>
            </Stack>
          </Box>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: 'minmax(340px, 40%) minmax(0, 1fr)' },
              height: { xs: 'auto', lg: 'calc(100vh - 300px)' },
              minHeight: { lg: 580 },
            }}
          >
            <Box sx={{ minHeight: { xs: 420, lg: 0 }, borderRight: { lg: 1 }, borderColor: 'divider' }}>
              <SupportConversationList
                conversations={conversations}
                selectedConversationId={selectedConversationId}
                isLoading={queueQuery.isLoading}
                isFetching={queueQuery.isFetching}
                total={listData?.total ?? 0}
                page={listData?.page ?? params.page ?? 1}
                pageSize={listData?.page_size ?? params.page_size ?? 20}
                onSelect={setSelectedConversationId}
                onPageChange={(page) => updateParams({ page })}
                onPageSizeChange={(pageSize) => updateParams({ page_size: pageSize, page: 1 })}
              />
            </Box>
            <Box sx={{ minHeight: { xs: 600, lg: 0 }, borderTop: { xs: 1, lg: 0 }, borderColor: 'divider' }}>
              <SupportConversationDetail
                detail={detailQuery.data}
                isLoading={detailQuery.isLoading}
                agents={agentsQuery.data ?? []}
                currentUserId={user?.id === undefined ? undefined : Number(user.id)}
                canWrite={canWrite}
                canAssign={canAssign}
                canEscalate={canEscalate}
                canManage={canManage}
                isBusy={isBusy}
                onAction={handleAction}
                onSendMessage={handleSendMessage}
              />
            </Box>
          </Box>
        </Paper>
      </Stack>
    </Container>
  );
}
