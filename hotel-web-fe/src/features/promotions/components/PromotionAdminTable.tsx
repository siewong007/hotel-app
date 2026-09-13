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
import { CAMPAIGN_LIFECYCLE_LABELS } from "../constants";
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
  const isPhone = useIsPhone();

  const rowActions = (promotion: Promotion) => (
    <>
      {onViewVouchers ? (
        <Tooltip title="View vouchers">
          <IconButton size="small" aria-label="View vouchers" onClick={() => onViewVouchers(promotion)}>
            <ConfirmationNumberOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
      {onViewPerformance ? (
        <Tooltip title="Campaign performance">
          <IconButton size="small" aria-label="Campaign performance" onClick={() => onViewPerformance(promotion)}>
            <InsightsOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}
      {canManage ? (
        <>
          <Tooltip title="Edit">
            <IconButton size="small" aria-label="Edit promotion" onClick={() => onEdit(promotion)}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {canApprove &&
          (promotion.status === "draft" ||
          promotion.status === "paused") ? (
            <Tooltip title="Publish">
              <IconButton
                size="small"
                color="success"
                aria-label="Publish promotion"
                disabled={isTransitioning}
                onClick={() => onTransition(promotion, "publish")}
              >
                <PlayCircleOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}
          {promotion.status === "published" ? (
            <Tooltip title="Pause">
              <IconButton
                size="small"
                color="warning"
                aria-label="Pause promotion"
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
            <Tooltip title="Cancel campaign">
              <IconButton
                size="small"
                color="error"
                aria-label="Cancel campaign"
                disabled={isTransitioning}
                onClick={() => onCancel(promotion)}
              >
                <CancelOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}
          {promotion.status !== "archived" &&
          promotion.status !== "cancelled" ? (
            <Tooltip title="Archive">
              <IconButton
                size="small"
                aria-label="Archive promotion"
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
          Read only
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
        }}>Loading promotions…</Typography>
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
                  subtitle={`${promotion.slug} · ${promotion.promotion_kind === "voucher" ? "Voucher offer" : "Deal"} · ${formatPromotionDiscount(promotion)}`}
                  meta={`${promotion.claimed_count}${promotion.claim_limit ? ` of ${promotion.claim_limit}` : ''} claimed${availabilityEnd ? ` · until ${availabilityEnd}` : ''}${promotion.is_public ? ' · Public' : ' · Private'}`}
                  status={
                    <Chip
                      size="small"
                      label={CAMPAIGN_LIFECYCLE_LABELS[lifecycle] ?? lifecycle}
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
              <Typography sx={{ fontWeight: 650 }}>No promotions found</Typography>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Try changing your search or status filter.
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
              <TableCell sx={{ width: "29%" }}>Promotion</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Discount</TableCell>
              <TableCell>Status</TableCell>
              <TableCell sx={{ minWidth: 130 }}>Claims</TableCell>
              <TableCell>Visibility</TableCell>
              <TableCell align="right">Actions</TableCell>
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
                          ? "Voucher offer"
                          : "Deal"
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
                        {promotion.min_nights}+ night
                        {promotion.min_nights === 1 ? "" : "s"}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={
                        CAMPAIGN_LIFECYCLE_LABELS[lifecycle] ?? lifecycle
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
                        Until {availabilityEnd}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Stack spacing={0.5}>
                      <Typography variant="body2" sx={{
                        fontWeight: 600
                      }}>
                        {promotion.claimed_count}
                        {promotion.claim_limit
                          ? ` of ${promotion.claim_limit}`
                          : ""}
                      </Typography>
                      {claimProgress !== null ? (
                        <LinearProgress
                          variant="determinate"
                          value={claimProgress}
                          aria-label={`${Math.round(claimProgress)}% of claim limit used`}
                          sx={{ height: 5, borderRadius: 99 }}
                        />
                      ) : (
                        <Typography variant="caption" sx={{
                          color: "text.secondary"
                        }}>
                          No total limit
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
                      label={promotion.is_public ? "Public" : "Private"}
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
                  }}>No promotions found</Typography>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    Try changing your search or status filter.
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
