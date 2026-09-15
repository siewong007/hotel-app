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
import { useTranslation } from "../../../i18n";
import { getQueryErrorMessage } from "../../../api/queryConfig";
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
  const { t } = useTranslation('promotions');
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
            {t('perf.title')}
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }} noWrap>
            {promotion?.name}
          </Typography>
        </Box>
        <IconButton onClick={onClose} aria-label={t('perf.close')}>
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
              t('perf.loadError'),
            )}
          </Alert>
        ) : performance ? (
          <Stack spacing={2.5}>
            <Box>
              <Typography
                variant="subtitle2"
                sx={{ fontWeight: 700, mb: 1 }}
              >
                {t('perf.funnel')}
              </Typography>
              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                sx={{ flexWrap: "wrap" }}
              >
                <Chip size="small" label={t('perf.funnelIssued', { count: performance.vouchers.total })} />
                <Chip
                  size="small"
                  variant="outlined"
                  label={t('perf.funnelGuestClaims', { count: performance.vouchers.guest_claims })}
                />
                <Chip
                  size="small"
                  variant="outlined"
                  label={t('perf.funnelAdminIssued', { count: performance.vouchers.admin_issues })}
                />
                <Chip
                  size="small"
                  variant="outlined"
                  label={t('perf.funnelAvailable', { count: performance.vouchers.available })}
                />
                <Chip
                  size="small"
                  variant="outlined"
                  label={t('perf.funnelRedeemed', { count: performance.vouchers.redeemed })}
                />
                {performance.vouchers.revoked > 0 ? (
                  <Chip
                    size="small"
                    variant="outlined"
                    color="error"
                    label={t('perf.funnelRevoked', { count: performance.vouchers.revoked })}
                  />
                ) : null}
                {performance.vouchers.expired > 0 ? (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={t('perf.funnelExpired', { count: performance.vouchers.expired })}
                  />
                ) : null}
              </Stack>
            </Box>

            <Box>
              <Typography
                variant="subtitle2"
                sx={{ fontWeight: 700, mb: 1 }}
              >
                {t('perf.redemptions')}
              </Typography>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 1.5,
                }}
              >
                <Metric
                  label={t('perf.applied')}
                  value={String(performance.redemptions.applied)}
                  hint={
                    performance.redemptions.reversed > 0
                      ? t('perf.reversedHint', { count: performance.redemptions.reversed })
                      : undefined
                  }
                />
                <Metric
                  label={t('perf.conversion')}
                  value={
                    performance.redemptions.conversion_rate != null
                      ? `${Math.round(performance.redemptions.conversion_rate * 100)}%`
                      : "—"
                  }
                  hint={t('perf.conversionHint')}
                />
                <Metric
                  label={t('perf.grossBooked')}
                  value={money(performance.redemptions.gross_subtotal)}
                />
                <Metric
                  label={t('perf.discountGiven')}
                  value={money(performance.redemptions.discount_amount)}
                />
                <Metric
                  label={t('perf.netRevenue')}
                  value={money(performance.redemptions.net_total)}
                />
                <Metric
                  label={t('perf.bookingsGuests')}
                  value={t('perf.bookingsGuestsValue', {
                    bookings: performance.redemptions.bookings,
                    guests: performance.redemptions.guests,
                  })}
                />
              </Box>
            </Box>

            <Box>
              <Typography
                variant="subtitle2"
                sx={{ fontWeight: 700, mb: 1 }}
              >
                {t('perf.stayNights')}
              </Typography>
              <Typography variant="body2">
                {t('perf.stayNightsLine', {
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
                {t('perf.channelMix')}
              </Typography>
              {performance.channel_mix.length === 0 ? (
                <Typography
                  variant="body2"
                  sx={{ color: "text.secondary" }}
                >
                  {t('perf.noRedemptions')}
                </Typography>
              ) : (
                <TableScroll>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('perf.colChannel')}</TableCell>
                        <TableCell align="right">{t('perf.redemptions')}</TableCell>
                        <TableCell align="right">{t('perf.netRevenue')}</TableCell>
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
