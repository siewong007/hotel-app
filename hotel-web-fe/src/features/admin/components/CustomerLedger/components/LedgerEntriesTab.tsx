// "Ledger entries" tab body of the detail pane: search/status toolbar plus the
// paginated entries table with per-row actions.

import React from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Button,
  IconButton,
  CircularProgress,
  LinearProgress,
} from '@mui/material';
import {
  Edit as EditIcon,
  Payment as PaymentIcon,
  Print as PrintIcon,
  Block as VoidIcon,
  OpenInNew as OpenInNewIcon,
} from '@mui/icons-material';
import type { CustomerLedger, CustomerLedgerPayment } from '../../../../../types';
import type { EntryStatusFilter } from '../types';
import { formatDateForDisplay, getLedgerUiStatus, isLedgerVoided } from '../helpers';
import { LedgerStatusBadge } from '../StatusPill';

interface LedgerEntriesTabProps {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: EntryStatusFilter;
  onStatusFilterChange: (value: EntryStatusFilter) => void;
  loading: boolean;
  entries: CustomerLedger[];
  entryCount: number;
  payments: Record<number, CustomerLedgerPayment[]>;
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  loadingInvoice: boolean;
  onRecordPayment: (entry: CustomerLedger) => void;
  onViewInvoice: (entry: CustomerLedger) => void;
  onEdit: (entry: CustomerLedger) => void;
  onPrintReceipt: (entry: CustomerLedger) => void;
  onVoid: (entry: CustomerLedger) => void;
  formatCurrency: (value: number) => string;
}

const canRecordPayment = (ledger: CustomerLedger) =>
  ledger.status !== 'paid' && !isLedgerVoided(ledger);
const canViewInvoice = (ledger: CustomerLedger) => !!ledger.booking_id;
const canVoid = (ledger: CustomerLedger) => !isLedgerVoided(ledger);

const LedgerEntriesTab: React.FC<LedgerEntriesTabProps> = ({
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  loading,
  entries,
  entryCount,
  payments,
  total,
  page,
  onPageChange,
  pageSize,
  onPageSizeChange,
  loadingInvoice,
  onRecordPayment,
  onViewInvoice,
  onEdit,
  onPrintReceipt,
  onVoid,
  formatCurrency,
}) => {
  return (
    <>
      {/* Toolbar: search + status segment */}
      <Box
        sx={{
          px: 2.5,
          py: 1.25,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          flexWrap: 'wrap',
          bgcolor: 'action.hover',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <TextField
          size="small"
          placeholder="Search description or invoice no..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          sx={{ width: 240, bgcolor: 'background.paper' }}
        />
        <Box
          sx={{
            display: 'inline-flex',
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            p: 0.25,
          }}
        >
          {([
            { key: 'all', label: 'All' },
            { key: 'uninvoiced', label: 'Uninvoiced' },
            { key: 'outstanding', label: 'Outstanding' },
            { key: 'invoiced', label: 'Invoiced' },
            { key: 'paid', label: 'Paid' },
            { key: 'overdue', label: 'Overdue' },
            { key: 'voided', label: 'Voided' },
          ] as const).map(s => (
            <Button
              key={s.key}
              size="small"
              onClick={() => onStatusFilterChange(s.key as EntryStatusFilter)}
              sx={{
                minWidth: 0,
                px: 1,
                py: 0.25,
                fontSize: 11.5,
                fontWeight: 600,
                color: statusFilter === s.key ? 'background.paper' : 'text.secondary',
                bgcolor: statusFilter === s.key ? 'text.primary' : 'transparent',
                borderRadius: 0.75,
                '&:hover': {
                  bgcolor: statusFilter === s.key ? 'text.primary' : 'action.hover',
                },
              }}
            >
              {s.label}
            </Button>
          ))}
        </Box>
      </Box>

      {loading && <LinearProgress sx={{ height: 2 }} />}

      {entries.length === 0 && loading ? (
        <Box sx={{ py: 8, px: 4, textAlign: 'center' }}>
          <CircularProgress size={28} />
        </Box>
      ) : entries.length === 0 ? (
        <Box sx={{ py: 8, px: 4, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            {entryCount === 0
              ? 'No ledger entries for this company yet.'
              : 'No entries match this filter.'}
          </Typography>
        </Box>
      ) : (
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" stickyHeader sx={{ minWidth: 980 }}>
            <TableHead>
              <TableRow
                sx={{
                  '& .MuiTableCell-root': {
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: 'text.secondary',
                    letterSpacing: 0.6,
                    textTransform: 'uppercase',
                    bgcolor: 'action.hover',
                    py: 1.25,
                  },
                }}
              >
                <TableCell sx={{ pl: 2.5, width: '30%' }}>Description</TableCell>
                <TableCell>Stay / Ledger Date</TableCell>
                <TableCell>Invoice #</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell align="right">Paid</TableCell>
                <TableCell align="right">Balance</TableCell>
                <TableCell sx={{ width: 110 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((entry) => {
                const amount = parseFloat(String(entry.amount || 0));
                const paid = parseFloat(String(entry.paid_amount || 0));
                const balance = parseFloat(String(entry.balance_due || 0));
                const voided = isLedgerVoided(entry);
                const uiStatus = getLedgerUiStatus(entry);
                const receiptNumber = (payments[entry.id] || [])
                  .map(payment => payment.receipt_number)
                  .filter(Boolean)[0];
                return (
                  <TableRow
                    key={entry.id}
                    hover
                    sx={{
                      '&:hover .ledger-row-actions': { opacity: 1 },
                      opacity: voided ? 0.6 : 1,
                    }}
                  >
                    <TableCell sx={{ pl: 2.5, py: 1.25 }}>
                      <Typography
                        sx={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3 }}
                      >
                        {entry.description}
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: 11,
                          color: 'text.secondary',
                          mt: 0.25,
                          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                        }}
                      >
                        {entry.folio_number || `#${entry.id}`}
                        {entry.room_number ? ` / Room ${entry.room_number}` : ''}
                        {entry.expense_type ? ` / ${entry.expense_type}` : ''}
                        {receiptNumber ? ` / Receipt ${receiptNumber}` : ''}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary', fontSize: 12 }}>
                      {formatDateForDisplay(entry.posting_date || entry.created_at)}
                    </TableCell>
                    <TableCell sx={{ color: entry.invoice_number ? 'text.primary' : 'text.disabled', fontSize: 12 }}>
                      {entry.invoice_number || 'Not invoiced'}
                    </TableCell>
                    <TableCell>
                      <LedgerStatusBadge status={uiStatus} />
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: 700,
                        fontSize: 13,
                      }}
                    >
                      {formatCurrency(amount)}
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: 700,
                        fontSize: 13,
                        color: paid > 0 ? 'success.main' : 'text.secondary',
                      }}
                    >
                      {formatCurrency(paid)}
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: 700,
                        fontSize: 13,
                        color: balance > 0 ? 'error.main' : 'success.main',
                      }}
                    >
                      {formatCurrency(balance)}
                    </TableCell>
                    <TableCell sx={{ pr: 2 }}>
                      <Box
                        className="ledger-row-actions"
                        sx={{
                          display: 'inline-flex',
                          gap: 0.25,
                          opacity: { xs: 1, md: 0 },
                          transition: 'opacity 120ms',
                        }}
                      >
                        {canRecordPayment(entry) && (
                          <IconButton
                            size="small"
                            title="Record payment"
                            onClick={() => onRecordPayment(entry)}
                          >
                            <PaymentIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        )}
                        {canViewInvoice(entry) && (
                          <IconButton
                            size="small"
                            title="View invoice"
                            onClick={() => onViewInvoice(entry)}
                            disabled={loadingInvoice}
                          >
                            <OpenInNewIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        )}
                        <IconButton
                          size="small"
                          title="Edit entry"
                          onClick={() => onEdit(entry)}
                        >
                          <EditIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                        <IconButton
                          size="small"
                          title="Print receipt"
                          onClick={() => onPrintReceipt(entry)}
                        >
                          <PrintIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                        {canVoid(entry) && (
                          <IconButton
                            size="small"
                            title="Void entry"
                            color="error"
                            onClick={() => onVoid(entry)}
                          >
                            <VoidIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        )}
                      </Box>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <TablePagination
            component="div"
            count={total}
            page={page}
            onPageChange={(_, nextPage) => onPageChange(nextPage)}
            rowsPerPage={pageSize}
            rowsPerPageOptions={[10, 25, 50, 100]}
            onRowsPerPageChange={(event) => {
              onPageSizeChange(parseInt(event.target.value, 10));
            }}
            labelRowsPerPage="Entries per page"
          />
        </TableContainer>
      )}
    </>
  );
};

export default LedgerEntriesTab;
