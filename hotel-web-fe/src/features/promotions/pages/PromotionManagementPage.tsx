import AddIcon from "@mui/icons-material/Add";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import CloseIcon from "@mui/icons-material/Close";
import ConfirmationNumberOutlinedIcon from "@mui/icons-material/ConfirmationNumberOutlined";
import LocalActivityOutlinedIcon from "@mui/icons-material/LocalActivityOutlined";
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
  Typography,
} from "@mui/material";
import { useDeferredValue, useMemo, useState } from "react";
import { getQueryErrorMessage } from "../../../api/queryConfig";
import { useAuth } from "../../../auth/AuthContext";
import { emitApiNotification } from "../../../utils/apiNotifications";
import { PROMOTION_STATUS_LABELS, VOUCHER_STATUS_LABELS } from "../constants";
import {
  useAdminPromotions,
  useAdminVouchers,
  useCreatePromotion,
  useIssueVoucher,
  usePromotionTransition,
  useRevokeVoucher,
  useUpdatePromotion,
} from "../hooks/usePromotionAdmin";
import type {
  Promotion,
  PromotionInput,
  PromotionLifecycleAction,
  PromotionStatus,
  VoucherIssueInput,
  VoucherStatus,
} from "../types";
import { PromotionAdminTable } from "../components/PromotionAdminTable";
import { PromotionEditorDialog } from "../components/PromotionEditorDialog";
import { VoucherAdminTable } from "../components/VoucherAdminTable";
import { VoucherIssueDialog } from "../components/VoucherIssueDialog";

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

const VOUCHER_FILTERS: Array<{ value: VoucherStatus | "all"; label: string }> =
  [
    { value: "all", label: "All" },
    ...Object.entries(VOUCHER_STATUS_LABELS).map(([value, label]) => ({
      value: value as VoucherStatus,
      label,
    })),
  ];

export default function PromotionManagementPage() {
  const { hasPermission } = useAuth();
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
  const [voucherStatus, setVoucherStatus] = useState<VoucherStatus | "all">(
    "all",
  );
  const [promotionPage, setPromotionPage] = useState(0);
  const [promotionPageSize, setPromotionPageSize] = useState(25);
  const [voucherPage, setVoucherPage] = useState(0);
  const [voucherPageSize, setVoucherPageSize] = useState(25);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedPromotion, setSelectedPromotion] = useState<Promotion | null>(
    null,
  );
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);

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
    }),
    [deferredSearch, voucherPage, voucherPageSize, voucherStatus],
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

  const transitionPromotion = (
    promotion: Promotion,
    action: PromotionLifecycleAction,
  ) => {
    if (!canManagePromotions) return;
    if (
      action === "archive" &&
      !window.confirm(
        `Archive “${promotion.name}”? It will no longer be available to guests.`,
      )
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
      onSuccess: () => {
        setIssueDialogOpen(false);
        emitApiNotification({ message: "Voucher issued", severity: "success" });
      },
    });
  };

  const revokeVoucher = (voucherId: number, label: string) => {
    if (!canManageVouchers) return;
    if (
      !window.confirm(
        `Revoke voucher ${label}? The guest will no longer be able to use it.`,
      )
    ) {
      return;
    }
    revokeMutation.mutate(
      { voucherId, input: { reason: "Revoked by administrator" } },
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

  const resetPageForSearch = (value: string) => {
    setSearch(value);
    if (tab === "promotions") setPromotionPage(0);
    else setVoucherPage(0);
  };

  const availablePromotions = issuePromotionOptionsQuery.data?.items ?? [];
  const activeQuery = tab === "promotions" ? promotionsQuery : vouchersQuery;
  const queryError = activeQuery.error;
  const promotionItems = promotionsQuery.data?.items ?? [];
  const voucherItems = vouchersQuery.data?.items ?? [];
  const activeTotal = activeQuery.data?.total ?? 0;
  const publishedOnPage = promotionItems.filter(
    (promotion) => promotion.status === "published",
  ).length;
  const claimsOnPage = promotionItems.reduce(
    (total, promotion) => total + promotion.claimed_count,
    0,
  );
  const availableVouchersOnPage = voucherItems.filter(
    (voucher) =>
      voucher.status === "available" &&
      (!voucher.expires_at ||
        new Date(voucher.expires_at).getTime() >= Date.now()),
  ).length;
  const activeStatus = tab === "promotions" ? promotionStatus : voucherStatus;
  const hasActiveFilters = search.trim().length > 0 || activeStatus !== "all";

  const clearFilters = () => {
    setSearch("");
    if (tab === "promotions") {
      setPromotionStatus("all");
      setPromotionPage(0);
    } else {
      setVoucherStatus("all");
      setVoucherPage(0);
    }
  };

  return (
    <Container maxWidth="xl" sx={{ py: { xs: 2, md: 3 } }}>
      <Stack spacing={2.5}>
        <Box
          sx={(theme) => ({
            position: "relative",
            overflow: "hidden",
            p: { xs: 2.5, md: 3.5 },
            color: "common.white",
            backgroundColor: theme.palette.primary.dark,
            backgroundImage: `linear-gradient(125deg, ${theme.palette.primary.dark} 0%, ${theme.palette.primary.main} 58%, ${theme.palette.secondary.main} 145%)`,
            border: `2px solid ${theme.palette.primary.dark}`,
            borderRadius: 2,
            boxShadow: theme.shadows[2],
            "&::after": {
              content: '""',
              position: "absolute",
              width: 240,
              height: 240,
              borderRadius: "50%",
              right: -70,
              top: -120,
              bgcolor: "rgba(255,255,255,0.09)",
            },
          })}
        >
          <Stack
            direction={{ xs: "column", md: "row" }}
            sx={{
              justifyContent: "space-between",
              alignItems: { md: "center" },
              gap: 2.5,
              position: "relative",
              zIndex: 1
            }}>
            <Stack direction="row" spacing={2} sx={{
              alignItems: "flex-start"
            }}>
              <Box
                sx={{
                  display: { xs: "none", sm: "grid" },
                  placeItems: "center",
                  width: 52,
                  height: 52,
                  borderRadius: 2.5,
                  bgcolor: "rgba(255,255,255,0.15)",
                  flexShrink: 0,
                }}
              >
                <CampaignOutlinedIcon fontSize="large" />
              </Box>
              <Box>
                <Typography variant="h4" component="h1" sx={{
                  fontWeight: 750
                }}>
                  Promotions & vouchers
                </Typography>
                <Typography
                  sx={{
                    mt: 0.5,
                    color: "rgba(255,255,255,0.78)",
                    maxWidth: 620,
                  }}
                >
                  Create compelling offers, control their availability, and
                  follow every guest claim from one workspace.
                </Typography>
              </Box>
            </Stack>
            {tab === "promotions" && canManagePromotions ? (
              <Button
                variant="contained"
                color="inherit"
                startIcon={<AddIcon />}
                onClick={openCreate}
                sx={{
                  color: "primary.main",
                  bgcolor: "common.white",
                  whiteSpace: "nowrap",
                }}
              >
                Create promotion
              </Button>
            ) : null}
            {tab === "vouchers" && canManageVouchers ? (
              <Button
                variant="contained"
                color="inherit"
                startIcon={<AddIcon />}
                onClick={() => setIssueDialogOpen(true)}
                sx={{
                  color: "primary.main",
                  bgcolor: "common.white",
                  whiteSpace: "nowrap",
                }}
              >
                Issue voucher
              </Button>
            ) : null}
          </Stack>
        </Box>

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" },
            gap: 1.5,
          }}
        >
          {[
            {
              label:
                tab === "promotions"
                  ? "Matching promotions"
                  : "Matching vouchers",
              value: activeTotal,
              detail: hasActiveFilters
                ? "Based on current filters"
                : "Across this workspace",
              icon:
                tab === "promotions" ? (
                  <CampaignOutlinedIcon />
                ) : (
                  <ConfirmationNumberOutlinedIcon />
                ),
            },
            tab === "promotions"
              ? {
                  label: "Published on this page",
                  value: publishedOnPage,
                  detail: "Currently visible to guests",
                  icon: <LocalActivityOutlinedIcon />,
                }
              : {
                  label: "Available on this page",
                  value: availableVouchersOnPage,
                  detail: "Ready for guest use",
                  icon: <LocalActivityOutlinedIcon />,
                },
            tab === "promotions"
              ? {
                  label: "Claims on this page",
                  value: claimsOnPage,
                  detail: "Guest demand at a glance",
                  icon: <ConfirmationNumberOutlinedIcon />,
                }
              : {
                  label: "Published offers",
                  value: availablePromotions.length,
                  detail: "Available for voucher issue",
                  icon: <CampaignOutlinedIcon />,
                },
          ].map((metric) => (
            <Paper
              key={metric.label}
              variant="outlined"
              sx={{ p: 2, borderRadius: 2.5 }}
            >
              <Stack direction="row" spacing={1.5} sx={{
                alignItems: "center"
              }}>
                <Box
                  sx={{
                    display: "grid",
                    placeItems: "center",
                    width: 42,
                    height: 42,
                    borderRadius: 2,
                    bgcolor: "primary.main",
                    color: "primary.contrastText",
                  }}
                >
                  {metric.icon}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    variant="h5"
                    sx={{
                      fontWeight: 750,
                      lineHeight: 1.1
                    }}>
                    {metric.value}
                  </Typography>
                  <Typography variant="body2" noWrap sx={{
                    fontWeight: 650
                  }}>
                    {metric.label}
                  </Typography>
                  <Typography variant="caption" noWrap sx={{
                    color: "text.secondary"
                  }}>
                    {metric.detail}
                  </Typography>
                </Box>
              </Stack>
            </Paper>
          ))}
        </Box>

        {tab === "promotions" && !canManagePromotions ? (
          <Alert severity="info">
            You have read-only access to promotions.
          </Alert>
        ) : null}
        {tab === "vouchers" && !canManageVouchers ? (
          <Alert severity="info">You have read-only access to vouchers.</Alert>
        ) : null}
        {queryError ? (
          <Alert severity="error">
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
                    : "Search voucher, guest, or promotion"
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
                    value: PromotionStatus | VoucherStatus | "all" | null,
                  ) => {
                    if (value === null) return;
                    if (tab === "promotions") {
                      setPromotionStatus(value as PromotionStatus | "all");
                      setPromotionPage(0);
                    } else {
                      setVoucherStatus(value as VoucherStatus | "all");
                      setVoucherPage(0);
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
