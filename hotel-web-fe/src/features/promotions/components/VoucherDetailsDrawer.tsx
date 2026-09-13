import BlockIcon from '@mui/icons-material/Block';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import PublicOutlinedIcon from '@mui/icons-material/PublicOutlined';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  LinearProgress,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { getQueryErrorMessage } from '../../../api/queryConfig';
import { useAllRoomTypes } from '../../rooms/hooks';
import { useAdminPromotion, useAdminVoucher } from '../hooks/usePromotionAdmin';
import type { Voucher } from '../types';
import {
  formatCurrencyAmount,
  formatPromotionDate,
  formatPromotionDiscount,
  guestDisplayName,
  relativeExpiryLabel,
  voucherCodeLabel,
  voucherDisplayStatus,
  voucherSourceLabel,
} from '../utils';
import { VoucherStatusChip } from './VoucherStatusChip';

interface VoucherDetailsDrawerProps {
  voucherId: number | null;
  open: boolean;
  canManage: boolean;
  isRevoking: boolean;
  onClose: () => void;
  onRevoke: (voucherId: number, displayCode: string, reason?: string) => void;
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: '110px 1fr',
        gap: 1,
        alignItems: 'baseline',
      }}
    >
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {label}
      </Typography>
      <Box sx={{ minWidth: 0 }}>{children}</Box>
    </Box>
  );
}

function LifecycleItem({
  label,
  value,
  hint,
  tone = 'text.primary',
}: {
  label: string;
  value?: string | null;
  hint?: string | null;
  tone?: string;
}) {
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
      <Box
        sx={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          bgcolor: value ? 'primary.main' : 'divider',
          mt: 0.7,
          flexShrink: 0,
        }}
      />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, color: tone }}>
          {label}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {value ?? '—'}
        </Typography>
        {hint ? (
          <Typography
            variant="caption"
            sx={{ color: 'text.secondary', display: 'block' }}
          >
            {hint}
          </Typography>
        ) : null}
      </Box>
    </Stack>
  );
}

export function VoucherDetailsDrawer({
  voucherId,
  open,
  canManage,
  isRevoking,
  onClose,
  onRevoke,
}: VoucherDetailsDrawerProps) {
  const voucherQuery = useAdminVoucher(voucherId, open);
  const voucher = voucherQuery.data;
  const promotionQuery = useAdminPromotion(
    voucher?.promotion_id ?? null,
    open && voucher != null,
  );
  const promotion = promotionQuery.data;
  const roomTypesQuery = useAllRoomTypes(open);

  const [copied, setCopied] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) {
      setCopied(false);
      setConfirmingRevoke(false);
      setReason('');
    }
  }, [open, voucherId]);

  const displayCode = voucher ? voucherCodeLabel(voucher) : '';
  const expired = voucher ? voucherDisplayStatus(voucher) === 'expired' : false;
  const canRevoke =
    canManage && voucher?.status === 'available' && !expired;

  const copyCode = async () => {
    if (!displayCode) return;
    try {
      await navigator.clipboard.writeText(displayCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (non-secure context).
    }
  };

  const roomTypeNames = (() => {
    if (!promotion?.room_type_ids?.length) return 'All room types';
    const byId = new Map(
      (roomTypesQuery.data ?? []).map((roomType) => [roomType.id, roomType.name]),
    );
    return promotion.room_type_ids
      .map((id) => byId.get(id) ?? `Room type #${id}`)
      .join(', ');
  })();

  const claimProgress =
    promotion?.claim_limit != null && promotion.claim_limit > 0
      ? Math.min(100, (promotion.claimed_count / promotion.claim_limit) * 100)
      : null;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: { width: { xs: '100%', sm: 440 } },
        },
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: 'center',
          px: 2.5,
          py: 2,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        {voucher ? (
          <Chip
            size="small"
            variant="outlined"
            label={displayCode}
            sx={{ fontFamily: 'monospace', letterSpacing: '0.04em' }}
          />
        ) : (
          <Skeleton variant="text" width={110} />
        )}
        <Tooltip title={copied ? 'Copied' : 'Copy code'}>
          <span>
            <IconButton
              size="small"
              aria-label={copied ? 'Copied' : 'Copy voucher code'}
              onClick={copyCode}
              disabled={!voucher}
            >
              {copied ? (
                <CheckIcon fontSize="small" color="success" />
              ) : (
                <ContentCopyIcon sx={{ fontSize: 16 }} />
              )}
            </IconButton>
          </span>
        </Tooltip>
        {voucher ? <VoucherStatusChip voucher={voucher} /> : null}
        <Box sx={{ flex: 1 }} />
        <IconButton
          size="small"
          aria-label="Close voucher details"
          onClick={onClose}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Box sx={{ p: 2.5, overflowY: 'auto' }}>
        {voucherQuery.isLoading ? (
          <Stack spacing={2}>
            <Skeleton variant="text" width="60%" sx={{ fontSize: '1.2rem' }} />
            <Skeleton variant="rectangular" height={110} sx={{ borderRadius: 2 }} />
            <Skeleton variant="rectangular" height={150} sx={{ borderRadius: 2 }} />
          </Stack>
        ) : voucherQuery.error ? (
          <Alert
            severity="error"
            action={
              <Button
                size="small"
                onClick={() => void voucherQuery.refetch()}
              >
                Retry
              </Button>
            }
          >
            {getQueryErrorMessage(
              voucherQuery.error,
              'Unable to load voucher',
            )}
          </Alert>
        ) : voucher ? (
          <Stack spacing={2.5}>
            <Stack spacing={1.25}>
              <InfoRow label="Offer">
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {voucher.promotion_name}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ color: 'text.secondary', fontFamily: 'monospace' }}
                >
                  {voucher.promotion_slug}
                </Typography>
              </InfoRow>
              <InfoRow label="Guest">
                <Typography variant="body2">
                  {guestDisplayName(voucher)}
                </Typography>
              </InfoRow>
              <InfoRow label="Source">
                <Typography variant="body2">
                  {voucherSourceLabel(voucher.source)}
                </Typography>
              </InfoRow>
              <InfoRow label="Issued">
                <Typography variant="body2">
                  {formatPromotionDate(voucher.claimed_at ?? voucher.created_at) ??
                    '—'}
                </Typography>
              </InfoRow>
            </Stack>

            {voucher.is_cancellable === false ? (
              <Alert severity="warning" variant="outlined">
                Non-cancellable — a booking that uses this voucher cannot be
                cancelled by the guest.
              </Alert>
            ) : null}

            <Box>
              <Typography
                variant="subtitle2"
                sx={{ fontWeight: 700, mb: 1.5 }}
              >
                Lifecycle
              </Typography>
              <Stack spacing={1.5}>
                <LifecycleItem
                  label="Issued"
                  value={formatPromotionDate(
                    voucher.claimed_at ?? voucher.created_at,
                  )}
                />
                {voucher.redeemed_at ? (
                  <LifecycleItem
                    label="Redeemed"
                    value={formatPromotionDate(voucher.redeemed_at)}
                  />
                ) : null}
                {voucher.revoked_at ? (
                  <LifecycleItem
                    label="Revoked"
                    value={formatPromotionDate(voucher.revoked_at)}
                    hint={voucher.revocation_reason ?? undefined}
                    tone="error.main"
                  />
                ) : null}
                <LifecycleItem
                  label="Expires"
                  value={formatPromotionDate(voucher.expires_at)}
                  hint={relativeExpiryLabel(voucher.expires_at)}
                  tone={expired ? 'error.main' : 'text.primary'}
                />
              </Stack>
            </Box>

            <Divider />

            <Box>
              <Typography
                variant="subtitle2"
                sx={{ fontWeight: 700, mb: 1.5 }}
              >
                Offer rules
              </Typography>
              {promotionQuery.isLoading ? (
                <Stack spacing={1}>
                  <Skeleton variant="text" width="70%" />
                  <Skeleton variant="text" width="55%" />
                  <Skeleton variant="text" width="62%" />
                </Stack>
              ) : promotion ? (
                <Stack spacing={1.25}>
                  <InfoRow label="Discount">
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 700, color: 'primary.main' }}
                    >
                      {formatPromotionDiscount(promotion)}
                    </Typography>
                  </InfoRow>
                  <InfoRow label="Claim window">
                    <Typography variant="body2">
                      {formatPromotionDate(promotion.claim_starts_at) ?? 'Any time'}
                      {' → '}
                      {formatPromotionDate(promotion.claim_ends_at) ?? 'Open-ended'}
                    </Typography>
                  </InfoRow>
                  <InfoRow label="Stay dates">
                    <Typography variant="body2">
                      {formatPromotionDate(promotion.stay_starts_on) ?? 'Any'}
                      {' → '}
                      {formatPromotionDate(promotion.stay_ends_on) ?? 'Any'}
                    </Typography>
                  </InfoRow>
                  <InfoRow label="Stay length">
                    <Typography variant="body2">
                      {promotion.min_nights ?? 1}+ night
                      {(promotion.min_nights ?? 1) === 1 ? '' : 's'}
                      {promotion.max_nights
                        ? `, up to ${promotion.max_nights}`
                        : ''}
                    </Typography>
                  </InfoRow>
                  {promotion.min_subtotal ? (
                    <InfoRow label="Min subtotal">
                      <Typography variant="body2">
                        {formatCurrencyAmount(
                          promotion.min_subtotal,
                          promotion.currency,
                        )}
                      </Typography>
                    </InfoRow>
                  ) : null}
                  <InfoRow label="Room types">
                    <Typography variant="body2">{roomTypeNames}</Typography>
                  </InfoRow>
                  <InfoRow label="Per guest">
                    <Typography variant="body2">
                      {promotion.per_guest_limit} voucher
                      {promotion.per_guest_limit === 1 ? '' : 's'} per guest
                    </Typography>
                  </InfoRow>
                  <InfoRow label="Visibility">
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
                      label={promotion.is_public ? 'Public' : 'Private'}
                    />
                  </InfoRow>
                  <Box sx={{ pt: 0.5 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {promotion.claimed_count}
                      {promotion.claim_limit
                        ? ` of ${promotion.claim_limit} claimed`
                        : ' claimed'}
                    </Typography>
                    {claimProgress !== null ? (
                      <LinearProgress
                        variant="determinate"
                        value={claimProgress}
                        aria-label={`${Math.round(claimProgress)}% of claim limit used`}
                        sx={{ mt: 0.75, height: 5, borderRadius: 99 }}
                      />
                    ) : (
                      <Typography
                        variant="caption"
                        sx={{ color: 'text.secondary' }}
                      >
                        No total limit
                      </Typography>
                    )}
                  </Box>
                </Stack>
              ) : (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Offer details unavailable.
                </Typography>
              )}
            </Box>

            {canRevoke ? (
              <>
                <Divider />
                {confirmingRevoke ? (
                  <Stack spacing={1.5}>
                    <Alert severity="warning" variant="outlined">
                      Revoking is permanent — the guest will no longer be able
                      to use this voucher.
                    </Alert>
                    <TextField
                      label="Reason (optional)"
                      size="small"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      slotProps={{ htmlInput: { maxLength: 1000 } }}
                      fullWidth
                    />
                    <Stack direction="row" spacing={1}>
                      <Button
                        variant="contained"
                        color="error"
                        disabled={isRevoking}
                        onClick={() =>
                          onRevoke(
                            voucher.id,
                            displayCode,
                            reason.trim() || undefined,
                          )
                        }
                      >
                        {isRevoking ? 'Revoking…' : 'Confirm revoke'}
                      </Button>
                      <Button
                        onClick={() => setConfirmingRevoke(false)}
                        disabled={isRevoking}
                      >
                        Keep voucher
                      </Button>
                    </Stack>
                  </Stack>
                ) : (
                  <Button
                    variant="outlined"
                    color="error"
                    startIcon={<BlockIcon />}
                    onClick={() => setConfirmingRevoke(true)}
                  >
                    Revoke voucher
                  </Button>
                )}
              </>
            ) : null}
          </Stack>
        ) : null}
      </Box>
    </Drawer>
  );
}
