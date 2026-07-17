import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import {
  Box,
  Card,
  CardContent,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { VOUCHER_STATUS_LABELS } from '../constants';
import type { Voucher } from '../types';
import { formatPromotionDate } from '../utils';

interface VoucherCardProps {
  voucher: Voucher;
}

const statusColor = {
  available: 'success',
  redeemed: 'default',
  revoked: 'error',
} as const;

export function VoucherCard({ voucher }: VoucherCardProps) {
  const [copied, setCopied] = useState(false);
  const displayCode = voucher.code ?? voucher.code_masked ?? 'Code unavailable';
  const expiresAt = formatPromotionDate(voucher.expires_at);
  const isExpired = Boolean(
    voucher.status === 'available' &&
      voucher.expires_at &&
      new Date(voucher.expires_at).getTime() < Date.now()
  );

  const copyCode = async () => {
    if (!voucher.code || !navigator.clipboard) return;
    await navigator.clipboard.writeText(voucher.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card variant="outlined" sx={{ height: '100%', borderColor: 'rgba(6,17,14,.14)', borderRadius: 3, transition: 'transform 180ms ease, box-shadow 180ms ease', '@media (prefers-reduced-motion: reduce)': { transition: 'none' }, '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 10px 24px rgba(6,17,14,.08)' } }}>
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1}>
          <Box>
            <Typography variant="overline" color="text.secondary">
              Voucher
            </Typography>
            <Typography variant="h6" sx={{ color: '#06110e', fontWeight: 700 }}>{voucher.promotion_name}</Typography>
          </Box>
          <Chip
            label={isExpired ? 'Expired' : VOUCHER_STATUS_LABELS[voucher.status] ?? voucher.status}
            color={isExpired ? 'warning' : statusColor[voucher.status] ?? 'default'}
            size="small"
          />
        </Stack>

        <Box
          sx={{
            mt: 2,
            p: 1.5,
            borderRadius: 2,
            bgcolor: 'rgba(217,181,114,.16)',
            border: '1px dashed rgba(141,107,48,.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Typography variant="h6" sx={{ fontFamily: 'monospace', letterSpacing: 1 }}>
            {displayCode}
          </Typography>
          {voucher.code ? (
            <Tooltip title={copied ? 'Copied' : 'Copy code'}>
              <IconButton aria-label={copied ? 'Voucher code copied' : 'Copy code'} onClick={() => void copyCode()} sx={{ minWidth: 44, minHeight: 44 }}>
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}
        </Box>
        <Box role="status" aria-live="polite" aria-atomic="true" sx={{ minHeight: 20, mt: 0.75 }}>
          {copied ? <Typography variant="caption" sx={{ color: '#25633a', fontWeight: 600 }}>Voucher code copied to clipboard.</Typography> : null}
        </Box>

        <Stack spacing={0.5} sx={{ mt: 1.25 }}>
          {expiresAt ? (
            <Typography variant="caption" color="text.secondary">
              Expires {expiresAt}
            </Typography>
          ) : (
            <Typography variant="caption" color="text.secondary">
              No expiry date
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            Source: {voucher.source}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}
