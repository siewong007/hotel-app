import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';

import { APIError } from '../../../api';
import type {
  AdminLoyaltyReward,
  AdminRewardInput,
  LoyaltyMemberStatus,
  LoyaltyMemberSummary,
  LoyaltyRedemption,
  LoyaltyRedemptionStatus,
  LoyaltyRulesInput,
  TierQualificationMetric,
} from '../../../types';
import {
  useAdminLoyaltyRewards,
  useApproveRedemption,
  useCreateLoyaltyReward,
  useGiftPoints,
  useLoyaltyMemberDetail,
  useLoyaltyMembers,
  useLoyaltyRedemptions,
  useLoyaltyRules,
  useRejectRedemption,
  useUpdateLoyaltyReward,
  useUpdateLoyaltyRules,
} from '../hooks/useLoyaltyAdmin';
import { useLoyaltySocket } from '../hooks/useLoyaltySocket';
import { useIsPhone } from '../../../hooks/useIsPhone';
import { LogoLoader } from '../../../components';
import { MobileCardRow } from '../../../components/data-table/MobileCardRow';
import { formatNumber, statusLabel, useTranslation } from '../../../i18n';
import { formatHotelDate, formatHotelDateTime } from '../../../utils/date';

const fmt = (n: number | null | undefined): string =>
  typeof n === 'number' ? formatNumber(n) : '—';

const fmtMoney = (n: number | null | undefined): string =>
  typeof n === 'number' ? formatNumber(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';

const fmtDate = (iso?: string | null): string => (iso ? formatHotelDate(iso, '—') : '—');
const fmtDateTime = (iso?: string | null): string => (iso ? formatHotelDateTime(iso, '—') : '—');

const errMessage = (e: unknown, fallback: string): string =>
  e instanceof APIError ? e.message : e ? fallback : '';

const REDEMPTION_STATUS_COLOR: Record<LoyaltyRedemptionStatus, 'warning' | 'success' | 'error'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
};

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

const StatCard: React.FC<{ label: string; value: string; hint?: string }> = ({ label, value, hint }) => (
  <Paper variant="outlined" sx={{ p: 2, flex: '1 1 180px', minWidth: 180 }}>
    <Typography variant="caption" sx={{
      color: "text.secondary"
    }}>
      {label}
    </Typography>
    <Typography variant="h5" component="div" sx={{ fontWeight: 600 }}>
      {value}
    </Typography>
    {hint && (
      <Typography variant="caption" sx={{
        color: "text.secondary"
      }}>
        {hint}
      </Typography>
    )}
  </Paper>
);

const OverviewTab: React.FC = () => {
  const { t } = useTranslation('loyalty');
  const membersQuery = useLoyaltyMembers();
  const pendingQuery = useLoyaltyRedemptions({ status: 'pending' });

  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
  const stats = useMemo(() => {
    const active = members.filter((m) => m.status === 'active').length;
    const availablePoints = members.reduce((sum, m) => sum + (m.available_points || 0), 0);
    const lifetimePoints = members.reduce((sum, m) => sum + (m.lifetime_points || 0), 0);
    const byTier = new Map<string, number>();
    members.forEach((m) => byTier.set(m.tier_name, (byTier.get(m.tier_name) ?? 0) + 1));
    return { active, availablePoints, lifetimePoints, byTier: Array.from(byTier.entries()) };
  }, [members]);

  if (membersQuery.isLoading) return <Loading />;
  if (membersQuery.error) return <Alert severity="error">{errMessage(membersQuery.error, t('portal.overview.loadMembersFailed'))}</Alert>;

  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        <StatCard label={t('portal.overview.totalMembers')} value={fmt(members.length)} hint={t('portal.overview.activeHint', { count: stats.active })} />
        <StatCard label={t('portal.overview.availablePoints')} value={fmt(stats.availablePoints)} />
        <StatCard label={t('portal.overview.lifetimePoints')} value={fmt(stats.lifetimePoints)} />
        <StatCard
          label={t('portal.overview.pendingRedemptions')}
          value={fmt(pendingQuery.data?.length ?? 0)}
          hint={t('portal.overview.pendingHint')}
        />
      </Box>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, mb: 1 }}>
          {t('portal.overview.byTier')}
        </Typography>
        {stats.byTier.length === 0 ? (
          <Typography sx={{
            color: "text.secondary"
          }}>{t('portal.overview.noMembers')}</Typography>
        ) : (
          <Stack spacing={1}>
            {stats.byTier.map(([tier, count]) => {
              const pct = members.length ? (count / members.length) * 100 : 0;
              return (
                <Box key={tier}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2">{tier}</Typography>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>
                      {count} ({Math.round(pct)}%)
                    </Typography>
                  </Box>
                  <LinearProgress variant="determinate" value={pct} aria-label={t('portal.overview.tierShare', { tier })} sx={{ height: 8, borderRadius: 1 }} />
                </Box>
              );
            })}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
};

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

const MemberDetailDialog: React.FC<{ memberId: number | null; onClose: () => void }> = ({ memberId, onClose }) => {
  const { t, tOr } = useTranslation('loyalty');
  const isPhone = useIsPhone();
  const detailQuery = useLoyaltyMemberDetail(memberId);
  const giftPoints = useGiftPoints();
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [giftError, setGiftError] = useState('');

  const detail = detailQuery.data;

  const handleGiftPoints = async () => {
    setGiftError('');
    const pointsToGift = parseInt(points, 10);
    if (Number.isNaN(pointsToGift) || pointsToGift <= 0) {
      setGiftError(t('portal.members.giftInvalidPoints'));
      return;
    }
    if (reason.trim().length < 5) {
      setGiftError(t('portal.members.giftReasonShort'));
      return;
    }
    try {
      await giftPoints.mutateAsync({ id: memberId as number, input: { points: pointsToGift, reason: reason.trim() } });
      setPoints('');
      setReason('');
    } catch (e) {
      setGiftError(errMessage(e, t('portal.members.giftFailed')));
    }
  };

  return (
    <Dialog open={memberId != null} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('portal.members.detailTitle')}</DialogTitle>
      <DialogContent dividers>
        {detailQuery.isLoading && <Loading />}
        {detailQuery.error && <Alert severity="error">{errMessage(detailQuery.error, t('portal.members.loadMemberFailed'))}</Alert>}
        {detail && (
          <Stack spacing={3}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              <StatCard label={t('portal.members.member')} value={detail.member.guest_name} hint={detail.member.member_number} />
              <StatCard label={t('portal.members.tier')} value={detail.member.tier_name} />
              <StatCard label={t('portal.members.availablePoints')} value={fmt(detail.member.available_points)} />
              <StatCard label={t('portal.members.lifetimePoints')} value={fmt(detail.member.lifetime_points)} />
            </Box>

            <Box>
              <Typography variant="subtitle2" component="h3" gutterBottom>
                {t('portal.members.tierProgress', { metric: tOr(`portal.rules.metrics.${detail.tier_progress.metric}`, detail.tier_progress.metric) })}
              </Typography>
              <LinearProgress
                variant="determinate"
                value={Math.min(100, detail.tier_progress.progress_percent)}
                aria-label={t('portal.members.tierProgress', { metric: tOr(`portal.rules.metrics.${detail.tier_progress.metric}`, detail.tier_progress.metric) })}
                sx={{ height: 10, borderRadius: 1, mb: 0.5 }}
              />
              <Typography variant="caption" sx={{
                color: "text.secondary"
              }}>
                {detail.tier_progress.next_tier_name
                  ? t('portal.members.toNextTier', { count: fmt(detail.tier_progress.remaining_to_next_tier ?? 0), tier: detail.tier_progress.next_tier_name })
                  : t('portal.members.highestTier')}
              </Typography>
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" component="h3" gutterBottom>
                {t('portal.members.giftPoints')}
              </Typography>
              {giftError && (
                <Alert severity="error" sx={{ mb: 1 }}>
                  {giftError}
                </Alert>
              )}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{
                alignItems: "flex-start"
              }}>
                <TextField
                  label={t('portal.members.points')}
                  type="number"
                  size="small"
                  value={points}
                  onChange={(e) => setPoints(e.target.value)}
                  sx={{ width: 140 }}
                  slotProps={{
                    htmlInput: { min: 1 }
                  }}
                />
                <TextField
                  label={t('portal.members.reason')}
                  size="small"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  fullWidth
                />
                <Button variant="contained" onClick={handleGiftPoints} disabled={giftPoints.isPending}>
                  {t('portal.members.giftPoints')}
                </Button>
              </Stack>
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" component="h3" gutterBottom>
                {t('portal.members.recentActivity')}
              </Typography>
              {isPhone ? (
                <Box>
                  {detail.recent_activity.length === 0 ? (
                    <Typography variant="body2" align="center" sx={{ color: 'text.secondary', py: 3 }}>
                      {t('portal.members.noActivity')}
                    </Typography>
                  ) : (
                    detail.recent_activity.map((txn) => (
                      <Box
                        key={txn.id}
                        sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
                      >
                        <MobileCardRow
                          title={txn.transaction_type}
                          subtitle={fmtDateTime(txn.created_at)}
                          meta={t('portal.members.activityMeta', { description: txn.description ?? '—', balance: fmt(txn.balance_after) })}
                          status={
                            <Typography
                              variant="body2"
                              sx={{ fontWeight: 700, color: txn.points_delta < 0 ? 'error.main' : 'success.main' }}
                            >
                              {txn.points_delta > 0 ? `+${fmt(txn.points_delta)}` : fmt(txn.points_delta)}
                            </Typography>
                          }
                        />
                      </Box>
                    ))
                  )}
                </Box>
              ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('portal.members.colDate')}</TableCell>
                      <TableCell>{t('portal.members.colType')}</TableCell>
                      <TableCell align="right">{t('portal.members.colPoints')}</TableCell>
                      <TableCell align="right">{t('portal.members.colBalance')}</TableCell>
                      <TableCell>{t('portal.members.colDescription')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {detail.recent_activity.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} align="center">
                          {t('portal.members.noActivity')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      detail.recent_activity.map((txn) => (
                        <TableRow key={txn.id}>
                          <TableCell>{fmtDateTime(txn.created_at)}</TableCell>
                          <TableCell>{txn.transaction_type}</TableCell>
                          <TableCell align="right" sx={{ color: txn.points_delta < 0 ? 'error.main' : 'success.main' }}>
                            {txn.points_delta > 0 ? `+${fmt(txn.points_delta)}` : fmt(txn.points_delta)}
                          </TableCell>
                          <TableCell align="right">{fmt(txn.balance_after)}</TableCell>
                          <TableCell>{txn.description ?? '—'}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              )}
            </Box>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:actions.close')}</Button>
      </DialogActions>
    </Dialog>
  );
};

const MembersTab: React.FC = () => {
  const { t } = useTranslation('loyalty');
  const isPhone = useIsPhone();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | LoyaltyMemberStatus>('');
  const [selected, setSelected] = useState<number | null>(null);

  const params = useMemo(
    () => ({ search: search || undefined, status: status || undefined }),
    [search, status]
  );
  const membersQuery = useLoyaltyMembers(params);
  const members: LoyaltyMemberSummary[] = membersQuery.data ?? [];

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          label={t('portal.members.searchPlaceholder')}
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ flex: 1 }}
        />
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>{t('portal.members.statusLabel')}</InputLabel>
          <Select label={t('portal.members.statusLabel')} value={status} onChange={(e) => setStatus(e.target.value as '' | LoyaltyMemberStatus)}>
            <MenuItem value="">{t('portal.members.all')}</MenuItem>
            <MenuItem value="active">{statusLabel(t, 'loyalty', 'active')}</MenuItem>
            <MenuItem value="closed">{statusLabel(t, 'loyalty', 'closed')}</MenuItem>
          </Select>
        </FormControl>
      </Stack>
      {membersQuery.isLoading ? (
        <Loading />
      ) : membersQuery.error ? (
        <Alert severity="error">{errMessage(membersQuery.error, t('portal.overview.loadMembersFailed'))}</Alert>
      ) : isPhone ? (
        <Paper variant="outlined">
          {members.length === 0 ? (
            <Typography variant="body2" align="center" sx={{ color: 'text.secondary', py: 4 }}>
              {t('portal.members.noMembers')}
            </Typography>
          ) : (
            members.map((m) => (
              <Box
                key={m.id}
                sx={{ borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}
              >
                <MobileCardRow
                  title={m.guest_name}
                  subtitle={`#${m.member_number} · ${m.tier_name}${m.guest_email || m.guest_phone ? ` · ${m.guest_email ?? m.guest_phone}` : ''}`}
                  meta={t('portal.members.memberMeta', { available: fmt(m.available_points), lifetime: fmt(m.lifetime_points), date: fmtDate(m.enrolled_at) })}
                  status={
                    <Chip
                      size="small"
                      label={statusLabel(t, 'loyalty', m.status)}
                      color={m.status === 'active' ? 'success' : 'default'}
                      variant="outlined"
                    />
                  }
                  onClick={() => setSelected(m.id)}
                />
              </Box>
            ))
          )}
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('portal.members.colMemberNumber')}</TableCell>
                <TableCell>{t('portal.members.colGuest')}</TableCell>
                <TableCell>{t('portal.members.colTier')}</TableCell>
                <TableCell align="right">{t('portal.members.colAvailable')}</TableCell>
                <TableCell align="right">{t('portal.members.colLifetime')}</TableCell>
                <TableCell>{t('portal.members.colStatus')}</TableCell>
                <TableCell>{t('portal.members.colEnrolled')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {members.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center">
                    {t('portal.members.noMembers')}
                  </TableCell>
                </TableRow>
              ) : (
                members.map((m) => (
                  <TableRow key={m.id} hover sx={{ cursor: 'pointer' }} onClick={() => setSelected(m.id)}>
                    <TableCell>{m.member_number}</TableCell>
                    <TableCell>
                      <Typography variant="body2">{m.guest_name}</Typography>
                      <Typography variant="caption" sx={{
                        color: "text.secondary"
                      }}>
                        {m.guest_email ?? m.guest_phone ?? ''}
                      </Typography>
                    </TableCell>
                    <TableCell>{m.tier_name}</TableCell>
                    <TableCell align="right">{fmt(m.available_points)}</TableCell>
                    <TableCell align="right">{fmt(m.lifetime_points)}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={statusLabel(t, 'loyalty', m.status)}
                        color={m.status === 'active' ? 'success' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>{fmtDate(m.enrolled_at)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <MemberDetailDialog memberId={selected} onClose={() => setSelected(null)} />
    </Stack>
  );
};

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

const emptyReward: AdminRewardInput = {
  name: '',
  description: '',
  category: '',
  points_cost: 100,
  requires_approval: false,
  is_active: true,
};

const RewardDialog: React.FC<{
  open: boolean;
  reward: AdminLoyaltyReward | null;
  onClose: () => void;
}> = ({ open, reward, onClose }) => {
  const { t } = useTranslation('loyalty');
  const create = useCreateLoyaltyReward();
  const update = useUpdateLoyaltyReward();
  const [form, setForm] = useState<AdminRewardInput>(emptyReward);
  const [error, setError] = useState('');

  React.useEffect(() => {
    if (open) {
      setError('');
      setForm(
        reward
          ? {
              name: reward.name,
              description: reward.description ?? '',
              category: reward.category,
              points_cost: reward.points_cost,
              minimum_tier_id: reward.minimum_tier_id ?? null,
              requires_approval: reward.requires_approval,
              is_active: reward.is_active,
              inventory_count: reward.inventory_count ?? null,
              valid_from: reward.valid_from ?? null,
              valid_to: reward.valid_to ?? null,
              terms_conditions: reward.terms_conditions ?? '',
            }
          : emptyReward
      );
    }
  }, [open, reward]);

  const set = <K extends keyof AdminRewardInput>(key: K, value: AdminRewardInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    setError('');
    if (form.name.trim().length < 2) {
      setError(t('portal.rewards.nameTooShort'));
      return;
    }
    if (form.category.trim().length < 2) {
      setError(t('portal.rewards.categoryRequired'));
      return;
    }
    if (!form.points_cost || form.points_cost < 1) {
      setError(t('portal.rewards.pointsMin'));
      return;
    }
    try {
      if (reward) {
        await update.mutateAsync({ id: reward.id, input: form });
      } else {
        await create.mutateAsync(form);
      }
      onClose();
    } catch (e) {
      setError(errMessage(e, t('portal.rewards.saveFailed')));
    }
  };

  const busy = create.isPending || update.isPending;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{reward ? t('portal.rewards.editTitle') : t('portal.rewards.newTitle')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label={t('portal.rewards.fieldName')} value={form.name} onChange={(e) => set('name', e.target.value)} fullWidth />
          <TextField
            label={t('portal.rewards.fieldDescription')}
            value={form.description ?? ''}
            onChange={(e) => set('description', e.target.value)}
            fullWidth
            multiline
            minRows={2}
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label={t('portal.rewards.fieldCategory')}
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
              fullWidth
            />
            <TextField
              label={t('portal.rewards.fieldPointsCost')}
              type="number"
              value={form.points_cost}
              onChange={(e) => set('points_cost', parseInt(e.target.value, 10) || 0)}
              fullWidth
            />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField
              label={t('portal.rewards.fieldInventory')}
              type="number"
              value={form.inventory_count ?? ''}
              onChange={(e) => set('inventory_count', e.target.value === '' ? null : parseInt(e.target.value, 10))}
              fullWidth
            />
            <TextField
              label={t('portal.rewards.fieldMinTierId')}
              type="number"
              value={form.minimum_tier_id ?? ''}
              onChange={(e) => set('minimum_tier_id', e.target.value === '' ? null : parseInt(e.target.value, 10))}
              fullWidth
            />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField
              label={t('portal.rewards.fieldValidFrom')}
              type="date"
              value={form.valid_from ?? ''}
              onChange={(e) => set('valid_from', e.target.value || null)}
              fullWidth
              slotProps={{
                inputLabel: { shrink: true }
              }}
            />
            <TextField
              label={t('portal.rewards.fieldValidTo')}
              type="date"
              value={form.valid_to ?? ''}
              onChange={(e) => set('valid_to', e.target.value || null)}
              fullWidth
              slotProps={{
                inputLabel: { shrink: true }
              }}
            />
          </Stack>
          <TextField
            label={t('portal.rewards.fieldTerms')}
            value={form.terms_conditions ?? ''}
            onChange={(e) => set('terms_conditions', e.target.value)}
            fullWidth
            multiline
            minRows={2}
          />
          <Stack direction="row" spacing={3}>
            <FormControlLabel
              control={
                <Switch checked={!!form.requires_approval} onChange={(e) => set('requires_approval', e.target.checked)} />
              }
              label={t('portal.rewards.requiresApproval')}
            />
            <FormControlLabel
              control={<Switch checked={!!form.is_active} onChange={(e) => set('is_active', e.target.checked)} />}
              label={t('portal.rewards.activeSwitch')}
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button variant="contained" onClick={handleSave} disabled={busy}>
          {reward ? t('common:actions.save') : t('common:actions.create')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const RewardsTab: React.FC = () => {
  const { t } = useTranslation('loyalty');
  const isPhone = useIsPhone();
  const [includeInactive, setIncludeInactive] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminLoyaltyReward | null>(null);

  const rewardsQuery = useAdminLoyaltyRewards({ include_inactive: includeInactive });
  const rewards = rewardsQuery.data ?? [];

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (r: AdminLoyaltyReward) => {
    setEditing(r);
    setDialogOpen(true);
  };

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        sx={{
          justifyContent: "space-between",
          alignItems: "center"
        }}>
        <FormControlLabel
          control={<Switch checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />}
          label={t('portal.rewards.showInactive')}
        />
        <Button variant="contained" onClick={openNew}>
          {t('portal.rewards.newReward')}
        </Button>
      </Stack>
      {rewardsQuery.isLoading ? (
        <Loading />
      ) : rewardsQuery.error ? (
        <Alert severity="error">{errMessage(rewardsQuery.error, t('portal.rewards.loadFailed'))}</Alert>
      ) : isPhone ? (
        <Paper variant="outlined">
          {rewards.length === 0 ? (
            <Typography variant="body2" align="center" sx={{ color: 'text.secondary', py: 4 }}>
              {t('portal.rewards.noRewards')}
            </Typography>
          ) : (
            rewards.map((r) => (
              <Box
                key={r.id}
                sx={{ borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}
              >
                <MobileCardRow
                  title={r.name}
                  subtitle={t('portal.redemptions.subtitlePts', { reward: r.category, points: fmt(r.points_cost) })}
                  meta={t('portal.rewards.metaLine', {
                    tier: r.minimum_tier_name ?? t('portal.rewards.anyTier'),
                    approval: r.requires_approval ? t('portal.rewards.approvalRequired') : t('portal.rewards.noApproval'),
                    stock: r.inventory_count != null ? fmt(r.inventory_count) : '∞',
                  })}
                  status={
                    <Chip
                      size="small"
                      label={r.is_active ? t('portal.rewards.active') : t('portal.rewards.inactive')}
                      color={r.is_active ? 'success' : 'default'}
                      variant="outlined"
                    />
                  }
                  onClick={() => openEdit(r)}
                />
              </Box>
            ))
          )}
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('portal.rewards.colName')}</TableCell>
                <TableCell>{t('portal.rewards.colCategory')}</TableCell>
                <TableCell align="right">{t('portal.rewards.colPoints')}</TableCell>
                <TableCell>{t('portal.rewards.colMinTier')}</TableCell>
                <TableCell>{t('portal.rewards.colApproval')}</TableCell>
                <TableCell align="right">{t('portal.rewards.colInventory')}</TableCell>
                <TableCell>{t('portal.rewards.colActive')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rewards.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center">
                    {t('portal.rewards.noRewards')}
                  </TableCell>
                </TableRow>
              ) : (
                rewards.map((r) => (
                  <TableRow key={r.id} hover sx={{ cursor: 'pointer' }} onClick={() => openEdit(r)}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell>{r.category}</TableCell>
                    <TableCell align="right">{fmt(r.points_cost)}</TableCell>
                    <TableCell>{r.minimum_tier_name ?? '—'}</TableCell>
                    <TableCell>{r.requires_approval ? t('common:actions.yes') : t('common:actions.no')}</TableCell>
                    <TableCell align="right">{r.inventory_count != null ? fmt(r.inventory_count) : '∞'}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={r.is_active ? t('portal.rewards.active') : t('portal.rewards.inactive')}
                        color={r.is_active ? 'success' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <RewardDialog open={dialogOpen} reward={editing} onClose={() => setDialogOpen(false)} />
    </Stack>
  );
};

// ---------------------------------------------------------------------------
// Redemptions
// ---------------------------------------------------------------------------

const RedemptionsTab: React.FC = () => {
  const { t } = useTranslation('loyalty');
  const isPhone = useIsPhone();
  const [status, setStatus] = useState<'' | LoyaltyRedemptionStatus>('pending');
  const params = useMemo(() => ({ status: status || undefined }), [status]);
  const redemptionsQuery = useLoyaltyRedemptions(params);
  const approve = useApproveRedemption();
  const reject = useRejectRedemption();

  const [rejectTarget, setRejectTarget] = useState<LoyaltyRedemption | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionError, setActionError] = useState('');

  const redemptions = redemptionsQuery.data ?? [];

  const handleApprove = async (id: number) => {
    setActionError('');
    try {
      await approve.mutateAsync(id);
    } catch (e) {
      setActionError(errMessage(e, t('portal.redemptions.approveFailed')));
    }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    if (rejectReason.trim().length < 5) {
      setActionError(t('portal.redemptions.rejectReasonShort'));
      return;
    }
    setActionError('');
    try {
      await reject.mutateAsync({ id: rejectTarget.id, input: { reason: rejectReason.trim() } });
      setRejectTarget(null);
      setRejectReason('');
    } catch (e) {
      setActionError(errMessage(e, t('portal.redemptions.rejectFailed')));
    }
  };

  return (
    <Stack spacing={2}>
      <FormControl size="small" sx={{ minWidth: 180 }}>
        <InputLabel>{t('portal.redemptions.statusLabel')}</InputLabel>
        <Select label={t('portal.redemptions.statusLabel')} value={status} onChange={(e) => setStatus(e.target.value as '' | LoyaltyRedemptionStatus)}>
          <MenuItem value="">{t('portal.redemptions.all')}</MenuItem>
          <MenuItem value="pending">{statusLabel(t, 'loyalty_redemption', 'pending')}</MenuItem>
          <MenuItem value="approved">{statusLabel(t, 'loyalty_redemption', 'approved')}</MenuItem>
          <MenuItem value="rejected">{statusLabel(t, 'loyalty_redemption', 'rejected')}</MenuItem>
        </Select>
      </FormControl>
      {actionError && <Alert severity="error">{actionError}</Alert>}
      {redemptionsQuery.isLoading ? (
        <Loading />
      ) : redemptionsQuery.error ? (
        <Alert severity="error">{errMessage(redemptionsQuery.error, t('portal.redemptions.loadFailed'))}</Alert>
      ) : isPhone ? (
        <Paper variant="outlined">
          {redemptions.length === 0 ? (
            <Typography variant="body2" align="center" sx={{ color: 'text.secondary', py: 4 }}>
              {t('portal.redemptions.noRedemptions')}
            </Typography>
          ) : (
            redemptions.map((r) => (
              <Box
                key={r.id}
                sx={{ borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}
              >
                <MobileCardRow
                  title={r.guest_name}
                  subtitle={t('portal.redemptions.subtitlePts', { reward: r.reward_name, points: fmt(r.points_spent) })}
                  meta={t('portal.redemptions.meta', { member: r.member_number, date: fmtDateTime(r.requested_at) })}
                  status={
                    <Tooltip title={r.rejection_reason ?? ''} disableHoverListener={!r.rejection_reason}>
                      <Chip size="small" label={statusLabel(t, 'loyalty_redemption', r.status)} color={REDEMPTION_STATUS_COLOR[r.status]} variant="outlined" />
                    </Tooltip>
                  }
                  footer={
                    r.status === 'pending' ? (
                      <>
                        <Button
                          size="small"
                          color="success"
                          variant="outlined"
                          disabled={approve.isPending}
                          onClick={() => handleApprove(r.id)}
                        >
                          {t('portal.redemptions.approve')}
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          variant="outlined"
                          onClick={() => {
                            setRejectTarget(r);
                            setRejectReason('');
                            setActionError('');
                          }}
                        >
                          {t('portal.redemptions.reject')}
                        </Button>
                      </>
                    ) : undefined
                  }
                />
              </Box>
            ))
          )}
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('portal.redemptions.colRequested')}</TableCell>
                <TableCell>{t('portal.redemptions.colMember')}</TableCell>
                <TableCell>{t('portal.redemptions.colReward')}</TableCell>
                <TableCell align="right">{t('portal.redemptions.colPoints')}</TableCell>
                <TableCell>{t('portal.redemptions.colStatus')}</TableCell>
                <TableCell align="right">{t('portal.redemptions.colActions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {redemptions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    {t('portal.redemptions.noRedemptions')}
                  </TableCell>
                </TableRow>
              ) : (
                redemptions.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{fmtDateTime(r.requested_at)}</TableCell>
                    <TableCell>
                      <Typography variant="body2">{r.guest_name}</Typography>
                      <Typography variant="caption" sx={{
                        color: "text.secondary"
                      }}>
                        {r.member_number}
                      </Typography>
                    </TableCell>
                    <TableCell>{r.reward_name}</TableCell>
                    <TableCell align="right">{fmt(r.points_spent)}</TableCell>
                    <TableCell>
                      <Tooltip title={r.rejection_reason ?? ''} disableHoverListener={!r.rejection_reason}>
                        <Chip size="small" label={statusLabel(t, 'loyalty_redemption', r.status)} color={REDEMPTION_STATUS_COLOR[r.status]} variant="outlined" />
                      </Tooltip>
                    </TableCell>
                    <TableCell align="right">
                      {r.status === 'pending' && (
                        <Stack direction="row" spacing={1} sx={{
                          justifyContent: "flex-end"
                        }}>
                          <Button
                            size="small"
                            color="success"
                            variant="outlined"
                            disabled={approve.isPending}
                            onClick={() => handleApprove(r.id)}
                          >
                            {t('portal.redemptions.approve')}
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            variant="outlined"
                            onClick={() => {
                              setRejectTarget(r);
                              setRejectReason('');
                              setActionError('');
                            }}
                          >
                            {t('portal.redemptions.reject')}
                          </Button>
                        </Stack>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <Dialog open={rejectTarget != null} onClose={() => setRejectTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('portal.redemptions.rejectTitle')}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {rejectTarget?.guest_name} — {rejectTarget?.reward_name}
          </Typography>
          <TextField
            label={t('portal.redemptions.reason')}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            fullWidth
            multiline
            minRows={2}
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectTarget(null)}>{t('common:actions.cancel')}</Button>
          <Button color="error" variant="contained" onClick={handleReject} disabled={reject.isPending}>
            {t('portal.redemptions.reject')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
};

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const RulesTab: React.FC = () => {
  const { t } = useTranslation('loyalty');
  const rulesQuery = useLoyaltyRules();
  const updateRules = useUpdateLoyaltyRules();
  const [form, setForm] = useState<LoyaltyRulesInput | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  React.useEffect(() => {
    if (rulesQuery.data) {
      const d = rulesQuery.data;
      setForm({
        points_per_currency_unit: d.points_per_currency_unit,
        tier_qualification_metric: d.tier_qualification_metric,
        point_expiry_months: d.point_expiry_months ?? null,
        redemption_approval_required: d.redemption_approval_required,
        earning_enabled: d.earning_enabled,
        min_eligible_amount: d.min_eligible_amount,
      });
    }
  }, [rulesQuery.data]);

  if (rulesQuery.isLoading) return <Loading />;
  if (rulesQuery.error) return <Alert severity="error">{errMessage(rulesQuery.error, t('portal.rules.loadFailed'))}</Alert>;
  if (!form) return null;

  const set = <K extends keyof LoyaltyRulesInput>(key: K, value: LoyaltyRulesInput[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const handleSave = async () => {
    setError('');
    setSaved(false);
    try {
      await updateRules.mutateAsync(form);
      setSaved(true);
    } catch (e) {
      setError(errMessage(e, t('portal.rules.saveFailed')));
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 3, maxWidth: 560 }}>
      <Stack spacing={2}>
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
          {t('portal.rules.title')}
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {saved && <Alert severity="success">{t('portal.rules.saved')}</Alert>}

        <TextField
          label={t('portal.rules.pointsPerUnit')}
          type="number"
          value={form.points_per_currency_unit}
          onChange={(e) => set('points_per_currency_unit', parseFloat(e.target.value) || 0)}
        />
        <FormControl fullWidth>
          <InputLabel>{t('portal.rules.tierMetric')}</InputLabel>
          <Select
            label={t('portal.rules.tierMetric')}
            value={form.tier_qualification_metric}
            onChange={(e) => set('tier_qualification_metric', e.target.value as TierQualificationMetric)}
          >
            <MenuItem value="points">{t('portal.rules.metricPoints')}</MenuItem>
            <MenuItem value="nights">{t('portal.rules.metricNights')}</MenuItem>
            <MenuItem value="spend">{t('portal.rules.metricSpend')}</MenuItem>
          </Select>
        </FormControl>
        <TextField
          label={t('portal.rules.pointExpiry')}
          type="number"
          value={form.point_expiry_months ?? ''}
          onChange={(e) => set('point_expiry_months', e.target.value === '' ? null : parseInt(e.target.value, 10))}
        />
        <TextField
          label={t('portal.rules.minAmount')}
          type="number"
          value={form.min_eligible_amount}
          onChange={(e) => set('min_eligible_amount', parseFloat(e.target.value) || 0)}
          helperText={t('portal.rules.minAmountHelper', { amount: fmtMoney(form.min_eligible_amount) })}
        />
        <FormControlLabel
          control={<Switch checked={form.earning_enabled} onChange={(e) => set('earning_enabled', e.target.checked)} />}
          label={t('portal.rules.earningEnabled')}
        />
        <FormControlLabel
          control={
            <Switch
              checked={form.redemption_approval_required}
              onChange={(e) => set('redemption_approval_required', e.target.checked)}
            />
          }
          label={t('portal.rules.approvalRequired')}
        />
        <Box>
          <Button variant="contained" onClick={handleSave} disabled={updateRules.isPending}>
            {t('portal.rules.save')}
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
};

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

const Loading: React.FC = () => <LogoLoader variant="page" />;

// ---------------------------------------------------------------------------
// Portal shell
// ---------------------------------------------------------------------------

const LoyaltyPortal: React.FC = () => {
  const { t } = useTranslation('loyalty');
  useLoyaltySocket();
  const [tab, setTab] = useState(0);

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack
        direction="row"
        sx={{
          justifyContent: "space-between",
          alignItems: "center",
          mb: 2
        }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
          {t('portal.title')}
        </Typography>
        <Tooltip title={t('portal.refresh')}>
          <Button startIcon={<RefreshIcon />} onClick={() => window.location.reload()} size="small">
            {t('portal.refresh')}
          </Button>
        </Tooltip>
      </Stack>
      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto">
          <Tab label={t('portal.tabs.overview')} />
          <Tab label={t('portal.tabs.members')} />
          <Tab label={t('portal.tabs.rewards')} />
          <Tab label={t('portal.tabs.redemptions')} />
          <Tab label={t('portal.tabs.rules')} />
        </Tabs>
      </Paper>
      {tab === 0 && <OverviewTab />}
      {tab === 1 && <MembersTab />}
      {tab === 2 && <RewardsTab />}
      {tab === 3 && <RedemptionsTab />}
      {tab === 4 && <RulesTab />}
    </Box>
  );
};

export default LoyaltyPortal;
