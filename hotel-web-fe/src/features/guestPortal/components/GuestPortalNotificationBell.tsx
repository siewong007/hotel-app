import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import { GuestPortalDashboardService } from '../api/guestPortalDashboard.service';
import { GUEST_BRAND } from '../theme/guestPortalTheme';
import { guestErrorMessage } from '../utils/feedback';
import { useTranslation } from '../../../i18n';
import type { GuestPortalBookingSummary } from '../../../types';

const URGENT = 'var(--hotel-danger)';

interface GuestPortalNotificationBellProps {
  token: string | null;
}

/**
 * Guest alerts currently come from booking data rather than a separate inbox.
 * A receipt request remains in the bell until the guest has uploaded proof, so
 * a time-sensitive payment task cannot be accidentally acknowledged away.
 */
export function GuestPortalNotificationBell({
  token,
}: GuestPortalNotificationBellProps) {
  const { t } = useTranslation('guestPortal');
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [bookings, setBookings] = useState<GuestPortalBookingSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [receiptRequest, setReceiptRequest] = useState<GuestPortalBookingSummary | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSucceeded, setUploadSucceeded] = useState(false);
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

  const handleReviewReceipt = (booking: GuestPortalBookingSummary) => {
    setAnchorEl(null);
    setReceiptRequest(booking);
    setReceiptFile(null);
    setUploadError(null);
    setUploadSucceeded(false);
  };

  const closeReceiptRequest = () => {
    if (isUploading) return;
    setReceiptRequest(null);
    setReceiptFile(null);
    setUploadError(null);
    setUploadSucceeded(false);
  };

  const handleReceiptFileChange = (file: File | null) => {
    setUploadError(null);
    if (!file) {
      setReceiptFile(null);
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setReceiptFile(null);
      setUploadError(t('notifications.receiptTooLarge'));
      return;
    }

    setReceiptFile(file);
  };

  const uploadReceipt = async () => {
    if (!receiptRequest?.receipt_request_payment_id || !receiptFile) return;

    setIsUploading(true);
    setUploadError(null);
    try {
      await GuestPortalDashboardService.uploadPaymentReceipt(
        receiptRequest.receipt_request_payment_id,
        receiptFile,
        token ?? undefined,
      );
      setReceiptFile(null);
      setUploadSucceeded(true);
      await loadNotifications();
    } catch (error) {
      setUploadError(guestErrorMessage(error, t('notifications.uploadFailed')));
    } finally {
      setIsUploading(false);
    }
  };

  const pendingCount = receiptRequests.length;
  const buttonLabel = pendingCount > 0
    ? t('notifications.badgeLabel', { count: pendingCount })
    : t('shell.notifications');

  return (
    <>
      <Tooltip title={pendingCount > 0 ? t('notifications.actionNeededTooltip') : t('shell.notifications')}>
        <IconButton
          onClick={handleOpen}
          aria-label={buttonLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          sx={{
            flexShrink: 0,
            width: 44,
            height: 44,
            color: 'var(--hotel-text)',
            border: pendingCount > 0 ? '1px solid var(--hotel-danger-border)' : '1px solid var(--hotel-border-strong)',
            bgcolor: pendingCount > 0 ? 'var(--hotel-danger-bg)' : 'var(--hotel-hover)',
            '&:hover': { bgcolor: pendingCount > 0 ? 'color-mix(in srgb, var(--hotel-danger) 24%, transparent)' : 'var(--hotel-active)' },
            '@media (prefers-reduced-motion: no-preference)': pendingCount > 0 ? {
              animation: 'guest-notification-pulse 2.4s ease-in-out infinite',
              '@keyframes guest-notification-pulse': {
                '0%, 100%': { boxShadow: '0 0 0 0 color-mix(in srgb, var(--hotel-danger) 0%, transparent)' },
                '50%': { boxShadow: '0 0 0 5px color-mix(in srgb, var(--hotel-danger) 28%, transparent)' },
              },
            } : undefined,
          }}
        >
          <Badge
            badgeContent={pendingCount}
            color="error"
            max={99}
            overlap="circular"
            sx={{ '& .MuiBadge-badge': { fontWeight: 800, border: `2px solid ${GUEST_BRAND.bg}` } }}
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
        <Box sx={{ px: 2.25, py: 1.75, bgcolor: pendingCount > 0 ? 'var(--hotel-danger-bg)' : 'var(--hotel-surface-overlay)', borderBottom: '1px solid', borderColor: pendingCount > 0 ? 'var(--hotel-danger-border)' : 'divider' }}>
          <Stack direction="row" spacing={1} sx={{
            alignItems: "center"
          }}>
            {pendingCount > 0 ? <ErrorOutlineIcon sx={{ color: URGENT }} aria-hidden="true" /> : null}
            <Box>
              <Typography variant="subtitle1" sx={{ color: 'var(--hotel-text)', fontWeight: 800 }}>
                {pendingCount > 0 ? t('notifications.actionNeeded') : t('shell.notifications')}
              </Typography>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                {pendingCount > 0
                  ? t('notifications.pendingSummary', { count: pendingCount })
                  : t('notifications.caughtUp')}
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
            <Box sx={{ px: 2.25, py: 3 }} role="alert">
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                {t('notifications.refreshFailed')}
              </Typography>
              <Button size="small" onClick={() => void loadNotifications()} sx={{ mt: 1, px: 0 }}>
                {t('common:actions.retry')}
              </Button>
            </Box>
          ) : pendingCount > 0 ? receiptRequests.map((booking) => (
            <Box
              key={booking.id}
              role="alert"
              sx={{
                p: 2,
                bgcolor: 'var(--hotel-danger-bg)',
                border: '1px solid var(--hotel-danger-border)',
                borderLeft: `4px solid ${URGENT}`,
                borderRadius: 1.5,
                '& + &': { mt: 1.25 },
              }}
            >
              <Stack direction="row" spacing={1.25} sx={{
                alignItems: "flex-start"
              }}>
                <ReceiptLongOutlinedIcon sx={{ color: URGENT, mt: 0.25 }} aria-hidden="true" />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="subtitle2" sx={{ color: 'var(--hotel-text)', fontWeight: 800 }}>
                    {t('notifications.receiptRequired')}
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.5, color: 'var(--hotel-text)' }}>
                    {t('notifications.receiptBody', { number: booking.booking_number })}
                  </Typography>
                  {booking.receipt_request_message ? (
                    <Typography variant="body2" sx={{ mt: 0.75, color: 'var(--hotel-text-secondary)', fontStyle: 'italic' }}>
                      {booking.receipt_request_message}
                    </Typography>
                  ) : null}
                  <Button
                    variant="contained"
                    color="error"
                    onClick={() => handleReviewReceipt(booking)}
                    sx={{ mt: 1.5, minHeight: 40, fontWeight: 800 }}
                  >
                    {t('notifications.viewRequest')}
                  </Button>
                </Box>
              </Stack>
            </Box>
          )) : (
            <Box sx={{ px: 2.25, py: 3.5, textAlign: 'center' }}>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                {t('notifications.empty')}
              </Typography>
            </Box>
          )}
        </Box>
      </Popover>
      <Dialog
        open={Boolean(receiptRequest)}
        onClose={closeReceiptRequest}
        fullWidth
        maxWidth="xs"
        aria-labelledby="receipt-upload-request-title"
      >
        <DialogTitle id="receipt-upload-request-title">{t('notifications.uploadTitle')}</DialogTitle>
        <DialogContent dividers>
          {uploadSucceeded ? (
            <Typography sx={{
              color: "success.main"
            }}>
              {t('notifications.uploadedBody')}
            </Typography>
          ) : (
            <Stack spacing={1.5}>
              <Typography>
                {t('notifications.uploadLeadPre')} <strong>{receiptRequest?.booking_number}</strong>.
              </Typography>
              {receiptRequest?.receipt_request_message ? (
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>
                  {receiptRequest.receipt_request_message}
                </Typography>
              ) : null}
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                {t('notifications.uploadHint')}
              </Typography>
              <Button component="label" variant="outlined" disabled={isUploading}>
                {receiptFile ? receiptFile.name : t('notifications.uploadChoose')}
                <input
                  hidden
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  aria-label={t('notifications.uploadSelectAria')}
                  onChange={(event) => handleReceiptFileChange(event.target.files?.[0] ?? null)}
                />
              </Button>
              {uploadError ? <Typography color="error" role="alert">{uploadError}</Typography> : null}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeReceiptRequest} disabled={isUploading}>
            {uploadSucceeded ? t('notifications.done') : t('common:actions.cancel')}
          </Button>
          {!uploadSucceeded ? (
            <Button
              variant="contained"
              onClick={() => void uploadReceipt()}
              disabled={!receiptFile || isUploading}
            >
              {isUploading ? t('notifications.uploading') : t('notifications.uploadButton')}
            </Button>
          ) : null}
        </DialogActions>
      </Dialog>
    </>
  );
}
