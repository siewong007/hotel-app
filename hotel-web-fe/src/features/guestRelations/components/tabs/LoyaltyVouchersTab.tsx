import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  type ChipProps,
  Link as MuiLink,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import {
  ConfirmationNumberOutlined as VoucherIcon,
  LoyaltyOutlined as LoyaltyIcon,
  OpenInNewOutlined as OpenIcon,
} from '@mui/icons-material';
import type { GuestLoyaltySummary, GuestVoucher } from '../../../../types';
import { Link } from '../../../../router';
import { useTranslation } from '../../../../i18n/useTranslation';
import { statusLabel } from '../../../../i18n/statusLabel';
import { formatHotelDate, formatHotelDateTime } from '../../../../utils/date';
import { getQueryErrorMessage } from '../../../../api/queryConfig';
import { ProfileDetailRow, ProfileMetric } from '../../../guests/components/GuestProfileParts';
import { useGuestLoyalty, useGuestVouchers } from '../../hooks/useGuestRelationsQueries';

const SectionCard: React.FC<{ title: React.ReactNode; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <Paper variant="outlined" sx={{ p: 2 }}>
    <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1.5 }}>
      {title}
    </Typography>
    {children}
  </Paper>
);

const SectionLink: React.FC<{ to: string; children: React.ReactNode }> = ({ to, children }) => (
  <MuiLink
    component={Link}
    to={to}
    underline="hover"
    sx={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 0.5,
      fontSize: 12,
      fontWeight: 600,
      whiteSpace: 'nowrap',
    }}
  >
    {children}
    <OpenIcon sx={{ fontSize: 13 }} />
  </MuiLink>
);

const LOYALTY_STATUS_COLORS: Record<string, ChipProps['color']> = {
  active: 'success',
  suspended: 'warning',
  closed: 'default',
};

const loyaltyStatusColor = (status: string): ChipProps['color'] =>
  LOYALTY_STATUS_COLORS[status] ?? 'default';

const VOUCHER_STATUS_COLORS: Record<string, ChipProps['color']> = {
  available: 'success',
  redeemed: 'info',
  revoked: 'error',
  void: 'default',
  cancelled: 'default',
  expired: 'warning',
};

/** Vouchers keep `status = 'available'` after their expiry passes — the admin
 *  list treats "expired" as a derived filter over `expires_at`, so the chip
 *  applies the same rule here rather than trusting the raw column alone. */
const voucherDisplayStatus = (voucher: GuestVoucher): string =>
  voucher.status === 'available' &&
  voucher.expires_at != null &&
  new Date(voucher.expires_at).getTime() < Date.now()
    ? 'expired'
    : voucher.status;

const voucherStatusColor = (status: string): ChipProps['color'] =>
  VOUCHER_STATUS_COLORS[status] ?? 'default';

interface LoyaltyVouchersTabProps {
  guestId: number;
}

/**
 * Guest 360 "Loyalty & Vouchers" — read-only roll-ups of data owned by the
 * loyalty and promotions modules. `GET /guests/{id}/loyalty` returns `null`
 * for non-members, which renders the "Not enrolled" empty state; management
 * links hand off to `/loyalty` and `/promotions`.
 */
const LoyaltyVouchersTab: React.FC<LoyaltyVouchersTabProps> = ({ guestId }) => {
  const { t } = useTranslation('guests');
  const loyaltyQuery = useGuestLoyalty(guestId);
  const vouchersQuery = useGuestVouchers(guestId);

  const loyalty = loyaltyQuery.data ?? null;
  const vouchers = vouchersQuery.data ?? [];

  const renderLoyaltyBody = (summary: GuestLoyaltySummary) => (
    <>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
          gap: 2,
          mb: 2,
        }}
      >
        <ProfileDetailRow label={t('loyaltyTab.memberNumber')} value={summary.member_number} />
        <ProfileDetailRow
          label={t('loyaltyTab.status')}
          value={
            <Chip
              size="small"
              label={statusLabel(t, 'loyalty', summary.status)}
              color={loyaltyStatusColor(summary.status)}
              variant={summary.status === 'active' ? 'filled' : 'outlined'}
            />
          }
        />
        <ProfileDetailRow
          label={t('loyaltyTab.tier')}
          value={
            <Chip
              size="small"
              color="primary"
              variant="outlined"
              label={
                summary.tier_name
                  ? `${summary.tier_name}${summary.tier_code ? ` (${summary.tier_code})` : ''}`
                  : summary.tier_code || '—'
              }
            />
          }
        />
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
          gap: 1.5,
        }}
      >
        <ProfileMetric label={t('loyaltyTab.availablePoints')} value={summary.available_points.toLocaleString()} />
        <ProfileMetric label={t('loyaltyTab.lifetimePoints')} value={summary.lifetime_points.toLocaleString()} />
        <ProfileMetric label={t('loyaltyTab.qualifyingNights')} value={summary.qualifying_nights.toLocaleString()} />
      </Box>

      <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', display: 'block', mt: 2, mb: 1 }}>
        {t('loyaltyTab.recentRedemptions')}
      </Typography>
      {summary.recent_redemptions.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t('loyaltyTab.noRedemptions')}
        </Typography>
      ) : (
        <TableContainer>
          <Table size="small" aria-label={t('loyaltyTab.redemptionsAria')}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>{t('loyaltyTab.colReward')}</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">{t('loyaltyTab.colPoints')}</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{t('loyaltyTab.colStatus')}</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{t('loyaltyTab.colDate')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {summary.recent_redemptions.map((redemption) => (
                <TableRow key={redemption.id}>
                  <TableCell>{redemption.reward_name ?? t('loyaltyTab.rewardFallback')}</TableCell>
                  <TableCell align="right">{redemption.points.toLocaleString()}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={statusLabel(t, 'loyalty_redemption', redemption.status)}
                    />
                  </TableCell>
                  <TableCell>{formatHotelDate(redemption.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  );

  return (
    <Stack spacing={2.5}>
      <SectionCard
        title={
          <Stack
            direction="row"
            spacing={0.75}
            sx={{ alignItems: 'center', justifyContent: 'space-between', width: '100%' }}
          >
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <LoyaltyIcon sx={{ fontSize: 16 }} />
              <span>{t('loyaltyTab.title')}</span>
            </Stack>
            <SectionLink to="/loyalty">{t('loyaltyTab.manage')}</SectionLink>
          </Stack>
        }
      >
        {loyaltyQuery.isPending ? (
          <Stack spacing={1.5}>
            <Skeleton variant="rounded" height={56} />
            <Skeleton variant="rounded" height={96} />
          </Stack>
        ) : loyaltyQuery.isError ? (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={() => void loyaltyQuery.refetch()}>
                {t('common:actions.retry')}
              </Button>
            }
          >
            {getQueryErrorMessage(loyaltyQuery.error, t('loyaltyTab.loadFailed')) ??
              t('loyaltyTab.loadFailed')}
          </Alert>
        ) : loyalty == null ? (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <LoyaltyIcon sx={{ fontSize: 32, color: 'text.disabled', mb: 0.5 }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {t('loyaltyTab.notEnrolled')}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
              {t('loyaltyTab.notEnrolledHint')}
            </Typography>
          </Box>
        ) : (
          renderLoyaltyBody(loyalty)
        )}
      </SectionCard>

      <SectionCard
        title={
          <Stack
            direction="row"
            spacing={0.75}
            sx={{ alignItems: 'center', justifyContent: 'space-between', width: '100%' }}
          >
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <VoucherIcon sx={{ fontSize: 16 }} />
              <span>{t('loyaltyTab.vouchersTitle')}{vouchers.length > 0 ? ` (${vouchers.length})` : ''}</span>
            </Stack>
            <SectionLink to="/promotions">{t('loyaltyTab.managePromotions')}</SectionLink>
          </Stack>
        }
      >
        {vouchersQuery.isPending ? (
          <Skeleton variant="rounded" height={120} />
        ) : vouchersQuery.isError ? (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={() => void vouchersQuery.refetch()}>
                {t('common:actions.retry')}
              </Button>
            }
          >
            {getQueryErrorMessage(vouchersQuery.error, t('loyaltyTab.vouchersLoadFailed')) ??
              t('loyaltyTab.vouchersLoadFailed')}
          </Alert>
        ) : vouchers.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('loyaltyTab.vouchersEmpty')}
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small" aria-label={t('loyaltyTab.vouchersAria')}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>{t('loyaltyTab.colCode')}</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>{t('loyaltyTab.colPromotion')}</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>{t('loyaltyTab.colSource')}</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>{t('loyaltyTab.colStatus')}</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>{t('loyaltyTab.colExpires')}</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>{t('loyaltyTab.colRedeemed')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {vouchers.map((voucher) => {
                  const status = voucherDisplayStatus(voucher);
                  return (
                    <TableRow key={voucher.id}>
                      <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                        {voucher.code}
                      </TableCell>
                      <TableCell>{voucher.promotion_name ?? `#${voucher.promotion_id}`}</TableCell>
                      <TableCell>{statusLabel(t, 'generic', voucher.source)}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={statusLabel(t, 'voucher', status)}
                          color={voucherStatusColor(status)}
                          variant={status === 'available' ? 'filled' : 'outlined'}
                        />
                      </TableCell>
                      <TableCell>
                        {voucher.expires_at ? formatHotelDate(voucher.expires_at) : '—'}
                      </TableCell>
                      <TableCell>
                        {voucher.redeemed_at ? formatHotelDateTime(voucher.redeemed_at) : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </SectionCard>
    </Stack>
  );
};

export default LoyaltyVouchersTab;
