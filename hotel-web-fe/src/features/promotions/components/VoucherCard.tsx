import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
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
    backgroundColor: '#e8f2eb',
    color: '#225c39',
    accent: '#1f6843',
  },
  redeemed: {
    backgroundColor: '#ececeb',
    color: '#555b57',
    accent: '#6f766f',
  },
  revoked: {
    backgroundColor: '#f8e9e6',
    color: '#8a3b30',
    accent: '#a64b3e',
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
    ? { backgroundColor: '#fff1d8', color: '#7b5417', accent: '#b47920' }
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
        borderColor: 'rgba(6, 35, 27, 0.14)',
        borderRadius: 3,
        boxShadow: '0 10px 30px rgba(6, 35, 27, 0.055)',
        transition: 'border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease',
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        '&:hover': {
          borderColor: 'rgba(6, 35, 27, 0.28)',
          boxShadow: '0 16px 36px rgba(6, 35, 27, 0.09)',
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

          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <ConfirmationNumberOutlinedIcon sx={{ color: '#9b742f', fontSize: 20 }} />
              <Typography
                variant="overline"
                sx={{ color: '#7d632f', fontWeight: 800, letterSpacing: '0.13em' }}
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
            sx={{ mt: 2, color: '#061b15', fontWeight: 750, lineHeight: 1.2 }}
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
            <Stack direction="row" alignItems="center" spacing={0.75}>
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
            backgroundColor: '#fbf5e9',
            borderTop: { xs: '1px dashed rgba(126, 92, 32, 0.35)', md: 0 },
            borderLeft: { xs: 0, md: '1px dashed rgba(126, 92, 32, 0.35)' },
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            minWidth: 0,
          }}
        >
          <Typography
            variant="caption"
            sx={{ color: '#765d30', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase' }}
          >
            Voucher code
          </Typography>
          <Typography
            sx={{
              mt: 0.75,
              color: '#10221d',
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
                backgroundColor: '#0a4a38',
                boxShadow: 'none',
                '&:hover': { backgroundColor: '#073c2e', boxShadow: 'none' },
              }}
            >
              {copyState === 'copied' ? 'Copied' : 'Copy code'}
            </Button>
          ) : null}
          <Box role="status" aria-live="polite" aria-atomic="true" sx={{ minHeight: 20, mt: 1 }}>
            {copyState === 'copied' ? (
              <Typography variant="caption" sx={{ color: '#225c39', fontWeight: 700 }}>
                Voucher code copied to clipboard.
              </Typography>
            ) : null}
            {copyState === 'failed' ? (
              <Typography variant="caption" sx={{ color: '#8a3b30', fontWeight: 700 }}>
                Could not copy the code. Please select it manually.
              </Typography>
            ) : null}
          </Box>
        </Box>
      </Box>
    </Card>
  );
}
