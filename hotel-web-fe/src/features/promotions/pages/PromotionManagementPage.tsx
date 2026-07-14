import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Alert,
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
import { PromotionAdminTable } from '../components/PromotionAdminTable';
import { PromotionEditorDialog } from '../components/PromotionEditorDialog';
import { VoucherAdminTable } from '../components/VoucherAdminTable';
import { VoucherIssueDialog } from '../components/VoucherIssueDialog';

type WorkspaceTab = 'promotions' | 'vouchers';

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
            <PromotionAdminTable
              promotions={promotionsQuery.data?.items ?? []}
              total={promotionsQuery.data?.total ?? 0}
              page={promotionPage}
              pageSize={promotionPageSize}
              isLoading={promotionsQuery.isLoading}
              canManage={canManagePromotions}
              isTransitioning={transitionMutation.isPending}
              onEdit={openEdit}
              onTransition={transitionPromotion}
              onPageChange={setPromotionPage}
              onPageSizeChange={(pageSize) => {
                setPromotionPageSize(pageSize);
                setPromotionPage(0);
              }}
            />
          ) : (
            <VoucherAdminTable
              vouchers={vouchersQuery.data?.items ?? []}
              total={vouchersQuery.data?.total ?? 0}
              page={voucherPage}
              pageSize={voucherPageSize}
              isLoading={vouchersQuery.isLoading}
              canManage={canManageVouchers}
              isRevoking={revokeMutation.isPending}
              onRevoke={revokeVoucher}
              onPageChange={setVoucherPage}
              onPageSizeChange={(pageSize) => {
                setVoucherPageSize(pageSize);
                setVoucherPage(0);
              }}
            />
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
