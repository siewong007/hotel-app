import ArchiveIcon from "@mui/icons-material/Archive";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import CancelOutlinedIcon from "@mui/icons-material/CancelOutlined";
import ConfirmationNumberOutlinedIcon from "@mui/icons-material/ConfirmationNumberOutlined";
import EditIcon from "@mui/icons-material/Edit";
import InsightsOutlinedIcon from "@mui/icons-material/InsightsOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import PauseCircleOutlineIcon from "@mui/icons-material/PauseCircleOutlined";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutlined";
import PublicOutlinedIcon from "@mui/icons-material/PublicOutlined";
import {
  Box,
  Chip,
  CircularProgress,
  IconButton,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import { useTranslation } from "../../../i18n";
import { CAMPAIGN_LIFECYCLE_KEYS } from "../constants";
import type { Promotion, PromotionLifecycle, PromotionLifecycleAction } from "../types";
import { formatPromotionDate, formatPromotionDiscount } from "../utils";
import { useIsPhone } from "../../../hooks/useIsPhone";
import { MobileCardRow } from "../../../components/data-table/MobileCardRow";

interface PromotionAdminTableProps {
  promotions: Promotion[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  canManage: boolean;
  /** `promotions:approve` — publish is the approval step, so the button is
   *  hidden for manage-only operators. */
  canApprove: boolean;
  isTransitioning: boolean;
  onEdit: (promotion: Promotion) => void;
  /** Drill into the vouchers issued from this campaign. Only passed when the
   *  operator can read vouchers. */
  onViewVouchers?: (promotion: Promotion) => void;
  /** Open the campaign performance drawer. */
  onViewPerformance?: (promotion: Promotion) => void;
  /** Cancel needs a reason prompt, so it gets its own callback. */
  onCancel: (promotion: Promotion) => void;
  onTransition: (
    promotion: Promotion,
    action: PromotionLifecycleAction,
  ) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export const lifecycleColor: Record<
  PromotionLifecycle,
  "default" | "info" | "success" | "warning" | "error"
> = {
  draft: "default",
  scheduled: "info",
  live: "success",
  paused: "warning",
  expired: "default",
  cancelled: "error",
  archived: "default",
};

export function PromotionAdminTable({
  promotions,
  total,
  page,
  pageSize,
  isLoading,
  canManage,
  canApprove,
  isTransitioning,
  onEdit,
  onViewVouchers,
  onViewPerformance,
  onCancel,
  onTransition,
  onPageChange,
  onPageSizeChange,
}: PromotionAdminTableProps) {
  const { t } = useTranslation("promotions");
  const isPhone = useIsPhone();

  const rowActions = (promotion: Promotion) => (
    <>
      {onViewVouchers ? (
        <Tooltip title={t("admin.viewVouchers")}>
          <IconButton size="small" onClick={() => onViewVouchers(promotion)}>
            <ConfirmationNumberOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
      {onViewPerformance ? (
        <Tooltip title={t("admin.viewPerformance")}>
          <IconButton size="small" onClick={() => onViewPerformance(promotion)}>
            <InsightsOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
      {canManage ? (
        <>
          <Tooltip title={t("common:actions.edit")}>
            <IconButton size="small" onClick={() => onEdit(promotion)}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {canApprove &&
          (promotion.status === "draft" ||
          promotion.status === "paused") ? (
            <Tooltip title={t("admin.publish")}>
              <IconButton
                size="small"
                color="success"
                disabled={isTransitioning}
                onClick={() => onTransition(promotion, "publish")}
              >
                <PlayCircleOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}
          {promotion.status === "published" ? (
            <Tooltip title={t("admin.pause")}>
              <IconButton
                size="small"
                color="warning"
                disabled={isTransitioning}
                onClick={() => onTransition(promotion, "pause")}
              >
                <PauseCircleOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}
          {promotion.status === "draft" ||
          promotion.status === "published" ||
          promotion.status === "paused" ? (
            <Tooltip title={t("admin.cancelCampaign")}>
              <IconButton
                size="small"
                color="error"
                disabled={isTransitioning}
                onClick={() => onCancel(promotion)}
              >
                <CancelOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}
          {promotion.status !== "archived" &&
          promotion.status !== "cancelled" ? (
            <Tooltip title={t("common:actions.archive")}>
              <IconButton
                size="small"
                disabled={isTransitioning}
                onClick={() => onTransition(promotion, "archive")}
              >
                <ArchiveIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}
        </>
      ) : (
        <Typography variant="caption" sx={{
          color: "text.secondary"
        }}>
          {t("admin.readOnly")}
        </Typography>
      )}
    </>
  );

  if (isLoading) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 1.5,
          py: 9,
        }}
      >
        <CircularProgress size={28} />
        <Typography sx={{
          color: "text.secondary"
        }}>{t("admin.loading")}</Typography>
      </Box>
    );
  }

  const paginationEl = (
    <TablePagination
      component="div"
      count={total}
      page={page}
      rowsPerPage={pageSize}
      rowsPerPageOptions={[10, 25, 50]}
      onPageChange={(_, nextPage) => onPageChange(nextPage)}
      onRowsPerPageChange={(event) =>
        onPageSizeChange(Number(event.target.value))
      }
    />
  );

  if (isPhone) {
    return (
      <>
        <Box component="div">
          {promotions.map((promotion) => {
            const lifecycle: PromotionLifecycle =
              promotion.lifecycle ??
              (promotion.status === "published" ? "live" : promotion.status);
            const availabilityEnd = formatPromotionDate(promotion.claim_ends_at);
            const claimsText = promotion.claim_limit
              ? t("labels.claimedOf", {
                  claimed: promotion.claimed_count,
                  limit: promotion.claim_limit,
                })
              : t("labels.claimedCount", { count: promotion.claimed_count });
            const visibilityText = promotion.is_public
              ? t("labels.public")
              : t("labels.private");
            return (
              <Box
                key={promotion.id}
                sx={{
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  opacity:
                    promotion.status === "archived" || promotion.status === "cancelled"
                      ? 0.68
                      : 1,
                }}
              >
                <MobileCardRow
                  title={promotion.name}
                  subtitle={t("admin.subtitleKind", {
                    slug: promotion.slug,
                    kind: promotion.promotion_kind === "voucher"
                      ? t("kind.voucherOffer")
                      : t("kind.deal"),
                    discount: formatPromotionDiscount(promotion),
                  })}
                  meta={availabilityEnd
                    ? t("admin.cardMetaWithEnd", {
                        claims: claimsText,
                        date: availabilityEnd,
                        visibility: visibilityText,
                      })
                    : t("admin.cardMeta", {
                        claims: claimsText,
                        visibility: visibilityText,
                      })}
                  status={
                    <Chip
                      size="small"
                      label={CAMPAIGN_LIFECYCLE_KEYS[lifecycle] ? t(CAMPAIGN_LIFECYCLE_KEYS[lifecycle]) : lifecycle}
                      color={lifecycleColor[lifecycle] ?? "default"}
                    />
                  }
                  footer={<Stack direction="row" spacing={0.25} useFlexGap sx={{ flexWrap: 'wrap' }}>{rowActions(promotion)}</Stack>}
                />
              </Box>
            );
          })}
          {promotions.length === 0 ? (
            <Box sx={{ py: 8, textAlign: 'center' }}>
              <CampaignOutlinedIcon color="disabled" sx={{ fontSize: 44, mb: 1 }} />
              <Typography sx={{ fontWeight: 650 }}>{t("admin.noPromotions")}</Typography>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                {t("admin.noPromotionsHint")}
              </Typography>
            </Box>
          ) : null}
        </Box>
        {paginationEl}
      </>
    );
  }

  return (
    <>
      <TableContainer>
        <Table size="small" sx={{ minWidth: 920 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: "29%" }}>{t("admin.colPromotion")}</TableCell>
              <TableCell>{t("admin.colType")}</TableCell>
              <TableCell>{t("admin.colDiscount")}</TableCell>
              <TableCell>{t("admin.colStatus")}</TableCell>
              <TableCell sx={{ minWidth: 130 }}>{t("admin.colClaims")}</TableCell>
              <TableCell>{t("admin.colVisibility")}</TableCell>
              <TableCell align="right">{t("admin.colActions")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {promotions.map((promotion) => {
              const claimProgress = promotion.claim_limit
                ? Math.min(
                    100,
                    (promotion.claimed_count / promotion.claim_limit) * 100,
                  )
                : null;
              const availabilityEnd = formatPromotionDate(
                promotion.claim_ends_at,
              );
              // Public-shaped rows may lack `lifecycle`; a bare 'published'
              // status maps to 'live' (the open-window default).
              const lifecycle: PromotionLifecycle =
                promotion.lifecycle ??
                (promotion.status === "published" ? "live" : promotion.status);

              return (
                <TableRow
                  key={promotion.id}
                  hover
                  sx={{
                    opacity:
                      promotion.status === "archived" ||
                      promotion.status === "cancelled"
                        ? 0.68
                        : 1,
                  }}
                >
                  <TableCell>
                    <Typography variant="body2" sx={{
                      fontWeight: 600
                    }}>
                      {promotion.name}
                    </Typography>
                    <Stack
                      direction="row"
                      spacing={0.75}
                      sx={{
                        alignItems: "center",
                        mt: 0.5
                      }}>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={promotion.slug}
                        sx={{
                          height: 22,
                          maxWidth: 170,
                          fontFamily: "monospace",
                          "& .MuiChip-label": { px: 0.75 },
                        }}
                      />
                      {promotion.description ? (
                        <Typography
                          variant="caption"
                          noWrap
                          sx={{
                            color: "text.secondary",
                            maxWidth: 180
                          }}>
                          {promotion.description}
                        </Typography>
                      ) : null}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={
                        promotion.promotion_kind === "voucher"
                          ? t("kind.voucherOffer")
                          : t("kind.deal")
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 700,
                        color: "primary.main"
                      }}>
                      {formatPromotionDiscount(promotion)}
                    </Typography>
                    {promotion.min_nights ? (
                      <Typography variant="caption" sx={{
                        color: "text.secondary"
                      }}>
                        {t("admin.minNights", { count: promotion.min_nights })}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={
                        CAMPAIGN_LIFECYCLE_KEYS[lifecycle]
                          ? t(CAMPAIGN_LIFECYCLE_KEYS[lifecycle])
                          : lifecycle
                      }
                      color={lifecycleColor[lifecycle] ?? "default"}
                    />
                    {availabilityEnd ? (
                      <Typography
                        variant="caption"
                        sx={{
                          color: "text.secondary",
                          display: "block",
                          mt: 0.5
                        }}>
                        {t("labels.until", { date: availabilityEnd })}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Stack spacing={0.5}>
                      <Typography variant="body2" sx={{
                        fontWeight: 600
                      }}>
                        {promotion.claim_limit
                          ? t("admin.claimsOf", {
                              claimed: promotion.claimed_count,
                              limit: promotion.claim_limit,
                            })
                          : promotion.claimed_count}
                      </Typography>
                      {claimProgress !== null ? (
                        <LinearProgress
                          variant="determinate"
                          value={claimProgress}
                          aria-label={t("labels.claimLimitUsed", { percent: Math.round(claimProgress) })}
                          sx={{ height: 5, borderRadius: 99 }}
                        />
                      ) : (
                        <Typography variant="caption" sx={{
                          color: "text.secondary"
                        }}>
                          {t("labels.noTotalLimit")}
                        </Typography>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      icon={
                        promotion.is_public ? (
                          <PublicOutlinedIcon />
                        ) : (
                          <LockOutlinedIcon />
                        )
                      }
                      label={promotion.is_public ? t("labels.public") : t("labels.private")}
                      color={promotion.is_public ? "success" : "default"}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Stack
                      direction="row"
                      spacing={0.25}
                      sx={{
                        justifyContent: "flex-end",
                        alignItems: "center"
                      }}
                    >
                      {rowActions(promotion)}
                    </Stack>
                  </TableCell>
                </TableRow>
              );
            })}
            {promotions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 8 }}>
                  <CampaignOutlinedIcon
                    color="disabled"
                    sx={{ fontSize: 44, mb: 1 }}
                  />
                  <Typography sx={{
                    fontWeight: 650
                  }}>{t("admin.noPromotions")}</Typography>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    {t("admin.noPromotionsHint")}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>
      {paginationEl}
    </>
  );
}
