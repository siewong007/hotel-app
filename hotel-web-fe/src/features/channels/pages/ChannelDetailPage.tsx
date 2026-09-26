import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Skeleton,
  Tab,
  Tabs,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate } from '@tanstack/react-router';

import EmptyState from '../../../components/common/EmptyState';
import PageHeader from '../../../components/common/PageHeader';
import { useConfirm } from '../../../components/common/ConfirmProvider';
import { useAuth } from '../../../auth/AuthContext';
import { useTranslation } from '../../../i18n/useTranslation';
import { formatStatusLabel } from '../../../utils/formatters';
import { CommissionRuleDialog } from '../components/CommissionRuleDialog';
import { MappingsPanel } from '../components/MappingsPanel';
import { PricingRuleDialog } from '../components/PricingRuleDialog';
import { PricingRulesTable } from '../components/PricingRulesTable';
import { CommissionRulesTable } from '../components/CommissionRulesTable';
import { PreviewPanel } from '../components/PreviewPanel';
import { useChannelDetail, useChannelDetailMutations, useChannels } from '../hooks/useChannels';
import type { ChannelCommissionRule, ChannelPricingRule } from '../types';

type DetailTab = 'rules' | 'commission' | 'mappings' | 'preview';

interface Props {
  channelId: string;
}

const ChannelDetailPage = ({ channelId }: Props) => {
  const { t, tOr } = useTranslation('channels');
  const { hasPermission } = useAuth();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const id = Number(channelId);
  const canWrite = hasPermission('channels:write') || hasPermission('channels:manage');
  const canManage = hasPermission('channels:manage');

  const [tab, setTab] = useState<DetailTab>('rules');
  const [ruleDialog, setRuleDialog] = useState<{ open: boolean; rule: ChannelPricingRule | null }>({
    open: false,
    rule: null,
  });
  const [commissionDialog, setCommissionDialog] = useState<{
    open: boolean;
    rule: ChannelCommissionRule | null;
  }>({ open: false, rule: null });

  const channels = useChannels();
  const channel = useMemo(
    () => channels.data?.find((item) => item.id === id) ?? null,
    [channels.data, id],
  );
  const detail = useChannelDetail(id);
  const mutations = useChannelDetailMutations(id);

  const subtitle = channel
    ? `${tOr(`types.${channel.channel_type}`, formatStatusLabel(channel.channel_type))} · ${tOr(
        `integration.${channel.integration_mode}`,
        formatStatusLabel(channel.integration_mode),
      )}`
    : undefined;

  return (
    <Box>
      <PageHeader
        title={channel?.name ?? t('detail.title')}
        subtitle={subtitle}
        actions={
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              startIcon={<ArrowBackIcon />}
              onClick={() => navigate({ to: '/channels' })}
            >
              {t('detail.back')}
            </Button>
            {tab === 'rules' && canWrite && (
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setRuleDialog({ open: true, rule: null })}
              >
                {t('rules.new')}
              </Button>
            )}
            {tab === 'commission' && canWrite && (
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setCommissionDialog({ open: true, rule: null })}
              >
                {t('commission.new')}
              </Button>
            )}
          </Box>
        }
      />

      {channel && !channel.is_active && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('detail.inactiveNotice')}
        </Alert>
      )}

      <Tabs
        value={tab}
        onChange={(_, value: DetailTab) => setTab(value)}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{ mb: 2 }}
      >
        <Tab value="rules" label={t('detail.tabs.rules')} />
        <Tab value="commission" label={t('detail.tabs.commission')} />
        <Tab value="mappings" label={t('detail.tabs.mappings')} />
        <Tab value="preview" label={t('detail.tabs.preview')} />
      </Tabs>

      {tab === 'rules' && (
        <Paper variant="outlined" sx={{ borderRadius: 3, p: 2 }}>
          {detail.rules.isLoading && <Skeleton variant="rounded" height={240} />}
          {detail.rules.error && <Alert severity="error">{t('rules.loadError')}</Alert>}
          {detail.rules.data && detail.rules.data.length === 0 && (
            <EmptyState title={t('rules.emptyTitle')} description={t('rules.emptyBody')} />
          )}
          {detail.rules.data && detail.rules.data.length > 0 && (
            <PricingRulesTable
              rules={detail.rules.data}
              canWrite={canWrite}
              canManage={canManage}
              onEdit={(rule) => setRuleDialog({ open: true, rule })}
              onToggleActive={(rule, active) =>
                mutations.updateRule.mutate({ id: rule.id, input: { is_active: active } })
              }
              onDelete={async (rule) => {
                if (
                  !(await confirm({
                    title: t('rules.deleteTitle'),
                    message: t('rules.deleteMessage'),
                    confirmText: t('common:actions.delete'),
                    severity: 'warning',
                  }))
                ) {
                  return;
                }
                mutations.deleteRule.mutate(rule.id);
              }}
            />
          )}
        </Paper>
      )}

      {tab === 'commission' && channel && (
        <Paper variant="outlined" sx={{ borderRadius: 3, p: 2 }}>
          <Box sx={{ mb: 2 }}>
            <Chip
              size="small"
              label={t('commission.defaultChip', {
                type: tOr(
                  `commissionTypes.${channel.default_commission_type}`,
                  formatStatusLabel(channel.default_commission_type),
                ),
                value: String(channel.default_commission_value),
              })}
            />
          </Box>
          {detail.commission.isLoading && <Skeleton variant="rounded" height={160} />}
          {detail.commission.error && (
            <Alert severity="error">{t('commission.loadError')}</Alert>
          )}
          {detail.commission.data && detail.commission.data.length === 0 && (
            <EmptyState
              title={t('commission.emptyTitle')}
              description={t('commission.emptyBody')}
            />
          )}
          {detail.commission.data && detail.commission.data.length > 0 && (
            <CommissionRulesTable
              rules={detail.commission.data}
              canWrite={canWrite}
              canManage={canManage}
              onEdit={(rule) => setCommissionDialog({ open: true, rule })}
              onToggleActive={(rule, active) =>
                mutations.updateCommission.mutate({ id: rule.id, input: { is_active: active } })
              }
              onDelete={async (rule) => {
                if (
                  !(await confirm({
                    title: t('commission.deleteTitle'),
                    message: t('commission.deleteMessage'),
                    confirmText: t('common:actions.delete'),
                    severity: 'warning',
                  }))
                ) {
                  return;
                }
                mutations.deleteCommission.mutate(rule.id);
              }}
            />
          )}
        </Paper>
      )}

      {tab === 'mappings' && (
        <Paper variant="outlined" sx={{ borderRadius: 3, p: 2 }}>
          <MappingsPanel
            mappings={detail.mappings.data}
            loading={detail.mappings.isLoading}
            canWrite={canWrite}
            mutations={mutations}
          />
        </Paper>
      )}

      {tab === 'preview' && (
        <Paper variant="outlined" sx={{ borderRadius: 3, p: 2 }}>
          <PreviewPanel channelId={id} />
        </Paper>
      )}

      <PricingRuleDialog
        open={ruleDialog.open}
        rule={ruleDialog.rule}
        saving={mutations.createRule.isPending || mutations.updateRule.isPending}
        onClose={() => setRuleDialog({ open: false, rule: null })}
        onSubmit={(input) => {
          const done = () => setRuleDialog({ open: false, rule: null });
          if (ruleDialog.rule) {
            mutations.updateRule.mutate({ id: ruleDialog.rule.id, input }, { onSuccess: done });
          } else {
            mutations.createRule.mutate(input, { onSuccess: done });
          }
        }}
      />

      <CommissionRuleDialog
        open={commissionDialog.open}
        rule={commissionDialog.rule}
        saving={mutations.createCommission.isPending || mutations.updateCommission.isPending}
        onClose={() => setCommissionDialog({ open: false, rule: null })}
        onSubmit={(input) => {
          const done = () => setCommissionDialog({ open: false, rule: null });
          if (commissionDialog.rule) {
            mutations.updateCommission.mutate(
              { id: commissionDialog.rule.id, input },
              { onSuccess: done },
            );
          } else {
            mutations.createCommission.mutate(input, { onSuccess: done });
          }
        }}
      />
    </Box>
  );
};

export default ChannelDetailPage;
