import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
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
  useAdjustPoints,
  useAdminLoyaltyRewards,
  useApproveRedemption,
  useCreateLoyaltyReward,
  useLoyaltyMemberDetail,
  useLoyaltyMembers,
  useLoyaltyRedemptions,
  useLoyaltyRules,
  useRejectRedemption,
  useUpdateLoyaltyReward,
  useUpdateLoyaltyRules,
} from '../hooks/useLoyaltyAdmin';

const fmt = (n: number | null | undefined): string =>
  typeof n === 'number' ? n.toLocaleString() : '—';

const fmtMoney = (n: number | null | undefined): string =>
  typeof n === 'number' ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';

const fmtDate = (iso?: string | null): string => (iso ? new Date(iso).toLocaleDateString() : '—');
const fmtDateTime = (iso?: string | null): string => (iso ? new Date(iso).toLocaleString() : '—');

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
    <Typography variant="caption" color="text.secondary">
      {label}
    </Typography>
    <Typography variant="h5" sx={{ fontWeight: 600 }}>
      {value}
    </Typography>
    {hint && (
      <Typography variant="caption" color="text.secondary">
        {hint}
      </Typography>
    )}
  </Paper>
);

const OverviewTab: React.FC = () => {
  const membersQuery = useLoyaltyMembers();
  const pendingQuery = useLoyaltyRedemptions({ status: 'pending' });

  const members = membersQuery.data ?? [];
  const stats = useMemo(() => {
    const active = members.filter((m) => m.status === 'active').length;
    const availablePoints = members.reduce((sum, m) => sum + (m.available_points || 0), 0);
    const lifetimePoints = members.reduce((sum, m) => sum + (m.lifetime_points || 0), 0);
    const byTier = new Map<string, number>();
    members.forEach((m) => byTier.set(m.tier_name, (byTier.get(m.tier_name) ?? 0) + 1));
    return { active, availablePoints, lifetimePoints, byTier: Array.from(byTier.entries()) };
  }, [members]);

  if (membersQuery.isLoading) return <Loading />;
  if (membersQuery.error) return <Alert severity="error">{errMessage(membersQuery.error, 'Failed to load members')}</Alert>;

  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        <StatCard label="Total members" value={fmt(members.length)} hint={`${stats.active} active`} />
        <StatCard label="Available points" value={fmt(stats.availablePoints)} />
        <StatCard label="Lifetime points" value={fmt(stats.lifetimePoints)} />
        <StatCard
          label="Pending redemptions"
          value={fmt(pendingQuery.data?.length ?? 0)}
          hint="awaiting review"
        />
      </Box>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
          Members by tier
        </Typography>
        {stats.byTier.length === 0 ? (
          <Typography color="text.secondary">No members enrolled yet.</Typography>
        ) : (
          <Stack spacing={1}>
            {stats.byTier.map(([tier, count]) => {
              const pct = members.length ? (count / members.length) * 100 : 0;
              return (
                <Box key={tier}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2">{tier}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {count} ({Math.round(pct)}%)
                    </Typography>
                  </Box>
                  <LinearProgress variant="determinate" value={pct} sx={{ height: 8, borderRadius: 1 }} />
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
  const detailQuery = useLoyaltyMemberDetail(memberId);
  const adjust = useAdjustPoints();
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [adjustError, setAdjustError] = useState('');

  const detail = detailQuery.data;

  const handleAdjust = async () => {
    setAdjustError('');
    const points = parseInt(delta, 10);
    if (Number.isNaN(points) || points === 0) {
      setAdjustError('Enter a non-zero points value');
      return;
    }
    if (reason.trim().length < 5) {
      setAdjustError('Reason must be at least 5 characters');
      return;
    }
    try {
      await adjust.mutateAsync({ id: memberId as number, input: { points_delta: points, reason: reason.trim() } });
      setDelta('');
      setReason('');
    } catch (e) {
      setAdjustError(errMessage(e, 'Failed to adjust points'));
    }
  };

  return (
    <Dialog open={memberId != null} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Member details</DialogTitle>
      <DialogContent dividers>
        {detailQuery.isLoading && <Loading />}
        {detailQuery.error && <Alert severity="error">{errMessage(detailQuery.error, 'Failed to load member')}</Alert>}
        {detail && (
          <Stack spacing={3}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              <StatCard label="Member" value={detail.member.guest_name} hint={detail.member.member_number} />
              <StatCard label="Tier" value={detail.member.tier_name} />
              <StatCard label="Available points" value={fmt(detail.member.available_points)} />
              <StatCard label="Lifetime points" value={fmt(detail.member.lifetime_points)} />
            </Box>

            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Tier progress ({detail.tier_progress.metric})
              </Typography>
              <LinearProgress
                variant="determinate"
                value={Math.min(100, detail.tier_progress.progress_percent)}
                sx={{ height: 10, borderRadius: 1, mb: 0.5 }}
              />
              <Typography variant="caption" color="text.secondary">
                {detail.tier_progress.next_tier_name
                  ? `${fmt(detail.tier_progress.remaining_to_next_tier ?? 0)} to ${detail.tier_progress.next_tier_name}`
                  : 'Highest tier reached'}
              </Typography>
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Manual points adjustment
              </Typography>
              {adjustError && (
                <Alert severity="error" sx={{ mb: 1 }}>
                  {adjustError}
                </Alert>
              )}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="flex-start">
                <TextField
                  label="Points (+/-)"
                  type="number"
                  size="small"
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                  sx={{ width: 140 }}
                />
                <TextField
                  label="Reason"
                  size="small"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  fullWidth
                />
                <Button variant="contained" onClick={handleAdjust} disabled={adjust.isPending}>
                  Apply
                </Button>
              </Stack>
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Recent activity
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Date</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell align="right">Points</TableCell>
                      <TableCell align="right">Balance</TableCell>
                      <TableCell>Description</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {detail.recent_activity.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} align="center">
                          No activity yet
                        </TableCell>
                      </TableRow>
                    ) : (
                      detail.recent_activity.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell>{fmtDateTime(t.created_at)}</TableCell>
                          <TableCell>{t.transaction_type}</TableCell>
                          <TableCell align="right" sx={{ color: t.points_delta < 0 ? 'error.main' : 'success.main' }}>
                            {t.points_delta > 0 ? `+${fmt(t.points_delta)}` : fmt(t.points_delta)}
                          </TableCell>
                          <TableCell align="right">{fmt(t.balance_after)}</TableCell>
                          <TableCell>{t.description ?? '—'}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

const MembersTab: React.FC = () => {
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
          label="Search name, email or member #"
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ flex: 1 }}
        />
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Status</InputLabel>
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as '' | LoyaltyMemberStatus)}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="closed">Closed</MenuItem>
          </Select>
        </FormControl>
      </Stack>

      {membersQuery.isLoading ? (
        <Loading />
      ) : membersQuery.error ? (
        <Alert severity="error">{errMessage(membersQuery.error, 'Failed to load members')}</Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Member #</TableCell>
                <TableCell>Guest</TableCell>
                <TableCell>Tier</TableCell>
                <TableCell align="right">Available</TableCell>
                <TableCell align="right">Lifetime</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Enrolled</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {members.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center">
                    No members found
                  </TableCell>
                </TableRow>
              ) : (
                members.map((m) => (
                  <TableRow key={m.id} hover sx={{ cursor: 'pointer' }} onClick={() => setSelected(m.id)}>
                    <TableCell>{m.member_number}</TableCell>
                    <TableCell>
                      <Typography variant="body2">{m.guest_name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {m.guest_email ?? m.guest_phone ?? ''}
                      </Typography>
                    </TableCell>
                    <TableCell>{m.tier_name}</TableCell>
                    <TableCell align="right">{fmt(m.available_points)}</TableCell>
                    <TableCell align="right">{fmt(m.lifetime_points)}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={m.status}
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
      setError('Name must be at least 2 characters');
      return;
    }
    if (form.category.trim().length < 2) {
      setError('Category is required');
      return;
    }
    if (!form.points_cost || form.points_cost < 1) {
      setError('Points cost must be at least 1');
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
      setError(errMessage(e, 'Failed to save reward'));
    }
  };

  const busy = create.isPending || update.isPending;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{reward ? 'Edit reward' : 'New reward'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} fullWidth />
          <TextField
            label="Description"
            value={form.description ?? ''}
            onChange={(e) => set('description', e.target.value)}
            fullWidth
            multiline
            minRows={2}
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="Category"
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
              fullWidth
            />
            <TextField
              label="Points cost"
              type="number"
              value={form.points_cost}
              onChange={(e) => set('points_cost', parseInt(e.target.value, 10) || 0)}
              fullWidth
            />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField
              label="Inventory (optional)"
              type="number"
              value={form.inventory_count ?? ''}
              onChange={(e) => set('inventory_count', e.target.value === '' ? null : parseInt(e.target.value, 10))}
              fullWidth
            />
            <TextField
              label="Min tier id (optional)"
              type="number"
              value={form.minimum_tier_id ?? ''}
              onChange={(e) => set('minimum_tier_id', e.target.value === '' ? null : parseInt(e.target.value, 10))}
              fullWidth
            />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField
              label="Valid from"
              type="date"
              value={form.valid_from ?? ''}
              onChange={(e) => set('valid_from', e.target.value || null)}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="Valid to"
              type="date"
              value={form.valid_to ?? ''}
              onChange={(e) => set('valid_to', e.target.value || null)}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Stack>
          <TextField
            label="Terms & conditions"
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
              label="Requires approval"
            />
            <FormControlLabel
              control={<Switch checked={!!form.is_active} onChange={(e) => set('is_active', e.target.checked)} />}
              label="Active"
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={busy}>
          {reward ? 'Save' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const RewardsTab: React.FC = () => {
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
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <FormControlLabel
          control={<Switch checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />}
          label="Show inactive"
        />
        <Button variant="contained" onClick={openNew}>
          New reward
        </Button>
      </Stack>

      {rewardsQuery.isLoading ? (
        <Loading />
      ) : rewardsQuery.error ? (
        <Alert severity="error">{errMessage(rewardsQuery.error, 'Failed to load rewards')}</Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Category</TableCell>
                <TableCell align="right">Points</TableCell>
                <TableCell>Min tier</TableCell>
                <TableCell>Approval</TableCell>
                <TableCell align="right">Inventory</TableCell>
                <TableCell>Active</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rewards.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center">
                    No rewards configured
                  </TableCell>
                </TableRow>
              ) : (
                rewards.map((r) => (
                  <TableRow key={r.id} hover sx={{ cursor: 'pointer' }} onClick={() => openEdit(r)}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell>{r.category}</TableCell>
                    <TableCell align="right">{fmt(r.points_cost)}</TableCell>
                    <TableCell>{r.minimum_tier_name ?? '—'}</TableCell>
                    <TableCell>{r.requires_approval ? 'Yes' : 'No'}</TableCell>
                    <TableCell align="right">{r.inventory_count != null ? fmt(r.inventory_count) : '∞'}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={r.is_active ? 'active' : 'inactive'}
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
      setActionError(errMessage(e, 'Failed to approve redemption'));
    }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    if (rejectReason.trim().length < 5) {
      setActionError('Rejection reason must be at least 5 characters');
      return;
    }
    setActionError('');
    try {
      await reject.mutateAsync({ id: rejectTarget.id, input: { reason: rejectReason.trim() } });
      setRejectTarget(null);
      setRejectReason('');
    } catch (e) {
      setActionError(errMessage(e, 'Failed to reject redemption'));
    }
  };

  return (
    <Stack spacing={2}>
      <FormControl size="small" sx={{ minWidth: 180 }}>
        <InputLabel>Status</InputLabel>
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as '' | LoyaltyRedemptionStatus)}>
          <MenuItem value="">All</MenuItem>
          <MenuItem value="pending">Pending</MenuItem>
          <MenuItem value="approved">Approved</MenuItem>
          <MenuItem value="rejected">Rejected</MenuItem>
        </Select>
      </FormControl>

      {actionError && <Alert severity="error">{actionError}</Alert>}

      {redemptionsQuery.isLoading ? (
        <Loading />
      ) : redemptionsQuery.error ? (
        <Alert severity="error">{errMessage(redemptionsQuery.error, 'Failed to load redemptions')}</Alert>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Requested</TableCell>
                <TableCell>Member</TableCell>
                <TableCell>Reward</TableCell>
                <TableCell align="right">Points</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {redemptions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    No redemptions
                  </TableCell>
                </TableRow>
              ) : (
                redemptions.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{fmtDateTime(r.requested_at)}</TableCell>
                    <TableCell>
                      <Typography variant="body2">{r.guest_name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {r.member_number}
                      </Typography>
                    </TableCell>
                    <TableCell>{r.reward_name}</TableCell>
                    <TableCell align="right">{fmt(r.points_spent)}</TableCell>
                    <TableCell>
                      <Tooltip title={r.rejection_reason ?? ''} disableHoverListener={!r.rejection_reason}>
                        <Chip size="small" label={r.status} color={REDEMPTION_STATUS_COLOR[r.status]} variant="outlined" />
                      </Tooltip>
                    </TableCell>
                    <TableCell align="right">
                      {r.status === 'pending' && (
                        <Stack direction="row" spacing={1} justifyContent="flex-end">
                          <Button
                            size="small"
                            color="success"
                            variant="outlined"
                            disabled={approve.isPending}
                            onClick={() => handleApprove(r.id)}
                          >
                            Approve
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
                            Reject
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
        <DialogTitle>Reject redemption</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {rejectTarget?.guest_name} — {rejectTarget?.reward_name}
          </Typography>
          <TextField
            label="Reason"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            fullWidth
            multiline
            minRows={2}
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectTarget(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleReject} disabled={reject.isPending}>
            Reject
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
  if (rulesQuery.error) return <Alert severity="error">{errMessage(rulesQuery.error, 'Failed to load rules')}</Alert>;
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
      setError(errMessage(e, 'Failed to save rules'));
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 3, maxWidth: 560 }}>
      <Stack spacing={2}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          Program rules
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {saved && <Alert severity="success">Rules saved</Alert>}

        <TextField
          label="Points per currency unit"
          type="number"
          value={form.points_per_currency_unit}
          onChange={(e) => set('points_per_currency_unit', parseFloat(e.target.value) || 0)}
        />
        <FormControl fullWidth>
          <InputLabel>Tier qualification metric</InputLabel>
          <Select
            label="Tier qualification metric"
            value={form.tier_qualification_metric}
            onChange={(e) => set('tier_qualification_metric', e.target.value as TierQualificationMetric)}
          >
            <MenuItem value="points">Points</MenuItem>
            <MenuItem value="nights">Nights</MenuItem>
            <MenuItem value="spend">Spend</MenuItem>
          </Select>
        </FormControl>
        <TextField
          label="Point expiry (months, blank = never)"
          type="number"
          value={form.point_expiry_months ?? ''}
          onChange={(e) => set('point_expiry_months', e.target.value === '' ? null : parseInt(e.target.value, 10))}
        />
        <TextField
          label="Minimum eligible amount"
          type="number"
          value={form.min_eligible_amount}
          onChange={(e) => set('min_eligible_amount', parseFloat(e.target.value) || 0)}
          helperText={`Stays under ${fmtMoney(form.min_eligible_amount)} earn no points`}
        />
        <FormControlLabel
          control={<Switch checked={form.earning_enabled} onChange={(e) => set('earning_enabled', e.target.checked)} />}
          label="Earning enabled"
        />
        <FormControlLabel
          control={
            <Switch
              checked={form.redemption_approval_required}
              onChange={(e) => set('redemption_approval_required', e.target.checked)}
            />
          }
          label="Redemptions require approval"
        />
        <Box>
          <Button variant="contained" onClick={handleSave} disabled={updateRules.isPending}>
            Save rules
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
};

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

const Loading: React.FC = () => (
  <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
    <CircularProgress />
  </Box>
);

// ---------------------------------------------------------------------------
// Portal shell
// ---------------------------------------------------------------------------

const LoyaltyPortal: React.FC = () => {
  const [tab, setTab] = useState(0);

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h4" sx={{ fontWeight: 600 }}>
          Loyalty
        </Typography>
        <Tooltip title="Refresh">
          <Button startIcon={<RefreshIcon />} onClick={() => window.location.reload()} size="small">
            Refresh
          </Button>
        </Tooltip>
      </Stack>

      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto">
          <Tab label="Overview" />
          <Tab label="Members" />
          <Tab label="Rewards" />
          <Tab label="Redemptions" />
          <Tab label="Rules" />
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
