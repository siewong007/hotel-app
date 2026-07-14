import BlockIcon from '@mui/icons-material/Block';
import {
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { VOUCHER_STATUS_LABELS } from '../constants';
import type { Voucher } from '../types';
import { formatPromotionDate } from '../utils';

interface VoucherAdminTableProps {
  vouchers: Voucher[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  canManage: boolean;
  isRevoking: boolean;
  onRevoke: (voucherId: number, displayCode: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

const statusColor = {
  available: 'success',
  redeemed: 'default',
  revoked: 'error',
} as const;

export function VoucherAdminTable({
  vouchers,
  total,
  page,
  pageSize,
  isLoading,
  canManage,
  isRevoking,
  onRevoke,
  onPageChange,
  onPageSizeChange,
}: VoucherAdminTableProps) {
  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Voucher</TableCell>
              <TableCell>Promotion</TableCell>
              <TableCell>Guest</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Expires</TableCell>
              <TableCell>Source</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {vouchers.map((voucher) => {
              const displayCode = voucher.code_masked ?? voucher.code ?? `#${voucher.id}`;
              const isExpired = Boolean(
                voucher.status === 'available' &&
                  voucher.expires_at &&
                  new Date(voucher.expires_at).getTime() < Date.now()
              );
              return (
                <TableRow key={voucher.id} hover>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{displayCode}</TableCell>
                  <TableCell>{voucher.promotion_name}</TableCell>
                  <TableCell>{voucher.guest_name ?? voucher.guest_id ?? '—'}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={
                        isExpired
                          ? 'Expired'
                          : VOUCHER_STATUS_LABELS[voucher.status] ?? voucher.status
                      }
                      color={isExpired ? 'warning' : statusColor[voucher.status] ?? 'default'}
                    />
                  </TableCell>
                  <TableCell>{formatPromotionDate(voucher.expires_at) ?? 'No expiry'}</TableCell>
                  <TableCell>{voucher.source}</TableCell>
                  <TableCell align="right">
                    {canManage && voucher.status === 'available' && !isExpired ? (
                      <Tooltip title="Revoke voucher">
                        <IconButton
                          size="small"
                          color="error"
                          disabled={isRevoking}
                          onClick={() => onRevoke(voucher.id, displayCode)}
                        >
                          <BlockIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        —
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {vouchers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                  No vouchers found.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={total}
        page={page}
        rowsPerPage={pageSize}
        rowsPerPageOptions={[10, 25, 50]}
        onPageChange={(_, nextPage) => onPageChange(nextPage)}
        onRowsPerPageChange={(event) => onPageSizeChange(Number(event.target.value))}
      />
    </>
  );
}
