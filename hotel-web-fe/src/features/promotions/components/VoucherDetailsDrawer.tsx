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
import { useTranslation } from '../../../i18n';
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
  const { t, tOr } = useTranslation('promotions');
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
    if (!promotion?.room_type_ids?.length) return t('vouchers.rules.allRoomTypes');
    const byId = new Map(
      (roomTypesQuery.data ?? []).map((roomType) => [roomType.id, roomType.name]),
    );
    return promotion.room_type_ids
      .map((id) => byId.get(id) ?? t('vouchers.rules.roomTypeNumber', { id }))
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
        <Tooltip title={copied ? t('vouchers.copied') : t('vouchers.copyCode')}>
          <span>
            <IconButton
              size="small"
              aria-label={copied ? t('vouchers.copied') : t('vouchers.copyVoucherCode')}
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
          aria-label={t('vouchers.closeDetails')}
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
                {t('common:actions.retry')}
              </Button>
            }
          >
            {getQueryErrorMessage(
              voucherQuery.error,
              t('vouchers.loadError'),
            )}
          </Alert>
        ) : voucher ? (
          <Stack spacing={2.5}>
            <Stack spacing={1.25}>
              <InfoRow label={t('vouchers.fieldOffer')}>
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
              <InfoRow label={t('vouchers.fieldGuest')}>
                <Typography variant="body2">
                  {guestDisplayName(voucher, t)}
                </Typography>
              </InfoRow>
              <InfoRow label={t('vouchers.fieldSource')}>
                <Typography variant="body2">
                  {voucherSourceLabel(voucher.source, tOr)}
                </Typography>
              </InfoRow>
              <InfoRow label={t('vouchers.fieldIssued')}>
                <Typography variant="body2">
                  {formatPromotionDate(voucher.claimed_at ?? voucher.created_at) ??
                    '—'}
                </Typography>
              </InfoRow>
            </Stack>

            {voucher.is_cancellable === false ? (
              <Alert severity="warning" variant="outlined">
                {t('vouchers.nonCancellable')}
              </Alert>
            ) : null}

            <Box>
              <Typography
                variant="subtitle2"
                sx={{ fontWeight: 700, mb: 1.5 }}
              >
                {t('vouchers.lifecycle')}
              </Typography>
              <Stack spacing={1.5}>
                <LifecycleItem
                  label={t('vouchers.fieldIssued')}
                  value={formatPromotionDate(
                    voucher.claimed_at ?? voucher.created_at,
                  )}
                />
                {voucher.redeemed_at ? (
                  <LifecycleItem
                    label={t('vouchers.fieldRedeemed')}
                    value={formatPromotionDate(voucher.redeemed_at)}
                  />
                ) : null}
                {voucher.revoked_at ? (
                  <LifecycleItem
                    label={t('vouchers.fieldRevoked')}
                    value={formatPromotionDate(voucher.revoked_at)}
                    hint={voucher.revocation_reason ?? undefined}
                    tone="error.main"
                  />
                ) : null}
                <LifecycleItem
                  label={t('vouchers.colExpires')}
                  value={formatPromotionDate(voucher.expires_at)}
                  hint={relativeExpiryLabel(voucher.expires_at, t)}
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
                {t('vouchers.rules.title')}
              </Typography>
              {promotionQuery.isLoading ? (
                <Stack spacing={1}>
                  <Skeleton variant="text" width="70%" />
                  <Skeleton variant="text" width="55%" />
                  <Skeleton variant="text" width="62%" />
                </Stack>
              ) : promotion ? (
                <Stack spacing={1.25}>
                  <InfoRow label={t('vouchers.rules.discount')}>
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 700, color: 'primary.main' }}
                    >
                      {formatPromotionDiscount(promotion, t)}
                    </Typography>
                  </InfoRow>
                  <InfoRow label={t('vouchers.rules.claimWindow')}>
                    <Typography variant="body2">
                      {formatPromotionDate(promotion.claim_starts_at) ?? t('vouchers.rules.anyTime')}
                      {' → '}
                      {formatPromotionDate(promotion.claim_ends_at) ?? t('vouchers.rules.openEnded')}
                    </Typography>
                  </InfoRow>
                  <InfoRow label={t('vouchers.rules.stayDates')}>
                    <Typography variant="body2">
                      {formatPromotionDate(promotion.stay_starts_on) ?? t('vouchers.rules.any')}
                      {' → '}
                      {formatPromotionDate(promotion.stay_ends_on) ?? t('vouchers.rules.any')}
                    </Typography>
                  </InfoRow>
                  <InfoRow label={t('vouchers.rules.stayLength')}>
                    <Typography variant="body2">
                      {t('vouchers.rules.stayLengthValue', { count: promotion.min_nights ?? 1 })}
                      {promotion.max_nights
                        ? t('vouchers.rules.upTo', { max: promotion.max_nights })
                        : ''}
                    </Typography>
                  </InfoRow>
                  {promotion.min_subtotal ? (
                    <InfoRow label={t('vouchers.rules.minSubtotal')}>
                      <Typography variant="body2">
                        {formatCurrencyAmount(
                          promotion.min_subtotal,
                          promotion.currency,
                        )}
                      </Typography>
                    </InfoRow>
                  ) : null}
                  <InfoRow label={t('vouchers.rules.roomTypes')}>
                    <Typography variant="body2">{roomTypeNames}</Typography>
                  </InfoRow>
                  <InfoRow label={t('vouchers.rules.perGuest')}>
                    <Typography variant="body2">
                      {t('vouchers.rules.perGuestValue', { count: promotion.per_guest_limit })}
                    </Typography>
                  </InfoRow>
                  <InfoRow label={t('vouchers.rules.visibility')}>
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
                      label={promotion.is_public ? t('campaigns.public') : t('campaigns.private')}
                    />
                  </InfoRow>
                  <Box sx={{ pt: 0.5 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {promotion.claim_limit
                        ? t('campaigns.claimedOf', { claimed: promotion.claimed_count, limit: promotion.claim_limit })
                        : t('campaigns.claimedOnly', { claimed: promotion.claimed_count })}
                    </Typography>
                    {claimProgress !== null ? (
                      <LinearProgress
                        variant="determinate"
                        value={claimProgress}
                        aria-label={t('campaigns.claimProgress', { percent: Math.round(claimProgress) })}
                        sx={{ mt: 0.75, height: 5, borderRadius: 99 }}
                      />
                    ) : (
                      <Typography
                        variant="caption"
                        sx={{ color: 'text.secondary' }}
                      >
                        {t('campaigns.noLimit')}
                      </Typography>
                    )}
                  </Box>
                </Stack>
              ) : (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {t('vouchers.rules.unavailable')}
                </Typography>
              )}
            </Box>

            {canRevoke ? (
              <>
                <Divider />
                {confirmingRevoke ? (
                  <Stack spacing={1.5}>
                    <Alert severity="warning" variant="outlined">
                      {t('vouchers.revokeWarning')}
                    </Alert>
                    <TextField
                      label={t('vouchers.revokeReason')}
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
                        {isRevoking ? t('vouchers.revoking') : t('vouchers.confirmRevoke')}
                      </Button>
                      <Button
                        onClick={() => setConfirmingRevoke(false)}
                        disabled={isRevoking}
                      >
                        {t('vouchers.keepVoucher')}
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
                    {t('vouchers.revokeVoucher')}
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
