import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import { GuestPortalDashboardService } from '../api/guestPortalDashboard.service';
import type { GuestPortalBookingSummary } from '../../../types';

const FOREST = '#082B22';
const URGENT = '#A6422B';

interface GuestPortalNotificationBellProps {
  token: string | null;
  onReviewReceipt: () => void;
}

/**
 * Guest alerts currently come from booking data rather than a separate inbox.
 * A receipt request remains in the bell until the guest has uploaded proof, so
 * a time-sensitive payment task cannot be accidentally acknowledged away.
 */
export function GuestPortalNotificationBell({
  token,
  onReviewReceipt,
}: GuestPortalNotificationBellProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [bookings, setBookings] = useState<GuestPortalBookingSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const open = Boolean(anchorEl);

  const receiptRequests = useMemo(
    () => bookings.filter((booking) => (
      Boolean(booking.receipt_request_payment_id) && !booking.receipt_uploaded
    )),
    [bookings],
  );

  const loadNotifications = useCallback(async () => {
    if (!token) {
      setBookings([]);
      setLoadError(false);
      return;
    }

    setIsLoading(true);
    setLoadError(false);
    try {
      const response = await GuestPortalDashboardService.bookings(
        { page: 1, per_page: 100 },
        token,
      );
      setBookings(response.items);
    } catch {
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    const refreshOnFocus = () => void loadNotifications();
    window.addEventListener('focus', refreshOnFocus);
    return () => window.removeEventListener('focus', refreshOnFocus);
  }, [loadNotifications]);

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
    void loadNotifications();
  };

  const handleReviewReceipt = () => {
    setAnchorEl(null);
    onReviewReceipt();
  };

  const pendingCount = receiptRequests.length;
  const buttonLabel = pendingCount > 0
    ? `Notifications; ${pendingCount} receipt ${pendingCount === 1 ? 'needs' : 'need'} your attention`
    : 'Notifications';

  return (
    <>
      <Tooltip title={pendingCount > 0 ? 'Receipt action needed' : 'Notifications'}>
        <IconButton
          onClick={handleOpen}
          aria-label={buttonLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          sx={{
            flexShrink: 0,
            width: 44,
            height: 44,
            color: '#FFFFFF',
            border: pendingCount > 0 ? '1px solid rgba(255, 206, 196, 0.72)' : '1px solid rgba(255,255,255,0.22)',
            bgcolor: pendingCount > 0 ? 'rgba(166,66,43,0.36)' : 'rgba(255,255,255,0.06)',
            '&:hover': { bgcolor: pendingCount > 0 ? 'rgba(166,66,43,0.54)' : 'rgba(255,255,255,0.14)' },
            '@media (prefers-reduced-motion: no-preference)': pendingCount > 0 ? {
              animation: 'guest-notification-pulse 2.4s ease-in-out infinite',
              '@keyframes guest-notification-pulse': {
                '0%, 100%': { boxShadow: '0 0 0 0 rgba(198, 84, 59, 0)' },
                '50%': { boxShadow: '0 0 0 5px rgba(198, 84, 59, 0.25)' },
              },
            } : undefined,
          }}
        >
          <Badge
            badgeContent={pendingCount}
            color="error"
            max={99}
            overlap="circular"
            sx={{ '& .MuiBadge-badge': { fontWeight: 800, border: `2px solid ${FOREST}` } }}
          >
            {pendingCount > 0
              ? <NotificationsActiveOutlinedIcon aria-hidden="true" />
              : <NotificationsNoneOutlinedIcon aria-hidden="true" />}
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { mt: 1, width: 'min(390px, calc(100vw - 24px))', borderRadius: 2.5, overflow: 'hidden' } } }}
      >
        <Box sx={{ px: 2.25, py: 1.75, bgcolor: pendingCount > 0 ? '#FFF3F0' : '#FFFCF6', borderBottom: '1px solid', borderColor: pendingCount > 0 ? '#E6B7AD' : 'divider' }}>
          <Stack direction="row" spacing={1} alignItems="center">
            {pendingCount > 0 ? <ErrorOutlineIcon sx={{ color: URGENT }} aria-hidden="true" /> : null}
            <Box>
              <Typography variant="subtitle1" sx={{ color: FOREST, fontWeight: 800 }}>
                {pendingCount > 0 ? 'Action needed' : 'Notifications'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {pendingCount > 0
                  ? `${pendingCount} receipt ${pendingCount === 1 ? 'request needs' : 'requests need'} a response.`
                  : 'You are all caught up.'}
              </Typography>
            </Box>
          </Stack>
        </Box>

        <Box sx={{ maxHeight: 420, overflowY: 'auto', p: pendingCount > 0 ? 1.25 : 0 }}>
          {isLoading && bookings.length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }} role="status">
              <CircularProgress size={24} />
            </Box>
          ) : loadError ? (
            <Box sx={{ px: 2.25, py: 3 }}>
              <Typography variant="body2" color="text.secondary">
                We could not refresh your notifications. Please try again shortly.
              </Typography>
              <Button size="small" onClick={() => void loadNotifications()} sx={{ mt: 1, px: 0 }}>
                Try again
              </Button>
            </Box>
          ) : pendingCount > 0 ? receiptRequests.map((booking) => (
            <Box
              key={booking.id}
              role="alert"
              sx={{
                p: 2,
                bgcolor: '#FFF8F6',
                border: '1px solid #E6B7AD',
                borderLeft: `4px solid ${URGENT}`,
                borderRadius: 1.5,
                '& + &': { mt: 1.25 },
              }}
            >
              <Stack direction="row" spacing={1.25} alignItems="flex-start">
                <ReceiptLongOutlinedIcon sx={{ color: URGENT, mt: 0.25 }} aria-hidden="true" />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="subtitle2" sx={{ color: FOREST, fontWeight: 800 }}>
                    Receipt required
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.5, color: '#3C2722' }}>
                    Upload the bank-transfer receipt for booking {booking.booking_number} within 24 hours to avoid automatic rejection.
                  </Typography>
                  {booking.receipt_request_message ? (
                    <Typography variant="body2" sx={{ mt: 0.75, color: '#5B4039', fontStyle: 'italic' }}>
                      {booking.receipt_request_message}
                    </Typography>
                  ) : null}
                  <Button
                    variant="contained"
                    color="secondary"
                    onClick={handleReviewReceipt}
                    sx={{ mt: 1.5, minHeight: 40, fontWeight: 800 }}
                  >
                    View request
                  </Button>
                </Box>
              </Stack>
            </Box>
          )) : (
            <Box sx={{ px: 2.25, py: 3.5, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                There are no actions waiting for you.
              </Typography>
            </Box>
          )}
        </Box>
      </Popover>
    </>
  );
}
