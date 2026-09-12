import React from 'react';
import {
  Box,
  Button,
  Card,
  Chip,
  Divider,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material';
import {
  ExitToApp as CheckOutIcon,
  ArrowForward as ArrowForwardIcon,
  Payment as PaymentIcon,
  Receipt as ReceiptIcon,
  Block as VoidIcon,
  Login as LoginIcon,
  MoreTime as EarlyCheckInIcon,
  Restore as RestoreIcon,
  History as HistoryIcon,
  Edit as EditIcon,
  Close as CloseIcon,
  MeetingRoom as RoomIcon,
} from '@mui/icons-material';
import type { BookingWithDetails } from '../../../../types';
import { useCurrency } from '../../../../hooks/useCurrency';
import { getBookingStatusText, getPaymentStatusText } from '../../../../utils/bookingUtils';
import { formatStatusLabel } from '../../../../utils/formatters';
import { isPositiveMoney, toMoneyNumber } from '../../../../utils/money';
import { getHotelSettings } from '../../../../utils/hotelSettings';
import { getBookedViaText } from '../../utils/bookingChannel';
import {
  canCheckIn,
  canCheckOut,
  canReactivate,
  canRelease,
  canVoid,
  formatShortDate,
  getBookingBalance,
  getBookingTotal,
  getGuestInitials,
  getNights,
  isEarlyCheckIn,
  statusDotColor,
} from '../../utils/bookingPageUtils';

interface BookingDetailsPanelProps {
  booking: BookingWithDetails;
  isAdmin: boolean;
  onClose: () => void;
  onCheckIn: (bookingId: string) => void;
  onCheckOut: (booking: BookingWithDetails) => void;
  onPayment: (booking: BookingWithDetails) => void;
  onWorkflow: (booking: BookingWithDetails) => void;
  onEdit: (booking: BookingWithDetails) => void;
  onInvoice: (booking: BookingWithDetails) => void;
  onRelease: (booking: BookingWithDetails) => void;
  onVoid: (booking: BookingWithDetails) => void;
  onReactivate: (booking: BookingWithDetails) => void;
}

const BookingDetailsPanel: React.FC<BookingDetailsPanelProps> = ({
  booking,
  isAdmin,
  onClose,
  onCheckIn,
  onCheckOut,
  onPayment,
  onWorkflow,
  onEdit,
  onInvoice,
  onRelease,
  onVoid,
  onReactivate,
}) => {
  const { format: formatCurrency } = useCurrency();

  return (
    <Card elevation={0} sx={{ height: '100%', minHeight: 520, overflow: 'hidden' }}>
      <>
        <Box sx={{ p: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Stack
            direction="row"
            spacing={1}
            sx={{
              justifyContent: "space-between",
              alignItems: "flex-start"
            }}>
            <Chip
              size="small"
              label={getBookingStatusText(booking.status)}
              sx={{ bgcolor: alpha(statusDotColor(booking.status), 0.12), color: statusDotColor(booking.status), fontWeight: 900 }}
            />
            <Tooltip title="Close details" arrow>
              <IconButton size="small" onClick={onClose}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
          <Stack
            direction="row"
            spacing={2}
            sx={{
              alignItems: "center",
              mt: 3
            }}>
            <Box sx={{ width: 58, height: 58, borderRadius: '50%', bgcolor: alpha('#2f6f52', 0.14), color: '#245a42', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: '1.1rem' }}>
              {getGuestInitials(booking.guest_name)}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" sx={{ fontWeight: 900, lineHeight: 1.1 }}>{booking.guest_name}</Typography>
              <Typography
                variant="body2"
                sx={{
                  color: "text.secondary",
                  fontFamily: 'monospace'
                }}>
                {booking.invoice_number || booking.folio_number || booking.booking_number || `#${booking.id}`}
              </Typography>
            </Box>
          </Stack>
        </Box>

        <>
          <Box sx={{ p: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 900 }}>Stay</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 2, alignItems: 'center', mt: 1 }}>
              <Box>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>Check-in</Typography>
                <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>{formatShortDate(booking.check_in_date)}</Typography>
              </Box>
              <Box sx={{ textAlign: 'center', color: 'text.secondary' }}>
                <Typography variant="body2" sx={{ fontWeight: 900 }}>{getNights(booking)}N</Typography>
                <ArrowForwardIcon fontSize="small" />
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>Check-out</Typography>
                <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>{formatShortDate(booking.check_out_date)}</Typography>
              </Box>
            </Box>
            <Box sx={{ mt: 2, p: 1.5, borderRadius: 2, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box sx={{ width: 38, height: 38, borderRadius: 1.5, bgcolor: 'background.paper', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <RoomIcon fontSize="small" />
              </Box>
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>{booking.room_type || 'Room'}</Typography>
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>Room {booking.room_number || '-'}</Typography>
              </Box>
            </Box>
          </Box>

          <Box sx={{ p: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 900 }}>Charges</Typography>
            <Stack spacing={1.2} sx={{ mt: 1 }}>
              <Stack direction="row" sx={{
                justifyContent: "space-between"
              }}>
                <Typography sx={{
                  color: "text.secondary"
                }}>Room · {getNights(booking)} x {formatCurrency(toMoneyNumber(booking.price_per_night))}</Typography>
                <Typography sx={{ fontWeight: 800 }}>{formatCurrency(getBookingTotal(booking))}</Typography>
              </Stack>
              <Stack direction="row" sx={{
                justifyContent: "space-between"
              }}>
                <Typography sx={{
                  color: "text.secondary"
                }}>Tax & fees</Typography>
                <Typography sx={{
                  color: "text.secondary"
                }}>Included</Typography>
              </Stack>
              <Divider />
              <Stack direction="row" sx={{
                justifyContent: "space-between"
              }}>
                <Typography variant="subtitle1">Total</Typography>
                <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>{formatCurrency(getBookingTotal(booking))}</Typography>
              </Stack>
              <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: isPositiveMoney(getBookingBalance(booking)) ? alpha('#c43d32', 0.08) : alpha('#2f6f52', 0.1), color: isPositiveMoney(getBookingBalance(booking)) ? '#c43d32' : '#2f6f52', fontWeight: 900 }}>
                {isPositiveMoney(getBookingBalance(booking))
                  ? `Due ${formatCurrency(getBookingBalance(booking))}`
                  : `✓ Fully paid${booking.payment_method ? ` via ${formatStatusLabel(booking.payment_method)}` : ''}`}
              </Box>
            </Stack>
          </Box>

          <Box sx={{ p: 2.5 }}>
            <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 900 }}>Actions</Typography>
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{
                flexWrap: "wrap",
                mt: 1
              }}>
              {canCheckIn(booking) && (
                isEarlyCheckIn(booking, getHotelSettings().check_in_time) ? (
                  <Tooltip title={`Early check-in — before the configured ${getHotelSettings().check_in_time || '15:00'} check-in time`} arrow>
                    <Button variant="contained" color="success" startIcon={<EarlyCheckInIcon />} onClick={() => onCheckIn(String(booking.id))}>Early check-in</Button>
                  </Tooltip>
                ) : (
                  <Button variant="contained" color="success" startIcon={<LoginIcon />} onClick={() => onCheckIn(String(booking.id))}>Check in</Button>
                )
              )}
              {canCheckOut(booking) && (
                <Button variant="contained" color="warning" startIcon={<CheckOutIcon />} onClick={() => onCheckOut(booking)}>Check out</Button>
              )}
              {/* Standalone payment entry is only for pre-arrival bookings
                  (confirmed/pending) that have no invoice yet. Once checked in,
                  out, or completed, payments are recorded inside the invoice
                  (checkout preview / receipt). Locked once fully settled. */}
              {!booking.is_complimentary
                && isPositiveMoney(getBookingBalance(booking))
                && !['checked_in', 'checked_out', 'completed'].includes(booking.status) && (
                <Button variant="outlined" color="success" startIcon={<PaymentIcon />} onClick={() => onPayment(booking)}>Payment</Button>
              )}
              <Button variant="outlined" startIcon={<HistoryIcon />} onClick={() => onWorkflow(booking)}>Workflow</Button>
              {isAdmin && <Button variant="outlined" startIcon={<EditIcon />} onClick={() => onEdit(booking)}>Edit</Button>}
              {['checked_out', 'completed'].includes(booking.status) && (
                <Button variant="outlined" startIcon={<ReceiptIcon />} onClick={() => onInvoice(booking)}>Invoice</Button>
              )}
              {canRelease(booking) && (
                <Button variant="outlined" color="warning" startIcon={<VoidIcon />} onClick={() => onRelease(booking)}>Release room</Button>
              )}
              {canVoid(booking) && (
                <Button variant="outlined" color="error" startIcon={<VoidIcon />} onClick={() => onVoid(booking)}>Void</Button>
              )}
              {canReactivate(booking) && (
                <Button variant="outlined" color="success" startIcon={<RestoreIcon />} onClick={() => onReactivate(booking)}>Reactivate</Button>
              )}
            </Stack>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mt: 2.5 }}>
              <Box>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>Booked via</Typography>
                <Typography variant="body2" sx={{ fontWeight: 800, textTransform: 'capitalize' }}>{getBookedViaText(booking)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>Payment</Typography>
                <Typography variant="body2" sx={{ fontWeight: 800 }}>{getPaymentStatusText(booking.payment_status)}</Typography>
              </Box>
            </Box>
          </Box>
        </>
      </>
    </Card>
  );
};

export default BookingDetailsPanel;
