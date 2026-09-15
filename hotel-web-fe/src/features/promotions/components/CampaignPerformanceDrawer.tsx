import CloseIcon from "@mui/icons-material/Close";
import {
  Alert,
  Box,
  Chip,
  Divider,
  Drawer,
  IconButton,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { TableScroll } from "../../../components/data-table/TableScroll";
import { getQueryErrorMessage } from "../../../api/queryConfig";
import { useTranslation } from "../../../i18n";
import { useCampaignPerformance } from "../hooks/usePromotionAdmin";
import type { Promotion } from "../types";
import { formatCurrencyAmount } from "../utils";

interface CampaignPerformanceDrawerProps {
  promotion: Promotion | null;
  open: boolean;
  onClose: () => void;
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Box>
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        {label}
      </Typography>
      <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
        {value}
      </Typography>
      {hint ? (
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {hint}
        </Typography>
      ) : null}
    </Box>
  );
}

/** Per-campaign funnel and redemption economics — every figure comes from
 *  voucher and voucher_redemption rows, so a campaign with no activity shows
 *  real zeroes rather than fabricated reach metrics. */
export function CampaignPerformanceDrawer({
  promotion,
  open,
  onClose,
}: CampaignPerformanceDrawerProps) {
  const { t } = useTranslation("promotions");
  const query = useCampaignPerformance(promotion?.id ?? null, open);
  const performance = query.data;
  const currency = performance?.currency ?? promotion?.currency ?? "USD";
  const money = (amount: number) => formatCurrencyAmount(amount, currency);

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: "100%", sm: 420 } } } }}
    >
      <Stack
        direction="row"
        sx={{
          alignItems: "center",
          justifyContent: "space-between",
          px: 2,
          py: 1.5,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }} noWrap>
            {t("performance.title")}
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }} noWrap>
            {promotion?.name}
          </Typography>
        </Box>
        <IconButton onClick={onClose} aria-label={t("performance.closeAria")}>
          <CloseIcon />
        </IconButton>
      </Stack>
      <Divider />
      <Box sx={{ px: 2, py: 2, overflowY: "auto" }}>
        {query.isLoading ? (
          <Stack spacing={1.5}>
            <Skeleton variant="rounded" height={88} />
            <Skeleton variant="rounded" height={120} />
            <Skeleton variant="rounded" height={120} />
          </Stack>
        ) : query.error ? (
          <Alert severity="error">
            {getQueryErrorMessage(
              query.error,
              t("performance.loadFailed"),
            )}
          </Alert>
        ) : performance ? (
          <Stack spacing={2.5}>
            <Box>
              <Typography
                variant="subtitle2"
                sx={{ fontWeight: 700, mb: 1 }}
              >
                {t("performance.funnel")}
              </Typography>
              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                sx={{ flexWrap: "wrap" }}
              >
                <Chip size="small" label={t("performance.chipIssued", { count: performance.vouchers.total })} />
                <Chip
                  size="small"
                  variant="outlined"
                  label={t("performance.chipGuestClaims", { count: performance.vouchers.guest_claims })}
                />
                <Chip
                  size="small"
                  variant="outlined"
                  label={t("performance.chipAdminIssued", { count: performance.vouchers.admin_issues })}
                />
                <Chip
                  size="small"
                  variant="outlined"
                  label={t("performance.chipAvailable", { count: performance.vouchers.available })}
                />
                <Chip
                  size="small"
                  variant="outlined"
                  label={t("performance.chipRedeemed", { count: performance.vouchers.redeemed })}
                />
                {performance.vouchers.revoked > 0 ? (
                  <Chip
                    size="small"
                    variant="outlined"
                    color="error"
                    label={t("performance.chipRevoked", { count: performance.vouchers.revoked })}
                  />
                ) : null}
                {performance.vouchers.expired > 0 ? (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={t("performance.chipExpired", { count: performance.vouchers.expired })}
                  />
                ) : null}
              </Stack>
            </Box>

            <Box>
              <Typography
                variant="subtitle2"
                sx={{ fontWeight: 700, mb: 1 }}
              >
                {t("performance.redemptions")}
              </Typography>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 1.5,
                }}
              >
                <Metric
                  label={t("performance.applied")}
                  value={String(performance.redemptions.applied)}
                  hint={
                    performance.redemptions.reversed > 0
                      ? t("performance.reversedHint", { count: performance.redemptions.reversed })
                      : undefined
                  }
                />
                <Metric
                  label={t("performance.conversion")}
                  value={
                    performance.redemptions.conversion_rate != null
                      ? `${Math.round(performance.redemptions.conversion_rate * 100)}%`
                      : "—"
                  }
                  hint={t("performance.conversionHint")}
                />
                <Metric
                  label={t("performance.grossBooked")}
                  value={money(performance.redemptions.gross_subtotal)}
                />
                <Metric
                  label={t("performance.discountGiven")}
                  value={money(performance.redemptions.discount_amount)}
                />
                <Metric
                  label={t("performance.netRevenue")}
                  value={money(performance.redemptions.net_total)}
                />
                <Metric
                  label={t("performance.bookingsGuests")}
                  value={`${performance.redemptions.bookings} / ${performance.redemptions.guests}`}
                />
              </Box>
            </Box>

            <Box>
              <Typography
                variant="subtitle2"
                sx={{ fontWeight: 700, mb: 1 }}
              >
                {t("performance.stayNights")}
              </Typography>
              <Typography variant="body2">
                {t("performance.stayNightsLine", {
                  count: performance.per_night.nights,
                  discount: money(performance.per_night.discount_amount),
                  gross: money(performance.per_night.gross_amount),
                })}
              </Typography>
            </Box>

            <Box>
              <Typography
                variant="subtitle2"
                sx={{ fontWeight: 700, mb: 1 }}
              >
                {t("performance.channelMix")}
              </Typography>
              {performance.channel_mix.length === 0 ? (
                <Typography
                  variant="body2"
                  sx={{ color: "text.secondary" }}
                >
                  {t("performance.noRedemptions")}
                </Typography>
              ) : (
                <TableScroll>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t("performance.colChannel")}</TableCell>
                        <TableCell align="right">{t("performance.colRedemptions")}</TableCell>
                        <TableCell align="right">{t("performance.colNetRevenue")}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {performance.channel_mix.map((row, index) => (
                        <TableRow key={row.channel_id ?? index}>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {row.name}
                            </Typography>
                            {row.channel_type ? (
                              <Typography
                                variant="caption"
                                sx={{ color: "text.secondary" }}
                              >
                                {row.channel_type}
                              </Typography>
                            ) : null}
                          </TableCell>
                          <TableCell align="right">{row.redemptions}</TableCell>
                          <TableCell align="right">
                            {money(row.net_total)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableScroll>
              )}
            </Box>
          </Stack>
        ) : null}
      </Box>
    </Drawer>
  );
}
