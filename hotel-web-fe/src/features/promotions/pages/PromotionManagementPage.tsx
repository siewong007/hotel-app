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
import { PROMOTION_STATUS_LABELS } from "../constants";
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
  PromotionLifecycleAction,
  PromotionStatus,
  VoucherIssueInput,
  VoucherStatusFilter,
} from "../types";
import { formatCurrencyAmount } from "../utils";
import { PromotionAdminTable } from "../components/PromotionAdminTable";
import { PromotionEditorDialog } from "../components/PromotionEditorDialog";
import { VoucherAdminTable } from "../components/VoucherAdminTable";
import { VoucherDetailsDrawer } from "../components/VoucherDetailsDrawer";
import { VoucherIssueDialog } from "../components/VoucherIssueDialog";
import { useConfirm } from "../../../components/common/ConfirmProvider";
import PageHeader from "../../../components/common/PageHeader";
import StatStrip from "../../../components/common/StatStrip";
import type { StatStripItem } from "../../../components/common/StatStrip";

type WorkspaceTab = "promotions" | "vouchers";

const PROMOTION_FILTERS: Array<{
  value: PromotionStatus | "all";
  label: string;
}> = [
  { value: "all", label: "All" },
  ...Object.entries(PROMOTION_STATUS_LABELS).map(([value, label]) => ({
    value: value as PromotionStatus,
    label,
  })),
];

const VOUCHER_FILTERS: Array<{
  value: VoucherStatusFilter | "all";
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "available", label: "Available" },
  { value: "expiring_soon", label: "Expiring soon" },
  { value: "expired", label: "Expired" },
  { value: "redeemed", label: "Redeemed" },
  { value: "revoked", label: "Revoked" },
];

export default function PromotionManagementPage() {
  const { hasPermission } = useAuth();
  const confirm = useConfirm();
  const canReadPromotions =
    hasPermission("promotions:read") || hasPermission("promotions:manage");
  const canManagePromotions = hasPermission("promotions:manage");
  const canReadVouchers =
    hasPermission("vouchers:read") || hasPermission("vouchers:manage");
  const canManageVouchers = hasPermission("vouchers:manage");

  const [tab, setTab] = useState<WorkspaceTab>("promotions");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [promotionStatus, setPromotionStatus] = useState<
    PromotionStatus | "all"
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
    { page: 1, page_size: 100, status: "published" },
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
              message: "Promotion updated",
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
          message: "Promotion draft created",
          severity: "success",
        });
      },
    });
  };

  const transitionPromotion = async (
    promotion: Promotion,
    action: PromotionLifecycleAction,
  ) => {
    if (!canManagePromotions) return;
    if (
      action === "archive" &&
      !(await confirm({
        title: "Archive promotion",
        message: `Archive “${promotion.name}”? It will no longer be available to guests.`,
        confirmText: "Archive",
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
      },
      {
        onSuccess: () => {
          emitApiNotification({
            message: `Promotion ${action === "publish" ? "published" : `${action}d`}`,
            severity: "success",
          });
        },
      },
    );
  };

  const issueVoucher = (input: VoucherIssueInput) => {
    if (!canManageVouchers) return;
    issueMutation.mutate(input, {
      onSuccess: (voucher) => {
        setIssueDialogOpen(false);
        setDrawerVoucherId(voucher.id);
        emitApiNotification({ message: "Voucher issued", severity: "success" });
      },
    });
  };

  const performRevoke = (voucherId: number, reason?: string) => {
    revokeMutation.mutate(
      { voucherId, input: reason ? { reason } : {} },
      {
        onSuccess: () => {
          emitApiNotification({
            message: "Voucher revoked",
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
        title: "Revoke voucher",
        message: `Revoke voucher ${label}? The guest will no longer be able to use it.`,
        confirmText: "Revoke voucher",
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
    if (tab === "promotions") setPromotionPage(0);
    else setVoucherPage(0);
  };

  const availablePromotions = useMemo(
    () => issuePromotionOptionsQuery.data?.items ?? [],
    [issuePromotionOptionsQuery.data?.items],
  );
  const activeQuery = tab === "promotions" ? promotionsQuery : vouchersQuery;
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
    return match?.name ?? `Offer #${voucherPromotionId}`;
  }, [voucherPromotionId, promotionsQuery.data?.items, availablePromotions]);
  const activeStatus = tab === "promotions" ? promotionStatus : voucherStatus;
  const hasActiveFilters =
    search.trim().length > 0 ||
    activeStatus !== "all" ||
    (tab === "vouchers" && voucherPromotionId != null);

  const statItems: StatStripItem[] =
    tab === "vouchers"
      ? [
          {
            key: "total",
            label: "Total vouchers",
            value: summaryValue(summary?.total),
            hint: "Issued across all offers",
          },
          {
            key: "available",
            label: "Available now",
            value: summaryValue(summary?.available),
            hint: "Ready for guest use",
            onClick: () => applyVoucherStatus("available"),
            active: voucherStatus === "available",
          },
          {
            key: "expiring",
            label: "Expiring soon",
            value: summaryValue(summary?.expiring_soon),
            hint: "Within 7 days",
            onClick: () => applyVoucherStatus("expiring_soon"),
            active: voucherStatus === "expiring_soon",
          },
          {
            key: "expired",
            label: "Expired",
            value: summaryValue(summary?.expired),
            hint: "Past their expiry",
            onClick: () => applyVoucherStatus("expired"),
            active: voucherStatus === "expired",
          },
          {
            key: "redeemed",
            label: "Redeemed",
            value: summaryValue(summary?.redeemed),
            hint: `${summary?.redemption_count ?? 0} redemption${
              summary?.redemption_count === 1 ? "" : "s"
            }`,
            onClick: () => applyVoucherStatus("redeemed"),
            active: voucherStatus === "redeemed",
          },
          {
            key: "discounts",
            label: "Discounts given",
            value: discountsGiven,
            hint: "Across redemptions",
          },
        ]
      : [
          {
            key: "promotions",
            label: "Promotions",
            value: promotionsQuery.isLoading
              ? "…"
              : String(promotionsQuery.data?.total ?? 0),
            hint: hasActiveFilters
              ? "Matching current filters"
              : "All offers in this workspace",
          },
          {
            key: "vouchers",
            label: "Vouchers issued",
            value: summaryValue(summary?.total),
            hint: "Across all offers",
          },
          {
            key: "redemptions",
            label: "Redemptions",
            value: summaryValue(summary?.redemption_count),
            hint: "Vouchers applied to bookings",
          },
          {
            key: "discounts",
            label: "Discounts given",
            value: discountsGiven,
            hint: "Across redemptions",
          },
        ];

  const clearFilters = () => {
    setSearch("");
    if (tab === "promotions") {
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
        kicker="Guest offers"
        title={tab === "promotions" ? "Promotions" : "Vouchers"}
        subtitle={
          tab === "promotions"
            ? "Create compelling offers, control their availability, and follow every guest claim."
            : "Issue, track, and manage guest vouchers across every offer."
        }
        sx={{ mb: 0 }}
        actions={
          <>
            {tab === "promotions" && canManagePromotions ? (
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={openCreate}
                sx={{ whiteSpace: "nowrap" }}
              >
                Create promotion
              </Button>
            ) : null}
            {tab === "vouchers" && canManageVouchers ? (
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setIssueDialogOpen(true)}
                sx={{ whiteSpace: "nowrap" }}
              >
                Issue voucher
              </Button>
            ) : null}
          </>
        }
      />
      <Stack spacing={2.5} sx={{ mt: 2.5 }}>
        <StatStrip items={statItems} />

        {tab === "promotions" && !canManagePromotions ? (
          <Alert severity="info">
            You have read-only access to promotions.
          </Alert>
        ) : null}
        {tab === "vouchers" && !canManageVouchers ? (
          <Alert severity="info">You have read-only access to vouchers.</Alert>
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
                Retry
              </Button>
            }
          >
            {getQueryErrorMessage(queryError, `Unable to load ${tab}`)}
          </Alert>
        ) : null}
        {tab === "promotions" && promotionMutationError ? (
          <Alert severity="error">
            {getQueryErrorMessage(
              promotionMutationError,
              "Unable to update promotion",
            )}
          </Alert>
        ) : null}
        {tab === "vouchers" && voucherMutationError ? (
          <Alert severity="error">
            {getQueryErrorMessage(
              voucherMutationError,
              "Unable to update voucher",
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
              value="promotions"
              icon={<CampaignOutlinedIcon fontSize="small" />}
              iconPosition="start"
              label="Promotions"
            />
            {canReadVouchers ? (
              <Tab
                value="vouchers"
                icon={<ConfirmationNumberOutlinedIcon fontSize="small" />}
                iconPosition="start"
                label="Vouchers"
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
                  tab === "promotions"
                    ? "Search by name or offer code"
                    : "Search by offer name or exact voucher code"
                }
                value={search}
                onChange={(event) => resetPageForSearch(event.target.value)}
                aria-label={`Search ${tab}`}
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
                          aria-label="Clear search"
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
              <Tooltip title="Refresh results">
                <span>
                  <IconButton
                    onClick={() => void activeQuery.refetch()}
                    disabled={activeQuery.isFetching}
                    aria-label={`Refresh ${tab}`}
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
                    value: PromotionStatus | VoucherStatusFilter | "all" | null,
                  ) => {
                    if (value === null) return;
                    if (tab === "promotions") {
                      setPromotionStatus(value as PromotionStatus | "all");
                      setPromotionPage(0);
                    } else {
                      applyVoucherStatus(value as VoucherStatusFilter | "all");
                    }
                  }}
                  aria-label={`${tab} status filter`}
                  sx={{ whiteSpace: "nowrap" }}
                >
                  {(tab === "promotions"
                    ? PROMOTION_FILTERS
                    : VOUCHER_FILTERS
                  ).map((filter) => (
                    <ToggleButton
                      key={filter.value}
                      value={filter.value}
                      sx={{ px: 1.5 }}
                    >
                      {filter.label}
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
                    label={`Offer: ${voucherPromotionName ?? `#${voucherPromotionId}`}`}
                    onDelete={() => {
                      setVoucherPromotionId(null);
                      setVoucherPage(0);
                    }}
                  />
                ) : null}
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${activeTotal} result${activeTotal === 1 ? "" : "s"}`}
                />
                {hasActiveFilters ? (
                  <Button size="small" color="inherit" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : null}
              </Stack>
            </Stack>
          </Box>

          {tab === "promotions" ? (
            <PromotionAdminTable
              promotions={promotionsQuery.data?.items ?? []}
              total={promotionsQuery.data?.total ?? 0}
              page={promotionPage}
              pageSize={promotionPageSize}
              isLoading={promotionsQuery.isLoading}
              canManage={canManagePromotions}
              isTransitioning={transitionMutation.isPending}
              onEdit={openEdit}
              onViewVouchers={
                canReadVouchers ? viewVouchersForPromotion : undefined
              }
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
                "Unable to issue voucher",
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
    </Container>
  );
}
