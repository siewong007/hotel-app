// Slim top-of-page stats strip: Billed / Collected / Outstanding / Overdue.

import React from 'react';
import { Box, Typography, Card } from '@mui/material';
import {
  AttachMoney as MoneyIcon,
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
} from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import type { CustomerLedger } from '../../../../../types';
import type { CustomerLedgerSummary } from '../hooks/useCustomerLedgerWorkspace';
import { asMoney, getLedgerUiStatus } from '../helpers';

interface LedgerSummaryStripProps {
  summary: CustomerLedgerSummary | null;
  ledgers: CustomerLedger[];
  companiesCount: number;
  formatCurrency: (value: number) => string;
  currencySymbol: string;
}

const LedgerSummaryStrip: React.FC<LedgerSummaryStripProps> = ({
  summary,
  ledgers,
  companiesCount,
  formatCurrency,
  currencySymbol,
}) => {
  if (!summary) return null;

  const totalAmount = parseFloat(String(summary.total_amount || 0));
  const totalPaid = parseFloat(String(summary.total_paid || 0));
  const totalDue = parseFloat(String(summary.total_outstanding || 0));
  const overdueAmount = ledgers.reduce(
    (sum, l) => (getLedgerUiStatus(l) === 'overdue' ? sum + asMoney(l.balance_due) : sum),
    0,
  );
  const collectionPct = totalAmount > 0 ? Math.round((totalPaid / totalAmount) * 100) : 0;
  const readyToBillCount = ledgers.filter(l => getLedgerUiStatus(l) === 'ready_to_invoice').length;
  const openInvoiceCount = ledgers.filter(l => {
    const s = getLedgerUiStatus(l);
    return s === 'invoiced' || s === 'partial' || s === 'overdue';
  }).length;
  const stats = [
    {
      key: 'billed',
      icon: <MoneyIcon fontSize="small" />,
      iconBg: (theme: any) => alpha(theme.palette.info.main, 0.12),
      iconColor: 'info.main',
      label: 'Total Billed',
      value: formatCurrency(totalAmount).replace(currencySymbol, '').trim(),
      delta: `${summary.total_entries} entries / ${companiesCount} ${companiesCount === 1 ? 'company' : 'companies'}`,
      currency: currencySymbol,
    },
    {
      key: 'collected',
      icon: <CheckCircleIcon fontSize="small" />,
      iconBg: (theme: any) => alpha(theme.palette.success.main, 0.12),
      iconColor: 'success.main',
      label: 'Collected',
      value: formatCurrency(totalPaid).replace(currencySymbol, '').trim(),
      delta: `${collectionPct}% of billed`,
      currency: currencySymbol,
    },
    {
      key: 'outstanding',
      icon: <WarningIcon fontSize="small" />,
      iconBg: (theme: any) => alpha(theme.palette.warning.main, 0.14),
      iconColor: 'warning.main',
      label: 'Outstanding',
      value: formatCurrency(totalDue).replace(currencySymbol, '').trim(),
      delta: `${openInvoiceCount} open item${openInvoiceCount === 1 ? '' : 's'}`,
      currency: currencySymbol,
    },
    {
      key: 'overdue',
      icon: <WarningIcon fontSize="small" />,
      iconBg: (theme: any) => alpha(theme.palette.error.main, 0.12),
      iconColor: overdueAmount > 0 ? 'error.main' : 'text.secondary',
      label: 'Overdue',
      value: formatCurrency(overdueAmount).replace(currencySymbol, '').trim(),
      delta: `${readyToBillCount} ready to bill`,
      currency: currencySymbol,
    },
  ];
  return (
    <Card
      variant="outlined"
      sx={{
        mb: 2.5,
        display: 'grid',
        gridTemplateColumns: {
          xs: '1fr',
          sm: 'repeat(2, 1fr)',
          md: 'repeat(4, 1fr)',
        },
        overflow: 'hidden',
      }}
    >
      {stats.map((s, idx) => (
        <Box
          key={s.key}
          sx={{
            p: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            borderLeft: {
              xs: 'none',
              md: idx === 0 ? 'none' : '1px solid',
            },
            borderTop: {
              xs: idx === 0 ? 'none' : '1px solid',
              sm: idx < 2 ? 'none' : '1px solid',
              md: 'none',
            },
            borderColor: 'divider',
          }}
        >
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: 1.5,
              display: 'grid',
              placeItems: 'center',
              bgcolor: s.iconBg as any,
              color: s.iconColor,
              flexShrink: 0,
            }}
          >
            {s.icon}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                fontWeight: 700,
                color: 'text.secondary',
                letterSpacing: 0.6,
                textTransform: 'uppercase',
                lineHeight: 1.2,
              }}
            >
              {s.label}
            </Typography>
            <Typography
              variant="h6"
              sx={{
                fontWeight: 700,
                letterSpacing: '-0.3px',
                lineHeight: 1.2,
                mt: 0.5,
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {s.currency && (
                <Box
                  component="span"
                  sx={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'text.secondary',
                    mr: 0.5,
                    letterSpacing: 0.4,
                  }}
                >
                  {s.currency}
                </Box>
              )}
              {s.value}
            </Typography>
            <Typography
              variant="caption"
              sx={{ color: 'text.secondary', display: 'block', mt: 0.25 }}
            >
              {s.delta}
            </Typography>
          </Box>
        </Box>
      ))}
    </Card>
  );
};

export default LedgerSummaryStrip;
