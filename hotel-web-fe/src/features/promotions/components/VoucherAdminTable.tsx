import BlockIcon from '@mui/icons-material/Block';
import CheckIcon from '@mui/icons-material/Check';
import ConfirmationNumberOutlinedIcon from '@mui/icons-material/ConfirmationNumberOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import {
  Box,
  Chip,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useState } from 'react';
import EmptyState from '../../../components/common/EmptyState';
import { useTranslation } from '../../../i18n';
import type { Voucher } from '../types';
import {
  formatPromotionDate,
  guestDisplayName,
  relativeExpiryLabel,
  voucherCodeLabel,
  voucherDisplayStatus,
  voucherSourceLabel,
} from '../utils';
import { VoucherStatusChip } from './VoucherStatusChip';

interface VoucherAdminTableProps {
  vouchers: Voucher[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  canManage: boolean;
  isRevoking: boolean;
  onView: (voucher: Voucher) => void;
  onRevoke: (voucherId: number, displayCode: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

const COLUMN_COUNT = 8;
const SKELETON_ROWS = 5;

function CodeCell({ voucher }: { voucher: Voucher }) {
  const { t } = useTranslation('promotions');
  const [copied, setCopied] = useState(false);
  const label = voucherCodeLabel(voucher);

  const copy = async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(label);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (non-secure context) — nothing useful to show.
    }
  };

  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      <Chip
        size="small"
        variant="outlined"
        label={label}
        sx={{
          height: 24,
          fontFamily: 'monospace',
          letterSpacing: '0.04em',
          '& .MuiChip-label': { px: 0.75 },
        }}
      />
      <Tooltip title={copied ? t('vouchers.copied') : t('vouchers.copyCode')}>
        <IconButton
          size="small"
          aria-label={copied ? t('vouchers.copied') : t('vouchers.copyCodeAria', { code: label })}
          onClick={copy}
        >
          {copied ? (
            <CheckIcon fontSize="small" color="success" />
          ) : (
            <ContentCopyIcon sx={{ fontSize: 16 }} />
          )}
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

function ExpiryCell({ voucher }: { voucher: Voucher }) {
  const { t } = useTranslation('promotions');
  const expired = voucherDisplayStatus(voucher) === 'expired';
  const relative = relativeExpiryLabel(voucher.expires_at, t);
  return (
    <Box>
      <Typography variant="body2">
        {formatPromotionDate(voucher.expires_at) ?? '—'}
      </Typography>
      {relative ? (
        <Typography
          variant="caption"
          sx={{ color: expired ? 'error.main' : 'text.secondary' }}
        >
          {relative}
        </Typography>
      ) : null}
    </Box>
  );
}

function VoucherCardItem({
  voucher,
  onView,
}: {
  voucher: Voucher;
  onView: (voucher: Voucher) => void;
}) {
  const { t } = useTranslation('promotions');
  return (
    <Box
      onClick={() => onView(voucher)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onView(voucher);
        }
      }}
      sx={{
        p: 2,
        borderBottom: 1,
        borderColor: 'divider',
        cursor: 'pointer',
        '&:last-child': { borderBottom: 0 },
        '&:hover': { bgcolor: 'action.hover' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
      }}
    >
      <Stack
        direction="row"
        sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
      >
        <CodeCell voucher={voucher} />
        <VoucherStatusChip voucher={voucher} />
      </Stack>
      <Stack spacing={0.25} sx={{ mt: 1.25 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {guestDisplayName(voucher, t)}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {voucher.promotion_name}
        </Typography>
        <Typography
          variant="caption"
          sx={{
            color:
              voucherDisplayStatus(voucher) === 'expired'
                ? 'error.main'
                : 'text.secondary',
          }}
        >
          {relativeExpiryLabel(voucher.expires_at, t)}
        </Typography>
      </Stack>
    </Box>
  );
}

export function VoucherAdminTable({
  vouchers,
  total,
  page,
  pageSize,
  isLoading,
  canManage,
  isRevoking,
  onView,
  onRevoke,
  onPageChange,
  onPageSizeChange,
}: VoucherAdminTableProps) {
  const { t, tOr } = useTranslation('promotions');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const emptyState = (
    <EmptyState
      icon={<ConfirmationNumberOutlinedIcon />}
      title={t('vouchers.empty')}
      description={t('vouchers.emptyHint')}
    />
  );

  const pagination = (
    <TablePagination
      component="div"
      count={total}
      page={page}
      rowsPerPage={pageSize}
      rowsPerPageOptions={[10, 25, 50]}
      onPageChange={(_, nextPage) => onPageChange(nextPage)}
      onRowsPerPageChange={(event) =>
        onPageSizeChange(Number(event.target.value))
      }
    />
  );

  if (isMobile) {
    return (
      <>
        <Box aria-busy={isLoading || undefined}>
          {isLoading ? (
            Array.from({ length: 4 }).map((_, index) => (
              <Paper
                key={`voucher-loading-${index}`}
                variant="outlined"
                sx={{ p: 2, mb: 1 }}
              >
                <Skeleton variant="text" width="55%" sx={{ fontSize: '1rem' }} />
                <Skeleton variant="text" width="80%" />
                <Skeleton variant="text" width="40%" />
              </Paper>
            ))
          ) : vouchers.length === 0 ? (
            emptyState
          ) : (
            vouchers.map((voucher) => (
              <VoucherCardItem
                key={voucher.id}
                voucher={voucher}
                onView={onView}
              />
            ))
          )}
        </Box>
        {pagination}
      </>
    );
  }

  return (
    <>
      <TableContainer>
        <Table size="small" sx={{ minWidth: 960 }} aria-busy={isLoading || undefined}>
          <TableHead>
            <TableRow>
              <TableCell>{t('vouchers.colVoucher')}</TableCell>
              <TableCell>{t('vouchers.colOffer')}</TableCell>
              <TableCell>{t('vouchers.colGuest')}</TableCell>
              <TableCell>{t('vouchers.colStatus')}</TableCell>
              <TableCell>{t('vouchers.colExpires')}</TableCell>
              <TableCell>{t('vouchers.colSource')}</TableCell>
              <TableCell>{t('vouchers.colIssued')}</TableCell>
              <TableCell align="right">{t('vouchers.colActions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              Array.from({ length: SKELETON_ROWS }).map((_, rowIndex) => (
                <TableRow key={`voucher-loading-${rowIndex}`}>
                  {Array.from({ length: COLUMN_COUNT }).map((_, colIndex) => (
                    <TableCell key={`voucher-loading-cell-${colIndex}`}>
                      <Skeleton
                        variant="text"
                        width={`${88 - ((rowIndex + colIndex) % 3) * 16}%`}
                        sx={{ fontSize: '0.9rem' }}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : vouchers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} sx={{ borderBottom: 0 }}>
                  {emptyState}
                </TableCell>
              </TableRow>
            ) : (
              vouchers.map((voucher) => {
                const displayCode = voucherCodeLabel(voucher);
                const canRevoke =
                  canManage &&
                  voucher.status === 'available' &&
                  voucherDisplayStatus(voucher) !== 'expired';
                return (
                  <TableRow
                    key={voucher.id}
                    hover
                    onClick={() => onView(voucher)}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell>
                      <CodeCell voucher={voucher} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {voucher.promotion_name}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{ color: 'text.secondary' }}
                      >
                        {voucher.promotion_slug}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {guestDisplayName(voucher, t)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <VoucherStatusChip voucher={voucher} />
                    </TableCell>
                    <TableCell>
                      <ExpiryCell voucher={voucher} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {voucherSourceLabel(voucher.source, tOr)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {formatPromotionDate(voucher.created_at) ?? '—'}
                      </Typography>
                    </TableCell>
                    <TableCell
                      align="right"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Stack
                        direction="row"
                        spacing={0.25}
                        sx={{ justifyContent: 'flex-end' }}
                      >
                        <Tooltip title={t('vouchers.viewDetails')}>
                          <IconButton
                            size="small"
                            aria-label={t('vouchers.viewVoucherAria', { code: displayCode })}
                            onClick={() => onView(voucher)}
                          >
                            <VisibilityOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {canRevoke ? (
                          <Tooltip title={t('vouchers.revokeVoucher')}>
                            <IconButton
                              size="small"
                              color="error"
                              disabled={isRevoking}
                              aria-label={t('vouchers.revokeVoucher')}
                              onClick={() =>
                                onRevoke(voucher.id, displayCode)
                              }
                            >
                              <BlockIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        ) : null}
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {pagination}
    </>
  );
}
