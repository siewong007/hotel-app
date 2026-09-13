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
import { formatStatusLabel } from '../../../../utils/formatters';
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
        <ProfileDetailRow label="Member number" value={summary.member_number} />
        <ProfileDetailRow
          label="Status"
          value={
            <Chip
              size="small"
              label={formatStatusLabel(summary.status)}
              color={loyaltyStatusColor(summary.status)}
              variant={summary.status === 'active' ? 'filled' : 'outlined'}
            />
          }
        />
        <ProfileDetailRow
          label="Tier"
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
        <ProfileMetric label="Available points" value={summary.available_points.toLocaleString()} />
        <ProfileMetric label="Lifetime points" value={summary.lifetime_points.toLocaleString()} />
        <ProfileMetric label="Qualifying nights" value={summary.qualifying_nights.toLocaleString()} />
      </Box>

      <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', display: 'block', mt: 2, mb: 1 }}>
        RECENT REDEMPTIONS
      </Typography>
      {summary.recent_redemptions.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          No redemptions yet.
        </Typography>
      ) : (
        <TableContainer>
          <Table size="small" aria-label="Recent loyalty redemptions">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Reward</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">Points</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Date</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {summary.recent_redemptions.map((redemption) => (
                <TableRow key={redemption.id}>
                  <TableCell>{redemption.reward_name ?? 'Reward'}</TableCell>
                  <TableCell align="right">{redemption.points.toLocaleString()}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={formatStatusLabel(redemption.status)}
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
              <span>Loyalty membership</span>
            </Stack>
            <SectionLink to="/loyalty">Manage in Loyalty</SectionLink>
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
                Retry
              </Button>
            }
          >
            {getQueryErrorMessage(loyaltyQuery.error, 'Failed to load loyalty summary') ??
              'Failed to load loyalty summary'}
          </Alert>
        ) : loyalty == null ? (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <LoyaltyIcon sx={{ fontSize: 32, color: 'text.disabled', mb: 0.5 }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Not enrolled
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
              This guest has no loyalty membership. Enrolment is managed in the Loyalty workspace.
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
              <span>Vouchers{vouchers.length > 0 ? ` (${vouchers.length})` : ''}</span>
            </Stack>
            <SectionLink to="/promotions">Manage in Promotions</SectionLink>
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
                Retry
              </Button>
            }
          >
            {getQueryErrorMessage(vouchersQuery.error, 'Failed to load vouchers') ??
              'Failed to load vouchers'}
          </Alert>
        ) : vouchers.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            No vouchers issued to this guest.
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small" aria-label="Guest vouchers">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Code</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Promotion</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Source</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Expires</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Redeemed</TableCell>
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
                      <TableCell>{formatStatusLabel(voucher.source)}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={formatStatusLabel(status)}
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
