import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ConfirmationNumberOutlinedIcon from '@mui/icons-material/ConfirmationNumberOutlined';
import {
  Box,
  Button,
  Card,
  Chip,
  Stack,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { VOUCHER_STATUS_LABELS } from '../constants';
import type { Voucher } from '../types';
import { formatPromotionDate } from '../utils';

interface VoucherCardProps {
  voucher: Voucher;
}

type CopyState = 'idle' | 'copied' | 'failed';

const STATUS_STYLES = {
  available: {
    backgroundColor: 'var(--hotel-success-bg)',
    color: 'var(--hotel-success)',
    accent: 'var(--hotel-success)',
  },
  redeemed: {
    backgroundColor: 'var(--hotel-neutral-bg)',
    color: 'var(--hotel-neutral)',
    accent: 'var(--hotel-neutral)',
  },
  revoked: {
    backgroundColor: 'var(--hotel-danger-bg)',
    color: 'var(--hotel-danger)',
    accent: 'var(--hotel-danger)',
  },
} as const;

function getVoucherOrigin(source: string): string {
  return source === 'guest_claim' ? 'Claimed from Offers' : 'Issued by the hotel';
}

export function VoucherCard({ voucher }: VoucherCardProps) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const displayCode = voucher.code ?? voucher.code_masked ?? 'Code unavailable';
  const expiresAt = formatPromotionDate(voucher.expires_at);
  const claimedAt = formatPromotionDate(voucher.claimed_at ?? voucher.created_at);
  const isExpired = Boolean(
    voucher.status === 'available' &&
      voucher.expires_at &&
      new Date(voucher.expires_at).getTime() < Date.now()
  );
  const displayStatus = isExpired
    ? 'Expired'
    : VOUCHER_STATUS_LABELS[voucher.status] ?? voucher.status;
  const statusStyle = isExpired
    ? { backgroundColor: 'var(--hotel-warning-bg)', color: 'var(--hotel-warning)', accent: 'var(--hotel-warning)' }
    : STATUS_STYLES[voucher.status];

  const copyCode = async () => {
    if (!voucher.code || !navigator.clipboard) return;

    try {
      await navigator.clipboard.writeText(voucher.code);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1800);
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <Card
      component="article"
      variant="outlined"
      sx={{
        overflow: 'hidden',
        borderColor: 'var(--hotel-border)',
        borderRadius: 3,
        boxShadow: 'var(--hotel-shadow-sm)',
        transition: 'border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease',
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        '&:hover': {
          borderColor: 'var(--hotel-border-strong)',
          boxShadow: 'var(--hotel-shadow-md)',
          transform: 'translateY(-2px)',
        },
      }}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(320px, 0.72fr)' },
        }}
      >
        <Box sx={{ p: { xs: 2.5, sm: 3.25 }, position: 'relative' }}>
          <Box
            aria-hidden="true"
            sx={{
              position: 'absolute',
              inset: '0 auto 0 0',
              width: 5,
              backgroundColor: statusStyle.accent,
            }}
          />

          <Stack
            direction="row"
            sx={{
              alignItems: "center",
              justifyContent: "space-between",
              gap: 2
            }}>
            <Stack direction="row" spacing={1} sx={{
              alignItems: "center"
            }}>
              <ConfirmationNumberOutlinedIcon sx={{ color: 'var(--hotel-primary-text)', fontSize: 20 }} />
              <Typography
                variant="overline"
                sx={{ color: 'var(--hotel-primary-text)', fontWeight: 800, letterSpacing: '0.13em' }}
              >
                Stay voucher
              </Typography>
            </Stack>
            <Chip
              icon={voucher.status === 'available' && !isExpired ? <CheckCircleOutlineIcon /> : undefined}
              label={displayStatus}
              size="small"
              sx={{
                flexShrink: 0,
                backgroundColor: statusStyle.backgroundColor,
                color: statusStyle.color,
                fontWeight: 750,
                '& .MuiChip-icon': { color: 'inherit' },
              }}
            />
          </Stack>

          <Typography
            variant="h5"
            sx={{ mt: 2, color: 'var(--hotel-text)', fontWeight: 750, lineHeight: 1.2 }}
          >
            {voucher.promotion_name}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.75, color: 'text.secondary' }}>
            Present this code when booking or select the voucher during checkout.
          </Typography>

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={{ xs: 1, sm: 2.5 }}
            sx={{ mt: 3, color: 'text.secondary' }}
          >
            <Stack direction="row" spacing={0.75} sx={{
              alignItems: "center"
            }}>
              <CalendarMonthOutlinedIcon sx={{ fontSize: 18 }} />
              <Typography variant="body2">
                {expiresAt ? `Valid until ${expiresAt}` : 'No expiry date'}
              </Typography>
            </Stack>
            <Typography variant="body2">
              {getVoucherOrigin(voucher.source)}{claimedAt ? ` · ${claimedAt}` : ''}
            </Typography>
          </Stack>
        </Box>

        <Box
          sx={{
            p: { xs: 2.5, sm: 3.25 },
            backgroundColor: 'var(--hotel-surface-sunken)',
            borderTop: { xs: '1px dashed var(--hotel-border-strong)', md: 0 },
            borderLeft: { xs: 0, md: '1px dashed var(--hotel-border-strong)' },
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            minWidth: 0,
          }}
        >
          <Typography
            variant="caption"
            sx={{ color: 'var(--hotel-primary-text)', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase' }}
          >
            Voucher code
          </Typography>
          <Typography
            sx={{
              mt: 0.75,
              color: 'var(--hotel-text)',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize: 'clamp(1rem, 2vw, 1.35rem)',
              fontWeight: 800,
              letterSpacing: '0.06em',
              lineHeight: 1.35,
              overflowWrap: 'anywhere',
            }}
          >
            {displayCode}
          </Typography>

          {voucher.code ? (
            <Button
              variant="contained"
              startIcon={copyState === 'copied' ? <CheckCircleOutlineIcon /> : <ContentCopyIcon />}
              onClick={() => void copyCode()}
              sx={{
                mt: 2.25,
                alignSelf: { xs: 'stretch', sm: 'flex-start' },
                minHeight: 44,
                px: 2.25,
                backgroundColor: 'var(--hotel-primary)',
                boxShadow: 'none',
                '&:hover': { backgroundColor: 'var(--hotel-primary-hover)', boxShadow: 'none' },
              }}
            >
              {copyState === 'copied' ? 'Copied' : 'Copy code'}
            </Button>
          ) : null}
          <Box role="status" aria-live="polite" aria-atomic="true" sx={{ minHeight: 20, mt: 1 }}>
            {copyState === 'copied' ? (
              <Typography variant="caption" sx={{ color: 'var(--hotel-success)', fontWeight: 700 }}>
                Voucher code copied to clipboard.
              </Typography>
            ) : null}
            {copyState === 'failed' ? (
              <Typography variant="caption" sx={{ color: 'var(--hotel-danger)', fontWeight: 700 }}>
                Could not copy the code. Please select it manually.
              </Typography>
            ) : null}
          </Box>
        </Box>
      </Box>
    </Card>
  );
}
