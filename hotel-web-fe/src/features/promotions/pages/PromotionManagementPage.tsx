import AddIcon from "@mui/icons-material/Add";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import CloseIcon from "@mui/icons-material/Close";
import ConfirmationNumberOutlinedIcon from "@mui/icons-material/ConfirmationNumberOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import { useDeferredValue, useMemo, useState } from "react";
import { getQueryErrorMessage } from "../../../api/queryConfig";
import { useAuth } from "../../../auth/AuthContext";
import { emitApiNotification } from "../../../utils/apiNotifications";
import { statusLabel, useTranslation } from "../../../i18n";
import {
  useAdminPromotions,
  useAdminVouchers,
  useCreatePromotion,
  useIssueVoucher,
  usePromotionTransition,
  useRevokeVoucher,
  useUpdatePromotion,
  useVoucherSummary,
} from "../hooks/usePromotionAdmin";
import type {
  Promotion,
  PromotionInput,
  PromotionLifecycle,
  PromotionLifecycleAction,
  VoucherIssueInput,
  VoucherStatusFilter,
} from "../types";
import { formatCurrencyAmount } from "../utils";
import { CampaignPerformanceDrawer } from "../components/CampaignPerformanceDrawer";
import { CancelCampaignDialog } from "../components/CancelCampaignDialog";
import { PromotionAdminTable } from "../components/PromotionAdminTable";
import { PromotionEditorDialog } from "../components/PromotionEditorDialog";
import { VoucherAdminTable } from "../components/VoucherAdminTable";
import { VoucherDetailsDrawer } from "../components/VoucherDetailsDrawer";
import { VoucherIssueDialog } from "../components/VoucherIssueDialog";
import { useConfirm } from "../../../components/common/ConfirmProvider";
import PageHeader from "../../../components/common/PageHeader";
import StatStrip from "../../../components/common/StatStrip";
import type { StatStripItem } from "../../../components/common/StatStrip";

type WorkspaceTab = "campaigns" | "vouchers";

const CAMPAIGN_FILTER_VALUES: Array<PromotionLifecycle | "all"> = [
  "all",
  "draft",
  "scheduled",
  "live",
  "paused",
  "expired",
  "cancelled",
  "archived",
];

const VOUCHER_FILTER_VALUES: Array<VoucherStatusFilter | "all"> = [
  "all",
  "available",
  "expiring_soon",
  "expired",
  "redeemed",
  "revoked",
];

export default function PromotionManagementPage() {
  const { t } = useTranslation('promotions');
  const { hasPermission } = useAuth();
  const confirm = useConfirm();
  const canReadPromotions =
    hasPermission("promotions:read") || hasPermission("promotions:manage");
  const canManagePromotions = hasPermission("promotions:manage");
  // Publishing is the approval step — `promotions:approve` (implied by
  // `promotions:manage`) gates the publish action specifically.
  const canApprovePromotions = hasPermission("promotions:approve");
  const canReadVouchers =
    hasPermission("vouchers:read") || hasPermission("vouchers:manage");
  const canManageVouchers = hasPermission("vouchers:manage");

  const [tab, setTab] = useState<WorkspaceTab>("campaigns");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [promotionStatus, setPromotionStatus] = useState<
    PromotionLifecycle | "all"
  >("all");
  const [voucherStatus, setVoucherStatus] = useState<
    VoucherStatusFilter | "all"
  >("all");
  const [promotionPage, setPromotionPage] = useState(0);
  const [promotionPageSize, setPromotionPageSize] = useState(25);
  const [voucherPage, setVoucherPage] = useState(0);
  const [voucherPageSize, setVoucherPageSize] = useState(25);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedPromotion, setSelectedPromotion] = useState<Promotion | null>(
    null,
  );
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Promotion | null>(null);
  const [performanceTarget, setPerformanceTarget] = useState<Promotion | null>(
    null,
  );
  const [drawerVoucherId, setDrawerVoucherId] = useState<number | null>(null);
  const [voucherPromotionId, setVoucherPromotionId] = useState<number | null>(
    null,
  );

  const promotionParams = useMemo(
    () => ({
      page: promotionPage + 1,
      page_size: promotionPageSize,
      search: deferredSearch || undefined,
      status: promotionStatus === "all" ? undefined : promotionStatus,
    }),
    [deferredSearch, promotionPage, promotionPageSize, promotionStatus],
  );
  const voucherParams = useMemo(
    () => ({
      page: voucherPage + 1,
      page_size: voucherPageSize,
      search: deferredSearch || undefined,
      status: voucherStatus === "all" ? undefined : voucherStatus,
      promotion_id: voucherPromotionId ?? undefined,
    }),
    [
      deferredSearch,
      voucherPage,
      voucherPageSize,
      voucherStatus,
      voucherPromotionId,
    ],
  );

  const promotionsQuery = useAdminPromotions(
    promotionParams,
    canReadPromotions,
  );
  const issuePromotionOptionsQuery = useAdminPromotions(
    { page: 1, page_size: 100, status: "live" },
    canReadPromotions && tab === "vouchers",
  );
  const vouchersQuery = useAdminVouchers(voucherParams, canReadVouchers);
  const voucherSummaryQuery = useVoucherSummary(canReadVouchers);
  const createMutation = useCreatePromotion();
  const updateMutation = useUpdatePromotion();
  const transitionMutation = usePromotionTransition();
  const issueMutation = useIssueVoucher();
  const revokeMutation = useRevokeVoucher();

  const promotionMutationError =
    createMutation.error || updateMutation.error || transitionMutation.error;
  const voucherMutationError = issueMutation.error || revokeMutation.error;
  const isSavingPromotion =
    createMutation.isPending || updateMutation.isPending;

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
            emitApiNotification({
              message: t('notify.promotionUpdated'),
              severity: "success",
            });
          },
        },
      );
      return;
    }

    createMutation.mutate(input, {
      onSuccess: () => {
        setEditorOpen(false);
        emitApiNotification({
          message: t('notify.draftCreated'),
          severity: "success",
        });
      },
    });
  };

  const LIFECYCLE_PAST_TENSE: Record<PromotionLifecycleAction, string> = {
    publish: t('notify.state.published'),
    pause: t('notify.state.paused'),
    cancel: t('notify.state.cancelled'),
    archive: t('notify.state.archived'),
  };

  const transitionPromotion = async (
    promotion: Promotion,
    action: PromotionLifecycleAction,
    reason?: string,
  ) => {
    if (!canManagePromotions) return;
    if (
      action === "archive" &&
      !(await confirm({
        title: t('confirm.archiveTitle'),
        message: t('confirm.archiveMessage', { name: promotion.name }),
        confirmText: t('confirm.archiveAction'),
        severity: "warning",
      }))
    ) {
      return;
    }
    transitionMutation.mutate(
      {
        promotionId: promotion.id,
        action,
        expectedVersion: promotion.version,
        reason,
      },
      {
        onSuccess: () => {
          emitApiNotification({
            message: t('notify.campaignTransitioned', { state: LIFECYCLE_PAST_TENSE[action] }),
            severity: "success",
          });
        },
      },
    );
  };

  /** Cancellation collects a reason first — the dialog owns the confirm. */
  const cancelPromotion = (promotion: Promotion, reason?: string) => {
    setCancelTarget(null);
    void transitionPromotion(promotion, "cancel", reason);
  };

  const issueVoucher = (input: VoucherIssueInput) => {
    if (!canManageVouchers) return;
    issueMutation.mutate(input, {
      onSuccess: (voucher) => {
        setIssueDialogOpen(false);
        setDrawerVoucherId(voucher.id);
        emitApiNotification({ message: t('notify.voucherIssued'), severity: "success" });
      },
    });
  };

  const performRevoke = (voucherId: number, reason?: string) => {
    revokeMutation.mutate(
      { voucherId, input: reason ? { reason } : {} },
      {
        onSuccess: () => {
          emitApiNotification({
            message: t('notify.voucherRevoked'),
            severity: "success",
          });
        },
      },
    );
  };

  const revokeVoucher = async (voucherId: number, label: string) => {
    if (!canManageVouchers) return;
    if (
      !(await confirm({
        title: t('confirm.revokeTitle'),
        message: t('confirm.revokeMessage', { label }),
        confirmText: t('confirm.revokeAction'),
        severity: "error",
      }))
    ) {
      return;
    }
    performRevoke(voucherId, "Revoked by administrator");
  };

  /** The drawer already ran its own inline confirm — revoke directly. */
  const revokeVoucherFromDrawer = (
    voucherId: number,
    _label: string,
    reason?: string,
  ) => {
    if (!canManageVouchers) return;
    performRevoke(voucherId, reason);
  };

  const resetPageForSearch = (value: string) => {
    setSearch(value);
    if (tab === "campaigns") setPromotionPage(0);
    else setVoucherPage(0);
  };

  const availablePromotions = useMemo(
    () => issuePromotionOptionsQuery.data?.items ?? [],
    [issuePromotionOptionsQuery.data?.items],
  );
  const activeQuery = tab === "campaigns" ? promotionsQuery : vouchersQuery;
  const queryError = activeQuery.error;
  const activeTotal = activeQuery.data?.total ?? 0;
  const summary = voucherSummaryQuery.data;
  const summaryValue = (value?: number) =>
    voucherSummaryQuery.isLoading
      ? "…"
      : value != null
        ? String(value)
        : "—";
  const discountsGiven = voucherSummaryQuery.isLoading
    ? "…"
    : summary?.discount_given.length
      ? summary.discount_given
          .map((discount) =>
            formatCurrencyAmount(discount.amount, discount.currency),
          )
          .join(" · ")
      : "—";
  const statusFilterLabel = (value: string): string => {
    if (value === "all") return t('filters.all');
    if (value === "expiring_soon") return t('vouchers.expiringSoon');
    return statusLabel(t, tab === "campaigns" ? "promotion" : "voucher", value);
  };

  const applyVoucherStatus = (value: VoucherStatusFilter | "all") => {
    setVoucherStatus(value);
    setVoucherPage(0);
  };
  const viewVouchersForPromotion = (promotion: Promotion) => {
    setTab("vouchers");
    setVoucherPromotionId(promotion.id);
    setVoucherPage(0);
  };
  const voucherPromotionName = useMemo(() => {
    if (voucherPromotionId == null) return null;
    const match = [...promotionsQuery.data?.items ?? [], ...availablePromotions].find(
      (promotion) => promotion.id === voucherPromotionId,
    );
    return match?.name ?? t('vouchers.offerNumber', { id: voucherPromotionId });
  }, [voucherPromotionId, promotionsQuery.data?.items, availablePromotions, t]);
  const activeStatus = tab === "campaigns" ? promotionStatus : voucherStatus;
  const hasActiveFilters =
    search.trim().length > 0 ||
    activeStatus !== "all" ||
    (tab === "vouchers" && voucherPromotionId != null);

  const statItems: StatStripItem[] =
    tab === "vouchers"
      ? [
          {
            key: "total",
            label: t('stats.totalVouchers'),
            value: summaryValue(summary?.total),
            hint: t('stats.totalVouchersHint'),
          },
          {
            key: "available",
            label: t('stats.availableNow'),
            value: summaryValue(summary?.available),
            hint: t('stats.availableNowHint'),
            onClick: () => applyVoucherStatus("available"),
            active: voucherStatus === "available",
          },
          {
            key: "expiring",
            label: t('stats.expiringSoon'),
            value: summaryValue(summary?.expiring_soon),
            hint: t('stats.expiringSoonHint'),
            onClick: () => applyVoucherStatus("expiring_soon"),
            active: voucherStatus === "expiring_soon",
          },
          {
            key: "expired",
            label: t('stats.expired'),
            value: summaryValue(summary?.expired),
            hint: t('stats.expiredHint'),
            onClick: () => applyVoucherStatus("expired"),
            active: voucherStatus === "expired",
          },
          {
            key: "redeemed",
            label: t('stats.redeemed'),
            value: summaryValue(summary?.redeemed),
            hint: t('stats.redeemedHint', { count: summary?.redemption_count ?? 0 }),
            onClick: () => applyVoucherStatus("redeemed"),
            active: voucherStatus === "redeemed",
          },
          {
            key: "discounts",
            label: t('stats.discountsGiven'),
            value: discountsGiven,
            hint: t('stats.discountsGivenHint'),
          },
        ]
      : [
          {
            key: "campaigns",
            label: t('stats.campaigns'),
            value: promotionsQuery.isLoading
              ? "…"
              : String(promotionsQuery.data?.total ?? 0),
            hint: hasActiveFilters
              ? t('stats.campaignsFilteredHint')
              : t('stats.campaignsHint'),
          },
          {
            key: "vouchers",
            label: t('stats.vouchersIssued'),
            value: summaryValue(summary?.total),
            hint: t('stats.vouchersIssuedHint'),
          },
          {
            key: "redemptions",
            label: t('stats.redemptions'),
            value: summaryValue(summary?.redemption_count),
            hint: t('stats.redemptionsHint'),
          },
          {
            key: "discounts",
            label: t('stats.discountsGiven'),
            value: discountsGiven,
            hint: t('stats.discountsGivenHint'),
          },
        ];

  const clearFilters = () => {
    setSearch("");
    if (tab === "campaigns") {
      setPromotionStatus("all");
      setPromotionPage(0);
    } else {
      setVoucherStatus("all");
      setVoucherPromotionId(null);
      setVoucherPage(0);
    }
  };

  return (
    <Container maxWidth="xl" sx={{ py: { xs: 2, md: 3 } }}>
      <PageHeader
        kicker={t('page.kicker')}
        title={tab === "campaigns" ? t('page.campaignsTitle') : t('page.vouchersTitle')}
        subtitle={
          tab === "campaigns"
            ? t('page.campaignsSubtitle')
            : t('page.vouchersSubtitle')
        }
        sx={{ mb: 0 }}
        actions={
          <>
            {tab === "campaigns" && canManagePromotions ? (
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={openCreate}
                sx={{ whiteSpace: "nowrap" }}
              >
                {t('page.createCampaign')}
              </Button>
            ) : null}
            {tab === "vouchers" && canManageVouchers ? (
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setIssueDialogOpen(true)}
                sx={{ whiteSpace: "nowrap" }}
              >
                {t('page.issueVoucher')}
              </Button>
            ) : null}
          </>
        }
      />
      <Stack spacing={2.5} sx={{ mt: 2.5 }}>
        <StatStrip items={statItems} />

        {tab === "campaigns" && !canManagePromotions ? (
          <Alert severity="info">
            {t('page.readOnlyCampaigns')}
          </Alert>
        ) : null}
        {tab === "vouchers" && !canManageVouchers ? (
          <Alert severity="info">{t('page.readOnlyVouchers')}</Alert>
        ) : null}
        {queryError ? (
          <Alert
            severity="error"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => void activeQuery.refetch()}
                disabled={activeQuery.isFetching}
              >
                {t('common:actions.retry')}
              </Button>
            }
          >
            {getQueryErrorMessage(queryError, tab === "campaigns" ? t('page.loadCampaignsFailed') : t('page.loadVouchersFailed'))}
          </Alert>
        ) : null}
        {tab === "campaigns" && promotionMutationError ? (
          <Alert severity="error">
            {getQueryErrorMessage(
              promotionMutationError,
              t('page.updateCampaignFailed'),
            )}
          </Alert>
        ) : null}
        {tab === "vouchers" && voucherMutationError ? (
          <Alert severity="error">
            {getQueryErrorMessage(
              voucherMutationError,
              t('page.updateVoucherFailed'),
            )}
          </Alert>
        ) : null}

        <Paper
          variant="outlined"
          sx={{ overflow: "hidden", borderRadius: 2.5 }}
        >
          <Tabs
            value={tab}
            onChange={(_, value: WorkspaceTab) => {
              setTab(value);
              setSearch("");
            }}
            sx={{
              px: { xs: 0.5, sm: 1.5 },
              borderBottom: 1,
              borderColor: "divider",
            }}
          >
            <Tab
              value="campaigns"
              icon={<CampaignOutlinedIcon fontSize="small" />}
              iconPosition="start"
              label={t('page.campaignsTitle')}
            />
            {canReadVouchers ? (
              <Tab
                value="vouchers"
                icon={<ConfirmationNumberOutlinedIcon fontSize="small" />}
                iconPosition="start"
                label={t('page.vouchersTitle')}
              />
            ) : null}
          </Tabs>

          <Box
            sx={{
              p: { xs: 1.5, sm: 2 },
              bgcolor: "background.default",
              borderBottom: 1,
              borderColor: "divider",
            }}
          >
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={1.5}
              sx={{
                alignItems: { md: "center" }
              }}
            >
              <TextField
                size="small"
                placeholder={
                  tab === "campaigns"
                    ? t('filters.searchCampaigns')
                    : t('filters.searchVouchers')
                }
                value={search}
                onChange={(event) => resetPageForSearch(event.target.value)}
                aria-label={t('filters.searchAria', { area: tab === "campaigns" ? t('page.campaignsTitle') : t('page.vouchersTitle') })}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" color="action" />
                      </InputAdornment>
                    ),
                    endAdornment: search ? (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          aria-label={t('filters.clearSearch')}
                          onClick={() => resetPageForSearch("")}
                        >
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ) : undefined,
                  },
                }}
                sx={{ minWidth: { md: 320 }, flex: 1 }}
              />
              <Tooltip title={t('filters.refresh')}>
                <span>
                  <IconButton
                    onClick={() => void activeQuery.refetch()}
                    disabled={activeQuery.isFetching}
                    aria-label={t('filters.refreshAria', { area: tab === "campaigns" ? t('page.campaignsTitle') : t('page.vouchersTitle') })}
                    sx={{
                      border: 1,
                      borderColor: "divider",
                      borderRadius: 1.5,
                    }}
                  >
                    <RefreshIcon />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>

            <Stack
              direction={{ xs: "column", sm: "row" }}
              sx={{
                alignItems: { sm: "center" },
                justifyContent: "space-between",
                gap: 1,
                mt: 1.5
              }}>
              <Box sx={{ overflowX: "auto", pb: 0.25 }}>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={activeStatus}
                  onChange={(
                    _,
                    value: PromotionLifecycle | VoucherStatusFilter | "all" | null,
                  ) => {
                    if (value === null) return;
                    if (tab === "campaigns") {
                      setPromotionStatus(value as PromotionLifecycle | "all");
                      setPromotionPage(0);
                    } else {
                      applyVoucherStatus(value as VoucherStatusFilter | "all");
                    }
                  }}
                  aria-label={t('filters.statusAria', { area: tab === "campaigns" ? t('page.campaignsTitle') : t('page.vouchersTitle') })}
                  sx={{ whiteSpace: "nowrap" }}
                >
                  {(tab === "campaigns"
                    ? CAMPAIGN_FILTER_VALUES
                    : VOUCHER_FILTER_VALUES
                  ).map((value) => (
                    <ToggleButton
                      key={value}
                      value={value}
                      sx={{ px: 1.5 }}
                    >
                      {statusFilterLabel(value)}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </Box>
              <Stack direction="row" spacing={1} sx={{
                alignItems: "center"
              }}>
                {tab === "vouchers" && voucherPromotionId != null ? (
                  <Chip
                    size="small"
                    color="primary"
                    variant="outlined"
                    label={t('vouchers.offerChip', { name: voucherPromotionName ?? `#${voucherPromotionId}` })}
                    onDelete={() => {
                      setVoucherPromotionId(null);
                      setVoucherPage(0);
                    }}
                  />
                ) : null}
                <Chip
                  size="small"
                  variant="outlined"
                  label={t('filters.resultCount', { count: activeTotal })}
                />
                {hasActiveFilters ? (
                  <Button size="small" color="inherit" onClick={clearFilters}>
                    {t('filters.clearFilters')}
                  </Button>
                ) : null}
              </Stack>
            </Stack>
          </Box>

          {tab === "campaigns" ? (
            <PromotionAdminTable
              promotions={promotionsQuery.data?.items ?? []}
              total={promotionsQuery.data?.total ?? 0}
              page={promotionPage}
              pageSize={promotionPageSize}
              isLoading={promotionsQuery.isLoading}
              canManage={canManagePromotions}
              canApprove={canApprovePromotions}
              isTransitioning={transitionMutation.isPending}
              onEdit={openEdit}
              onViewVouchers={
                canReadVouchers ? viewVouchersForPromotion : undefined
              }
              onViewPerformance={setPerformanceTarget}
              onCancel={setCancelTarget}
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
              onView={(voucher) => setDrawerVoucherId(voucher.id)}
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
        errorMessage={
          issueMutation.error
            ? getQueryErrorMessage(
                issueMutation.error,
                t('page.issueVoucherFailed'),
              )
            : null
        }
        onClose={() => setIssueDialogOpen(false)}
        onIssue={issueVoucher}
      />
      <VoucherDetailsDrawer
        voucherId={drawerVoucherId}
        open={drawerVoucherId != null}
        canManage={canManageVouchers}
        isRevoking={revokeMutation.isPending}
        onClose={() => setDrawerVoucherId(null)}
        onRevoke={revokeVoucherFromDrawer}
      />
      <CancelCampaignDialog
        promotion={cancelTarget}
        isCancelling={transitionMutation.isPending}
        onClose={() => setCancelTarget(null)}
        onConfirm={cancelPromotion}
      />
      <CampaignPerformanceDrawer
        promotion={performanceTarget}
        open={performanceTarget != null}
        onClose={() => setPerformanceTarget(null)}
      />
    </Container>
  );
}
