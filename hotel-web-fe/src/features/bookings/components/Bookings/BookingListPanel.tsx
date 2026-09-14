import React from 'react';
import {
  Box,
  Button,
  Chip,
  Divider,
  Pagination,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material';
import {
  SwapVert as SwapVertIcon,
  Bed as BedIcon,
  Public as PublicIcon,
} from '@mui/icons-material';
import type { BookingWithDetails } from '../../../../types';
import { useCurrency } from '../../../../hooks/useCurrency';
import { useIsPhone } from '../../../../hooks/useIsPhone';
import { getBookingStatusText, getPaymentStatusText } from '../../../../utils/bookingUtils';
import { isPositiveMoney } from '../../../../utils/money';
import { getBookingChannelInfo } from '../../utils/bookingChannel';
import {
  formatShortDate,
  getBillingChipLabel,
  getBookingBalance,
  getBookingTotal,
  getGuestInitials,
  getNights,
  isNightAuditInvolved,
  statusDotColor,
  type BookingView,
} from '../../utils/bookingPageUtils';
import type { SortField } from '../../hooks/useBookings';

interface BookingListPagination {
  hasMultiplePages: boolean;
  startItem: number;
  endItem: number;
  totalItems: number;
  totalPages: number;
  currentPage: number;
}

interface BookingListPanelProps {
  bookings: BookingWithDetails[];
  loading: boolean;
  totalBookings: number;
  bookingView: BookingView;
  /** Row click — the page navigates to /bookings/$bookingId. */
  onOpenBooking: (booking: BookingWithDetails) => void;
  sortField: SortField;
  onToggleSort: () => void;
  pagination: BookingListPagination;
  onPageChange: (page: number) => void;
}

interface PhoneBookingRowProps {
  booking: BookingWithDetails;
  balance: number;
  isPaid: boolean;
  formatCurrency: (value: number) => string;
  onOpenBooking: (booking: BookingWithDetails) => void;
}

/**
 * Compact two-line row for phone widths: identity + status on line 1, stay
 * facts on line 2, money on the right. Channel/billing/night-audit chips and
 * the folio reference are intentionally dropped — they stay reachable on the
 * booking detail page. The whole row is the single tap target.
 */
const PhoneBookingRow: React.FC<PhoneBookingRowProps> = ({
  booking,
  balance,
  isPaid,
  formatCurrency,
  onOpenBooking,
}) => (
  <Box
    onClick={() => onOpenBooking(booking)}
    sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 1.5,
      px: 2,
      py: 1.25,
      cursor: 'pointer',
      bgcolor: 'background.paper',
      opacity: booking.status === 'voided' ? 0.55 : 1,
      '&:hover': { bgcolor: 'action.hover' },
      '&:active': { bgcolor: 'action.selected' },
    }}
  >
    <Box sx={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, bgcolor: 'var(--hotel-primary-subtle)', color: 'var(--hotel-primary-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 }}>
      {getGuestInitials(booking.guest_name)}
    </Box>
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, minWidth: 0 }}>
        <Typography variant="subtitle2" noWrap sx={{ fontWeight: 800, lineHeight: 1.3, minWidth: 0 }}>
          {booking.guest_name}
        </Typography>
        <Typography component="span" variant="caption" noWrap sx={{ color: statusDotColor(booking.status), fontWeight: 800, flexShrink: 0 }}>
          • {getBookingStatusText(booking.status)}
        </Typography>
      </Box>
      <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>
        Room {booking.room_number || '-'} · {booking.room_type || 'Room'} · {formatShortDate(booking.check_in_date)} → {formatShortDate(booking.check_out_date)} · {getNights(booking)}N
      </Typography>
    </Box>
    <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{formatCurrency(getBookingTotal(booking))}</Typography>
      {isPositiveMoney(balance) ? (
        <Typography variant="caption" sx={{ color: 'error.main', fontWeight: 800 }}>Due {formatCurrency(balance)}</Typography>
      ) : (
        <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 800 }}>✓ {isPaid ? 'Paid' : getPaymentStatusText(booking.payment_status)}</Typography>
      )}
    </Box>
  </Box>
);

const BookingListPanel: React.FC<BookingListPanelProps> = ({
  bookings,
  loading,
  totalBookings,
  bookingView,
  onOpenBooking,
  sortField,
  onToggleSort,
  pagination,
  onPageChange,
}) => {
  const { format: formatCurrency } = useCurrency();
  const isPhone = useIsPhone();

  return (
    <>
      <Box sx={{ px: 2, py: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            fontWeight: 800
          }}>
          {bookings.length} bookings
        </Typography>
        <Button size="small" endIcon={<SwapVertIcon />} onClick={onToggleSort} sx={{ color: 'text.primary' }}>
          Sort: {sortField === 'guest_name' ? 'Guest' : 'Priority'}
        </Button>
      </Box>

      {loading ? (
        <Stack divider={<Divider />} sx={{ minHeight: 420 }} aria-busy="true" aria-label="Loading bookings">
          {Array.from({ length: 6 }).map((_, index) => (
            <Box
              key={index}
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '44px 1fr', md: '54px 1fr auto auto' },
                gap: 1.75,
                alignItems: 'center',
                px: 2,
                py: 1.75,
              }}
            >
              <Skeleton variant="circular" width={46} height={46} />
              <Box sx={{ minWidth: 0 }}>
                <Skeleton width="55%" height={24} />
                <Skeleton width="80%" height={18} />
              </Box>
              <Box sx={{ gridColumn: { xs: '2 / span 1', md: 'auto' } }}>
                <Skeleton width={90} height={22} />
                <Skeleton width={70} height={18} />
              </Box>
              <Box sx={{ gridColumn: { xs: '2 / span 1', md: 'auto' } }}>
                <Skeleton width={110} height={18} />
              </Box>
            </Box>
          ))}
        </Stack>
      ) : bookings.length === 0 ? (
        <Box
          sx={{
            textAlign: "center",
            py: 6
          }}>
          <Typography variant="h6" sx={{
            color: "text.secondary"
          }}>
            {totalBookings === 0 ? 'No bookings yet' : 'No bookings match your filters'}
          </Typography>
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mt: 1
            }}>
            {totalBookings === 0 ? 'Create your first booking using the New booking button above' : 'Try adjusting your search or filter criteria'}
          </Typography>
        </Box>
      ) : (
        <Stack divider={<Divider />} sx={{ maxHeight: { lg: 'calc(100vh - 430px)' }, minHeight: 420, overflow: 'auto' }}>
          {bookings.map((booking) => {
            const balance = getBookingBalance(booking);
            const isPaid = !isPositiveMoney(balance) && ['paid', 'paid_rate'].includes(String(booking.payment_status || '').toLowerCase());

            if (isPhone) {
              return (
                <PhoneBookingRow
                  key={booking.id}
                  booking={booking}
                  balance={balance}
                  isPaid={isPaid}
                  formatCurrency={formatCurrency}
                  onOpenBooking={onOpenBooking}
                />
              );
            }

            const channelInfo = getBookingChannelInfo(booking);
            const billingChipLabel = getBillingChipLabel(booking);

            return (
              <Box
                key={booking.id}
                onClick={() => onOpenBooking(booking)}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '44px 1fr', md: '54px 1fr auto auto' },
                  gap: 1.75,
                  alignItems: 'center',
                  px: 2,
                  py: 1.75,
                  cursor: 'pointer',
                  bgcolor: 'background.paper',
                  opacity: booking.status === 'voided' ? 0.55 : 1,
                }}
              >
                <Box sx={{ width: 46, height: 46, borderRadius: '50%', bgcolor: 'var(--hotel-primary-subtle)', color: 'var(--hotel-primary-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 }}>
                  {getGuestInitials(booking.guest_name)}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    useFlexGap
                    sx={{
                      alignItems: "center",
                      flexWrap: "wrap"
                    }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 900, lineHeight: 1.15 }}>{booking.guest_name}</Typography>
                    {channelInfo && (
                      <Tooltip title={`Online booking via ${channelInfo.name}`} arrow>
                        <Chip
                          size="small"
                          icon={<PublicIcon />}
                          label={channelInfo.abbreviation}
                          sx={{
                            height: 22,
                            minWidth: 60,
                            maxWidth: 'none',
                            flexShrink: 0,
                            fontWeight: 900,
                            bgcolor: channelInfo.background,
                            color: channelInfo.color,
                            border: `1px solid ${alpha(channelInfo.color, 0.2)}`,
                            '& .MuiChip-icon': {
                              color: channelInfo.color,
                              fontSize: 14,
                              ml: 0.65,
                              mr: -0.35,
                            },
                            '& .MuiChip-label': {
                              px: 0.8,
                              overflow: 'visible',
                            },
                          }}
                        />
                      </Tooltip>
                    )}
                    {billingChipLabel && (
                      <Chip
                        size="small"
                        label={billingChipLabel}
                        sx={{ height: 22, fontWeight: 800 }}
                      />
                    )}
                    <Typography variant="body2" sx={{ color: statusDotColor(booking.status), fontWeight: 800 }}>
                      • {getBookingStatusText(booking.status)}
                    </Typography>
                    {isNightAuditInvolved(booking) && (
                      <Chip size="small" label="Night audit" variant="outlined" sx={{ height: 22, fontWeight: 900 }} />
                    )}
                  </Stack>
                  <Typography
                    variant="body2"
                    sx={{
                      color: "text.secondary",
                      mt: 0.35
                    }}>
                    <BedIcon sx={{ fontSize: 16, verticalAlign: 'text-bottom', mr: 0.5 }} />
                    Room {booking.room_number || '-'} · {booking.room_type || 'Room'} · {formatShortDate(booking.check_in_date)} → {formatShortDate(booking.check_out_date)} · {getNights(booking)}N
                  </Typography>
                </Box>
                <Box sx={{ textAlign: { xs: 'left', md: 'right' }, gridColumn: { xs: '2 / span 1', md: 'auto' } }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>{formatCurrency(getBookingTotal(booking))}</Typography>
                  {isPositiveMoney(balance) ? (
                    <Typography
                      variant="body2"
                      sx={{
                        color: "error.main",
                        fontWeight: 800
                      }}>Due {formatCurrency(balance)}</Typography>
                  ) : (
                    <Typography
                      variant="body2"
                      sx={{
                        color: "success.main",
                        fontWeight: 800
                      }}>✓ {isPaid ? 'Paid' : getPaymentStatusText(booking.payment_status)}</Typography>
                  )}
                </Box>
                <Typography
                  variant="body2"
                  sx={{
                    color: "text.secondary",
                    fontFamily: 'monospace',
                    textAlign: { xs: 'left', md: 'right' },
                    gridColumn: { xs: '2 / span 1', md: 'auto' }
                  }}>
                  {booking.invoice_number || booking.folio_number || `#${booking.id}`}
                </Typography>
              </Box>
            );
          })}
        </Stack>
      )}

      {bookingView === 'all' && pagination.hasMultiplePages && (
        <Stack
          direction="row"
          sx={{
            justifyContent: "space-between",
            alignItems: "center",
            px: 2,
            py: 1.5,
            borderTop: '1px solid',
            borderColor: 'divider'
          }}>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
            Showing {pagination.startItem}-{pagination.endItem} of {pagination.totalItems}
          </Typography>
          <Pagination
            count={pagination.totalPages}
            page={pagination.currentPage}
            onChange={(_, page) => onPageChange(page)}
            color="primary"
            size="small"
            showFirstButton
            showLastButton
          />
        </Stack>
      )}
    </>
  );
};

export default BookingListPanel;
