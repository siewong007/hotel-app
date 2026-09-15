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
  MoreVert as MoreVertIcon,
  OpenInNewOutlined as OpenFullIcon,
} from '@mui/icons-material';
import { BookingChannelChip, BillingChip, NightAuditChip } from './BookingMetaChips';
import type { BookingWithDetails } from '../../../../types';
import { useCurrency } from '../../../../hooks/useCurrency';
import { useIsPhone } from '../../../../hooks/useIsPhone';
import ActionsMenu from '../../../../components/common/ActionsMenu';
import type { ActionMenuItem } from '../../../../components/common/ActionsMenu';
import { statusLabel, useTranslation } from '../../../../i18n';
import { formatStatusLabel } from '../../../../utils/formatters';
import { isPositiveMoney, toMoneyNumber } from '../../../../utils/money';
import { getHotelSettings } from '../../../../utils/hotelSettings';
import { getBookedViaText, getBookingChannelInfo } from '../../utils/bookingChannel';
import {
  canCheckIn,
  canCheckOut,
  canReactivate,
  canRelease,
  canVoid,
  formatShortDate,
  getBillingChipLabel,
  getBookingBalance,
  getBookingTotal,
  getGuestInitials,
  getNights,
  isEarlyCheckIn,
  isNightAuditInvolved,
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
  /** Drawer mode only — jumps to /bookings/$bookingId. Absent on the detail page. */
  onOpenFullDetails?: (booking: BookingWithDetails) => void;
  /** Drawer mode only — inline quick-edit section rendered between Charges and Actions. */
  quickEdit?: React.ReactNode;
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
  onOpenFullDetails,
  quickEdit,
}) => {
  const { format: formatCurrency } = useCurrency();
  const isPhone = useIsPhone();
  const { t } = useTranslation('bookings');

  // Action availability gates — evaluated once so the desktop button row and
  // the phone grouping stay in lockstep.
  const showCheckIn = canCheckIn(booking);
  const earlyCheckIn = isEarlyCheckIn(booking, getHotelSettings().check_in_time);
  const showCheckOut = canCheckOut(booking);
  // Standalone payment entry is only for pre-arrival bookings
  // (confirmed/pending) that have no invoice yet. Once checked in, out, or
  // completed, payments are recorded inside the invoice (checkout preview /
  // receipt). Locked once fully settled.
  const showPayment = !booking.is_complimentary
    && isPositiveMoney(getBookingBalance(booking))
    && !['checked_in', 'checked_out', 'completed'].includes(booking.status);
  const showInvoice = ['checked_out', 'completed'].includes(booking.status);
  const showRelease = canRelease(booking);
  const showVoid = canVoid(booking);
  const showReactivate = canReactivate(booking);

  // Secondary metadata chips under the folio line — the channel / billing /
  // night-audit markers the phone list rows dropped stay reachable here, on
  // the detail page, at every viewport width.
  const channelInfo = getBookingChannelInfo(booking);
  const billingChipLabel = getBillingChipLabel(booking, t);
  const nightAuditInvolved = isNightAuditInvolved(booking);

  // Phone overflow menu: everything past the lifecycle CTA + Payment/Edit.
  const menuActions: ActionMenuItem[] = [
    {
      id: 'workflow',
      label: t('details.workflow'),
      icon: <HistoryIcon fontSize="small" />,
      onClick: () => onWorkflow(booking),
    },
    {
      id: 'invoice',
      label: t('details.invoice'),
      icon: <ReceiptIcon fontSize="small" />,
      onClick: () => onInvoice(booking),
      hidden: !showInvoice,
    },
    {
      id: 'release',
      label: t('details.releaseRoom'),
      icon: <VoidIcon fontSize="small" />,
      onClick: () => onRelease(booking),
      hidden: !showRelease,
    },
    {
      id: 'reactivate',
      label: t('details.reactivate'),
      icon: <RestoreIcon fontSize="small" />,
      onClick: () => onReactivate(booking),
      hidden: !showReactivate,
    },
    {
      id: 'void',
      label: t('details.void'),
      icon: <VoidIcon fontSize="small" />,
      onClick: () => onVoid(booking),
      destructive: true,
      hidden: !showVoid,
    },
  ];

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
              label={statusLabel(t, 'booking', booking.status)}
              sx={{ bgcolor: `color-mix(in srgb, ${statusDotColor(booking.status)} 12%, transparent)`, color: statusDotColor(booking.status), fontWeight: 900 }}
            />
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
              {onOpenFullDetails && (
                <Tooltip title={t('details.openFullPage')} arrow>
                  <IconButton size="small" aria-label={t('details.openFullPage')} onClick={() => onOpenFullDetails(booking)}>
                    <OpenFullIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              <Tooltip title={t('details.closeAria')} arrow>
                <IconButton size="small" aria-label={t('details.closeAria')} onClick={onClose}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          </Stack>
          <Stack
            direction="row"
            spacing={2}
            sx={{
              alignItems: "center",
              mt: 3
            }}>
            <Box sx={{ width: 58, height: 58, borderRadius: '50%', bgcolor: 'var(--hotel-primary-subtle)', color: 'var(--hotel-primary-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: '1.1rem' }}>
              {getGuestInitials(booking.guest_name)}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" component="h2" sx={{ fontWeight: 900, lineHeight: 1.1 }}>{booking.guest_name}</Typography>
              <Typography
                variant="body2"
                sx={{
                  color: "text.secondary",
                  fontFamily: 'monospace'
                }}>
                {booking.invoice_number || booking.folio_number || booking.booking_number || `#${booking.id}`}
              </Typography>
              {(channelInfo || billingChipLabel || nightAuditInvolved) && (
                <Stack
                  direction="row"
                  spacing={0.75}
                  useFlexGap
                  sx={{
                    flexWrap: "wrap",
                    mt: 0.75
                  }}>
                  {channelInfo && <BookingChannelChip channel={channelInfo} />}
                  {billingChipLabel && <BillingChip label={billingChipLabel} />}
                  {nightAuditInvolved && <NightAuditChip />}
                </Stack>
              )}
            </Box>
          </Stack>
        </Box>

        <>
          <Box sx={{ p: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 900 }}>{t('details.stay')}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 2, alignItems: 'center', mt: 1 }}>
              <Box>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>{t('details.checkIn')}</Typography>
                <Typography variant="subtitle1" component="div" sx={{ fontWeight: 900 }}>{formatShortDate(booking.check_in_date)}</Typography>
              </Box>
              <Box sx={{ textAlign: 'center', color: 'text.secondary' }}>
                <Typography variant="body2" sx={{ fontWeight: 900 }}>{t('details.nightsAbbrev', { count: getNights(booking) })}</Typography>
                <ArrowForwardIcon fontSize="small" />
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>{t('details.checkOut')}</Typography>
                <Typography variant="subtitle1" component="div" sx={{ fontWeight: 900 }}>{formatShortDate(booking.check_out_date)}</Typography>
              </Box>
            </Box>
            <Box sx={{ mt: 2, p: 1.5, borderRadius: 2, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box sx={{ width: 38, height: 38, borderRadius: 1.5, bgcolor: 'background.paper', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <RoomIcon fontSize="small" />
              </Box>
              <Box>
                <Typography variant="subtitle2" component="div" sx={{ fontWeight: 900 }}>{booking.room_type || t('details.roomFallback')}</Typography>
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>{t('details.roomNumber', { number: booking.room_number || '-' })}</Typography>
              </Box>
            </Box>
          </Box>

          <Box sx={{ p: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 900 }}>{t('details.charges')}</Typography>
            <Stack spacing={1.2} sx={{ mt: 1 }}>
              <Stack direction="row" sx={{
                justifyContent: "space-between"
              }}>
                <Typography sx={{
                  color: "text.secondary"
                }}>{t('details.roomNights', { nights: getNights(booking), rate: formatCurrency(toMoneyNumber(booking.price_per_night)) })}</Typography>
                <Typography sx={{ fontWeight: 800 }}>{formatCurrency(getBookingTotal(booking))}</Typography>
              </Stack>
              <Stack direction="row" sx={{
                justifyContent: "space-between"
              }}>
                <Typography sx={{
                  color: "text.secondary"
                }}>{t('details.taxAndFees')}</Typography>
                <Typography sx={{
                  color: "text.secondary"
                }}>{t('details.included')}</Typography>
              </Stack>
              <Divider />
              <Stack direction="row" sx={{
                justifyContent: "space-between"
              }}>
                <Typography variant="subtitle1" component="div">{t('details.total')}</Typography>
                <Typography variant="subtitle1" component="div" sx={{ fontWeight: 900 }}>{formatCurrency(getBookingTotal(booking))}</Typography>
              </Stack>
              <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: isPositiveMoney(getBookingBalance(booking)) ? 'var(--hotel-danger-bg)' : 'var(--hotel-selected)', color: isPositiveMoney(getBookingBalance(booking)) ? 'var(--hotel-danger)' : 'var(--hotel-success)', fontWeight: 900 }}>
                {isPositiveMoney(getBookingBalance(booking))
                  ? t('details.due', { amount: formatCurrency(getBookingBalance(booking)) })
                  : booking.payment_method
                    ? t('details.fullyPaidVia', { method: formatStatusLabel(booking.payment_method) })
                    : t('details.fullyPaid')}
              </Box>
            </Stack>
          </Box>

          {quickEdit}

          <Box sx={{ p: 2.5 }}>
            <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 900 }}>{t('details.actions')}</Typography>
            {isPhone ? (
              // Phone: the first available lifecycle action gets the full-width
              // contained CTA, Payment + Edit stay outlined, and the rest
              // (Workflow, Invoice, Release, Void, Reactivate — same gates as
              // desktop) collapse into an ActionsMenu bottom sheet.
              <Stack spacing={1} sx={{ mt: 1 }}>
                {showCheckIn ? (
                  earlyCheckIn ? (
                    <Tooltip title={t('details.earlyCheckInTooltip', { time: getHotelSettings().check_in_time || '15:00' })} arrow>
                      <Button fullWidth variant="contained" color="success" startIcon={<EarlyCheckInIcon />} onClick={() => onCheckIn(String(booking.id))}>{t('details.earlyCheckIn')}</Button>
                    </Tooltip>
                  ) : (
                    <Button fullWidth variant="contained" color="success" startIcon={<LoginIcon />} onClick={() => onCheckIn(String(booking.id))}>{t('details.checkInAction')}</Button>
                  )
                ) : showCheckOut ? (
                  <Button fullWidth variant="contained" color="warning" startIcon={<CheckOutIcon />} onClick={() => onCheckOut(booking)}>{t('details.checkOutAction')}</Button>
                ) : null}
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  {showPayment && (
                    <Button variant="outlined" color="success" startIcon={<PaymentIcon />} sx={{ flex: 1 }} onClick={() => onPayment(booking)}>{t('details.payment')}</Button>
                  )}
                  {isAdmin && (
                    <Button variant="outlined" startIcon={<EditIcon />} sx={{ flex: 1 }} onClick={() => onEdit(booking)}>{t('details.edit')}</Button>
                  )}
                  <ActionsMenu
                    trigger={
                      <Button variant="outlined" startIcon={<MoreVertIcon />} sx={{ flex: showPayment || isAdmin ? undefined : 1 }}>
                        {t('details.more')}
                      </Button>
                    }
                    actions={menuActions}
                  />
                </Stack>
              </Stack>
            ) : (
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
                  <Tooltip title={t('details.earlyCheckInTooltip', { time: getHotelSettings().check_in_time || '15:00' })} arrow>
                    <Button variant="contained" color="success" startIcon={<EarlyCheckInIcon />} onClick={() => onCheckIn(String(booking.id))}>{t('details.earlyCheckIn')}</Button>
                  </Tooltip>
                ) : (
                  <Button variant="contained" color="success" startIcon={<LoginIcon />} onClick={() => onCheckIn(String(booking.id))}>{t('details.checkInAction')}</Button>
                )
              )}
              {canCheckOut(booking) && (
                <Button variant="contained" color="warning" startIcon={<CheckOutIcon />} onClick={() => onCheckOut(booking)}>{t('details.checkOutAction')}</Button>
              )}
              {/* Standalone payment entry is only for pre-arrival bookings
                  (confirmed/pending) that have no invoice yet. Once checked in,
                  out, or completed, payments are recorded inside the invoice
                  (checkout preview / receipt). Locked once fully settled. */}
              {!booking.is_complimentary
                && isPositiveMoney(getBookingBalance(booking))
                && !['checked_in', 'checked_out', 'completed'].includes(booking.status) && (
                <Button variant="outlined" color="success" startIcon={<PaymentIcon />} onClick={() => onPayment(booking)}>{t('details.payment')}</Button>
              )}
              <Button variant="outlined" startIcon={<HistoryIcon />} onClick={() => onWorkflow(booking)}>{t('details.workflow')}</Button>
              {isAdmin && <Button variant="outlined" startIcon={<EditIcon />} onClick={() => onEdit(booking)}>{t('details.edit')}</Button>}
              {['checked_out', 'completed'].includes(booking.status) && (
                <Button variant="outlined" startIcon={<ReceiptIcon />} onClick={() => onInvoice(booking)}>{t('details.invoice')}</Button>
              )}
              {canRelease(booking) && (
                <Button variant="outlined" color="warning" startIcon={<VoidIcon />} onClick={() => onRelease(booking)}>{t('details.releaseRoom')}</Button>
              )}
              {canVoid(booking) && (
                <Button variant="outlined" color="error" startIcon={<VoidIcon />} onClick={() => onVoid(booking)}>{t('details.void')}</Button>
              )}
              {canReactivate(booking) && (
                <Button variant="outlined" color="success" startIcon={<RestoreIcon />} onClick={() => onReactivate(booking)}>{t('details.reactivate')}</Button>
              )}
            </Stack>
            )}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mt: 2.5 }}>
              <Box>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>{t('details.bookedVia')}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 800, textTransform: 'capitalize' }}>{getBookedViaText(booking, t)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>{t('details.paymentStatus')}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 800 }}>{statusLabel(t, 'payment', booking.payment_status)}</Typography>
              </Box>
            </Box>
          </Box>
        </>
      </>
    </Card>
  );
};

export default BookingDetailsPanel;
