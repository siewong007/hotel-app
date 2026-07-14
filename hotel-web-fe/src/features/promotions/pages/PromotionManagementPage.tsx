import AddIcon from '@mui/icons-material/Add';
import ArchiveIcon from '@mui/icons-material/Archive';
import BlockIcon from '@mui/icons-material/Block';
import EditIcon from '@mui/icons-material/Edit';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useDeferredValue, useMemo, useState } from 'react';
import { getQueryErrorMessage } from '../../../api/queryConfig';
import { useAuth } from '../../../auth/AuthContext';
import { emitApiNotification } from '../../../utils/apiNotifications';
import { PROMOTION_STATUS_LABELS, VOUCHER_STATUS_LABELS } from '../constants';
import {
  useAdminPromotions,
  useAdminVouchers,
  useCreatePromotion,
  useIssueVoucher,
  usePromotionTransition,
  useRevokeVoucher,
  useUpdatePromotion,
} from '../hooks/usePromotionAdmin';
import type {
  Promotion,
  PromotionInput,
  PromotionLifecycleAction,
  PromotionStatus,
  VoucherIssueInput,
  VoucherStatus,
} from '../types';
import { formatPromotionDate, formatPromotionDiscount } from '../utils';
import { PromotionEditorDialog } from '../components/PromotionEditorDialog';
import { VoucherIssueDialog } from '../components/VoucherIssueDialog';

type WorkspaceTab = 'promotions' | 'vouchers';

const promotionStatusColor = {
  draft: 'default',
  published: 'success',
  paused: 'warning',
  archived: 'default',
} as const;

const voucherStatusColor = {
  available: 'success',
  redeemed: 'default',
  revoked: 'error',
} as const;

function LoadingTable() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
      <CircularProgress />
    </Box>
  );
}

export default function PromotionManagementPage() {
  const { hasPermission } = useAuth();
  const canReadPromotions =
    hasPermission('promotions:read') || hasPermission('promotions:manage');
  const canManagePromotions = hasPermission('promotions:manage');
  const canReadVouchers =
    hasPermission('vouchers:read') || hasPermission('vouchers:manage');
  const canManageVouchers = hasPermission('vouchers:manage');

  const [tab, setTab] = useState<WorkspaceTab>('promotions');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const [promotionStatus, setPromotionStatus] = useState<PromotionStatus | 'all'>('all');
  const [voucherStatus, setVoucherStatus] = useState<VoucherStatus | 'all'>('all');
  const [promotionPage, setPromotionPage] = useState(0);
  const [promotionPageSize, setPromotionPageSize] = useState(25);
  const [voucherPage, setVoucherPage] = useState(0);
  const [voucherPageSize, setVoucherPageSize] = useState(25);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedPromotion, setSelectedPromotion] = useState<Promotion | null>(null);
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);

  const promotionParams = useMemo(
    () => ({
      page: promotionPage + 1,
      page_size: promotionPageSize,
      search: deferredSearch || undefined,
      status: promotionStatus === 'all' ? undefined : promotionStatus,
    }),
    [deferredSearch, promotionPage, promotionPageSize, promotionStatus]
  );
  const voucherParams = useMemo(
    () => ({
      page: voucherPage + 1,
      page_size: voucherPageSize,
      search: deferredSearch || undefined,
      status: voucherStatus === 'all' ? undefined : voucherStatus,
    }),
    [deferredSearch, voucherPage, voucherPageSize, voucherStatus]
  );

  const promotionsQuery = useAdminPromotions(promotionParams, canReadPromotions);
  const issuePromotionOptionsQuery = useAdminPromotions(
    { page: 1, page_size: 100, status: 'published' },
    canReadPromotions && tab === 'vouchers'
  );
  const vouchersQuery = useAdminVouchers(voucherParams, canReadVouchers);
  const createMutation = useCreatePromotion();
  const updateMutation = useUpdatePromotion();
  const transitionMutation = usePromotionTransition();
  const issueMutation = useIssueVoucher();
  const revokeMutation = useRevokeVoucher();

  const promotionMutationError =
    createMutation.error || updateMutation.error || transitionMutation.error;
  const voucherMutationError = issueMutation.error || revokeMutation.error;
  const isSavingPromotion = createMutation.isPending || updateMutation.isPending;

  const openCreate = () => {
    setSelectedPromotion(null);
    setEditorOpen(true);
  };

  const openEdit = (promotion: Promotion) => {
    setSelectedPromotion(promotion);
    setEditorOpen(true);
  };

  const savePromotion = (input: PromotionInput) => {
    if (!canManagePromotions) return;
    if (selectedPromotion) {
      updateMutation.mutate(
        { promotionId: selectedPromotion.id, input },
        {
          onSuccess: () => {
            setEditorOpen(false);
            emitApiNotification({ message: 'Promotion updated', severity: 'success' });
          },
        }
      );
      return;
    }

    createMutation.mutate(input, {
      onSuccess: () => {
        setEditorOpen(false);
        emitApiNotification({ message: 'Promotion draft created', severity: 'success' });
      },
    });
  };

  const transitionPromotion = (
    promotion: Promotion,
    action: PromotionLifecycleAction
  ) => {
    if (!canManagePromotions) return;
    if (
      action === 'archive' &&
      !window.confirm(`Archive “${promotion.name}”? It will no longer be available to guests.`)
    ) {
      return;
    }
    transitionMutation.mutate(
      {
        promotionId: promotion.id,
        action,
        expectedVersion: promotion.version,
      },
      {
        onSuccess: () => {
          emitApiNotification({
            message: `Promotion ${action === 'publish' ? 'published' : `${action}d`}`,
            severity: 'success',
          });
        },
      }
    );
  };

  const issueVoucher = (input: VoucherIssueInput) => {
    if (!canManageVouchers) return;
    issueMutation.mutate(input, {
      onSuccess: () => {
        setIssueDialogOpen(false);
        emitApiNotification({ message: 'Voucher issued', severity: 'success' });
      },
    });
  };

  const revokeVoucher = (voucherId: number, label: string) => {
    if (!canManageVouchers) return;
    if (!window.confirm(`Revoke voucher ${label}? The guest will no longer be able to use it.`)) {
      return;
    }
    revokeMutation.mutate(
      { voucherId, input: { reason: 'Revoked by administrator' } },
      {
        onSuccess: () => {
          emitApiNotification({ message: 'Voucher revoked', severity: 'success' });
        },
      }
    );
  };

  const resetPageForSearch = (value: string) => {
    setSearch(value);
    if (tab === 'promotions') setPromotionPage(0);
    else setVoucherPage(0);
  };

  const availablePromotions = issuePromotionOptionsQuery.data?.items ?? [];
  const activeQuery = tab === 'promotions' ? promotionsQuery : vouchersQuery;
  const queryError = activeQuery.error;

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Stack spacing={2}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ sm: 'center' }}
          gap={1}
        >
          <Box>
            <Typography variant="h4" component="h1">
              Promotions & vouchers
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Publish guest deals, monitor claims, and manage issued voucher codes.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Tooltip title="Refresh">
              <IconButton onClick={() => void activeQuery.refetch()} disabled={activeQuery.isFetching}>
                <RefreshIcon />
              </IconButton>
            </Tooltip>
            {tab === 'promotions' && canManagePromotions ? (
              <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
                New promotion
              </Button>
            ) : null}
            {tab === 'vouchers' && canManageVouchers ? (
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setIssueDialogOpen(true)}
              >
                Issue voucher
              </Button>
            ) : null}
          </Stack>
        </Stack>

        {tab === 'promotions' && !canManagePromotions ? (
          <Alert severity="info">You have read-only access to promotions.</Alert>
        ) : null}
        {tab === 'vouchers' && !canManageVouchers ? (
          <Alert severity="info">You have read-only access to vouchers.</Alert>
        ) : null}
        {queryError ? (
          <Alert severity="error">
            {getQueryErrorMessage(queryError, `Unable to load ${tab}`)}
          </Alert>
        ) : null}
        {tab === 'promotions' && promotionMutationError ? (
          <Alert severity="error">
            {getQueryErrorMessage(promotionMutationError, 'Unable to update promotion')}
          </Alert>
        ) : null}
        {tab === 'vouchers' && voucherMutationError ? (
          <Alert severity="error">
            {getQueryErrorMessage(voucherMutationError, 'Unable to update voucher')}
          </Alert>
        ) : null}

        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <Tabs
            value={tab}
            onChange={(_, value: WorkspaceTab) => {
              setTab(value);
              setSearch('');
            }}
            sx={{ px: 1, borderBottom: 1, borderColor: 'divider' }}
          >
            <Tab value="promotions" label="Promotions" />
            {canReadVouchers ? <Tab value="vouchers" label="Vouchers" /> : null}
          </Tabs>

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{ p: 2, bgcolor: 'background.default', borderBottom: 1, borderColor: 'divider' }}
          >
            <TextField
              size="small"
              label="Search"
              placeholder={tab === 'promotions' ? 'Name or offer code' : 'Voucher, guest, or promotion'}
              value={search}
              onChange={(event) => resetPageForSearch(event.target.value)}
              sx={{ minWidth: { sm: 300 }, flex: 1 }}
            />
            {tab === 'promotions' ? (
              <FormControl size="small" sx={{ minWidth: 170 }}>
                <InputLabel id="promotion-status-filter-label">Status</InputLabel>
                <Select
                  labelId="promotion-status-filter-label"
                  label="Status"
                  value={promotionStatus}
                  onChange={(event) => {
                    setPromotionStatus(event.target.value as PromotionStatus | 'all');
                    setPromotionPage(0);
                  }}
                >
                  <MenuItem value="all">All statuses</MenuItem>
                  {Object.entries(PROMOTION_STATUS_LABELS).map(([value, label]) => (
                    <MenuItem key={value} value={value}>
                      {label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : (
              <FormControl size="small" sx={{ minWidth: 170 }}>
                <InputLabel id="voucher-status-filter-label">Status</InputLabel>
                <Select
                  labelId="voucher-status-filter-label"
                  label="Status"
                  value={voucherStatus}
                  onChange={(event) => {
                    setVoucherStatus(event.target.value as VoucherStatus | 'all');
                    setVoucherPage(0);
                  }}
                >
                  <MenuItem value="all">All statuses</MenuItem>
                  {Object.entries(VOUCHER_STATUS_LABELS).map(([value, label]) => (
                    <MenuItem key={value} value={value}>
                      {label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Stack>

          {tab === 'promotions' ? (
            promotionsQuery.isLoading ? (
              <LoadingTable />
            ) : (
              <>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Promotion</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell>Discount</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Claims</TableCell>
                        <TableCell>Public</TableCell>
                        <TableCell align="right">Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(promotionsQuery.data?.items ?? []).map((promotion) => (
                        <TableRow key={promotion.id} hover>
                          <TableCell>
                            <Typography variant="body2" fontWeight={600}>
                              {promotion.name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {promotion.slug}
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ textTransform: 'capitalize' }}>
                            {promotion.promotion_kind}
                          </TableCell>
                          <TableCell>{formatPromotionDiscount(promotion)}</TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={PROMOTION_STATUS_LABELS[promotion.status] ?? promotion.status}
                              color={promotionStatusColor[promotion.status] ?? 'default'}
                            />
                          </TableCell>
                          <TableCell>
                            {promotion.claimed_count}
                            {promotion.claim_limit ? ` / ${promotion.claim_limit}` : ''}
                          </TableCell>
                          <TableCell>{promotion.is_public ? 'Yes' : 'No'}</TableCell>
                          <TableCell align="right">
                            {canManagePromotions ? (
                              <Stack direction="row" justifyContent="flex-end" spacing={0.25}>
                                <Tooltip title="Edit">
                                  <IconButton size="small" onClick={() => openEdit(promotion)}>
                                    <EditIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                                {promotion.status === 'draft' || promotion.status === 'paused' ? (
                                  <Tooltip title="Publish">
                                    <IconButton
                                      size="small"
                                      color="success"
                                      disabled={transitionMutation.isPending}
                                      onClick={() => transitionPromotion(promotion, 'publish')}
                                    >
                                      <PlayCircleOutlineIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                ) : null}
                                {promotion.status === 'published' ? (
                                  <Tooltip title="Pause">
                                    <IconButton
                                      size="small"
                                      color="warning"
                                      disabled={transitionMutation.isPending}
                                      onClick={() => transitionPromotion(promotion, 'pause')}
                                    >
                                      <PauseCircleOutlineIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                ) : null}
                                {promotion.status !== 'archived' ? (
                                  <Tooltip title="Archive">
                                    <IconButton
                                      size="small"
                                      disabled={transitionMutation.isPending}
                                      onClick={() => transitionPromotion(promotion, 'archive')}
                                    >
                                      <ArchiveIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                ) : null}
                              </Stack>
                            ) : (
                              <Typography variant="caption" color="text.secondary">
                                Read only
                              </Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      {(promotionsQuery.data?.items ?? []).length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                            No promotions found.
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </TableContainer>
                <TablePagination
                  component="div"
                  count={promotionsQuery.data?.total ?? 0}
                  page={promotionPage}
                  rowsPerPage={promotionPageSize}
                  rowsPerPageOptions={[10, 25, 50]}
                  onPageChange={(_, page) => setPromotionPage(page)}
                  onRowsPerPageChange={(event) => {
                    setPromotionPageSize(Number(event.target.value));
                    setPromotionPage(0);
                  }}
                />
              </>
            )
          ) : vouchersQuery.isLoading ? (
            <LoadingTable />
          ) : (
            <>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Voucher</TableCell>
                      <TableCell>Promotion</TableCell>
                      <TableCell>Guest</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Expires</TableCell>
                      <TableCell>Source</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(vouchersQuery.data?.items ?? []).map((voucher) => {
                      const displayCode = voucher.code_masked ?? voucher.code ?? `#${voucher.id}`;
                      const isExpired = Boolean(
                        voucher.status === 'available' &&
                          voucher.expires_at &&
                          new Date(voucher.expires_at).getTime() < Date.now()
                      );
                      return (
                        <TableRow key={voucher.id} hover>
                          <TableCell sx={{ fontFamily: 'monospace' }}>{displayCode}</TableCell>
                          <TableCell>{voucher.promotion_name}</TableCell>
                          <TableCell>{voucher.guest_name ?? voucher.guest_id ?? '—'}</TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={
                                isExpired
                                  ? 'Expired'
                                  : VOUCHER_STATUS_LABELS[voucher.status] ?? voucher.status
                              }
                              color={
                                isExpired
                                  ? 'warning'
                                  : voucherStatusColor[voucher.status] ?? 'default'
                              }
                            />
                          </TableCell>
                          <TableCell>{formatPromotionDate(voucher.expires_at) ?? 'No expiry'}</TableCell>
                          <TableCell>{voucher.source}</TableCell>
                          <TableCell align="right">
                            {canManageVouchers && voucher.status === 'available' && !isExpired ? (
                              <Tooltip title="Revoke voucher">
                                <IconButton
                                  size="small"
                                  color="error"
                                  disabled={revokeMutation.isPending}
                                  onClick={() => revokeVoucher(voucher.id, displayCode)}
                                >
                                  <BlockIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            ) : (
                              <Typography variant="caption" color="text.secondary">
                                —
                              </Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {(vouchersQuery.data?.items ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                          No vouchers found.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </TableContainer>
              <TablePagination
                component="div"
                count={vouchersQuery.data?.total ?? 0}
                page={voucherPage}
                rowsPerPage={voucherPageSize}
                rowsPerPageOptions={[10, 25, 50]}
                onPageChange={(_, page) => setVoucherPage(page)}
                onRowsPerPageChange={(event) => {
                  setVoucherPageSize(Number(event.target.value));
                  setVoucherPage(0);
                }}
              />
            </>
          )}
        </Paper>
      </Stack>

      <PromotionEditorDialog
        open={editorOpen}
        promotion={selectedPromotion}
        isSaving={isSavingPromotion}
        onClose={() => setEditorOpen(false)}
        onSave={savePromotion}
      />
      <VoucherIssueDialog
        open={issueDialogOpen}
        promotions={availablePromotions}
        isSaving={issueMutation.isPending}
        onClose={() => setIssueDialogOpen(false)}
        onIssue={issueVoucher}
      />
    </Container>
  );
}
