import ArchiveIcon from "@mui/icons-material/Archive";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import EditIcon from "@mui/icons-material/Edit";
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
import { PROMOTION_STATUS_LABELS } from "../constants";
import type { Promotion, PromotionLifecycleAction } from "../types";
import { formatPromotionDate, formatPromotionDiscount } from "../utils";

interface PromotionAdminTableProps {
  promotions: Promotion[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  canManage: boolean;
  isTransitioning: boolean;
  onEdit: (promotion: Promotion) => void;
  onTransition: (
    promotion: Promotion,
    action: PromotionLifecycleAction,
  ) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

const statusColor = {
  draft: "default",
  published: "success",
  paused: "warning",
  archived: "default",
} as const;

export function PromotionAdminTable({
  promotions,
  total,
  page,
  pageSize,
  isLoading,
  canManage,
  isTransitioning,
  onEdit,
  onTransition,
  onPageChange,
  onPageSizeChange,
}: PromotionAdminTableProps) {
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

              return (
                <TableRow
                  key={promotion.id}
                  hover
                  sx={{ opacity: promotion.status === "archived" ? 0.68 : 1 }}
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
                        PROMOTION_STATUS_LABELS[promotion.status] ??
                        promotion.status
                      }
                      color={statusColor[promotion.status] ?? "default"}
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
                    {canManage ? (
                      <Stack
                        direction="row"
                        spacing={0.25}
                        sx={{
                          justifyContent: "flex-end"
                        }}
                      >
                        <Tooltip title="Edit">
                          <IconButton
                            size="small"
                            onClick={() => onEdit(promotion)}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {promotion.status === "draft" ||
                        promotion.status === "paused" ? (
                          <Tooltip title="Publish">
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
                          <Tooltip title="Pause">
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
                        {promotion.status !== "archived" ? (
                          <Tooltip title="Archive">
                            <IconButton
                              size="small"
                              disabled={isTransitioning}
                              onClick={() => onTransition(promotion, "archive")}
                            >
                              <ArchiveIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        ) : null}
                      </Stack>
                    ) : (
                      <Typography variant="caption" sx={{
                        color: "text.secondary"
                      }}>
                        Read only
                      </Typography>
                    )}
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
    </>
  );
}
