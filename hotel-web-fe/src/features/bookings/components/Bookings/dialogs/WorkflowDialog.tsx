import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import {
  ExitToApp as CheckOutIcon,
  Payment as PaymentIcon,
  Block as VoidIcon,
  Login as LoginIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import { LogoLoader } from '../../../../../components';
import type { BookingTimelineEntry, BookingWithDetails, PaymentWorkflowSummary } from '../../../../../types';
import { useCurrency } from '../../../../../hooks/useCurrency';
import { statusLabel, useTranslation } from '../../../../../i18n';
import { formatHotelDateTime } from '../../../../../utils/date';
import { compareMoney, isPositiveMoney, toMoneyNumber } from '../../../../../utils/money';
import { Link } from '../../../../../router';

interface WorkflowDialogProps {
  open: boolean;
  booking: BookingWithDetails | null;
  summary: PaymentWorkflowSummary | null;
  timeline: BookingTimelineEntry[];
  loading: boolean;
  onClose: () => void;
}

const getWorkflowEventIndicator = (event: BookingTimelineEntry, t: (key: string) => string) => {
  const source = (event.source || '').toLowerCase();
  const eventType = (event.event_type || '').toLowerCase();
  const statusTo = (event.status_to || '').toLowerCase();
  const title = (event.title || '').toLowerCase();

  if (
    eventType.includes('void') ||
    eventType.includes('checkout') ||
    statusTo === 'voided' ||
    statusTo === 'checked_out' ||
    statusTo === 'completed' ||
    title.includes('void') ||
    title.includes('checked out')
  ) {
    return {
      label: statusTo === 'voided' || eventType.includes('void') || title.includes('void') ? t('workflow.event.void') : t('workflow.event.checkout'),
      color: 'var(--hotel-danger)',
      backgroundColor: 'var(--hotel-danger-bg)',
      borderColor: 'var(--hotel-danger-border)',
      icon: eventType.includes('void') || statusTo === 'voided' ? <VoidIcon fontSize="small" /> : <CheckOutIcon fontSize="small" />,
    };
  }

  if (
    eventType.includes('check_in') ||
    eventType.includes('check-in') ||
    statusTo === 'checked_in' ||
    title.includes('checked in')
  ) {
    return {
      label: t('workflow.event.checkIn'),
      color: 'var(--hotel-warning)',
      backgroundColor: 'var(--hotel-warning-bg)',
      borderColor: 'var(--hotel-warning-border)',
      icon: <LoginIcon fontSize="small" />,
    };
  }

  if (source === 'payments') {
    return {
      label: t('workflow.event.payment'),
      color: 'var(--hotel-success)',
      backgroundColor: 'var(--hotel-success-bg)',
      borderColor: 'var(--hotel-success-border)',
      icon: <PaymentIcon fontSize="small" />,
    };
  }

  return {
    label: t('workflow.event.update'),
    color: 'var(--hotel-info)',
    backgroundColor: 'var(--hotel-info-bg)',
    borderColor: 'var(--hotel-info-border)',
    icon: <EditIcon fontSize="small" />,
  };
};

const WorkflowDialog: React.FC<WorkflowDialogProps> = ({ open, booking, summary, timeline, loading, onClose }) => {
  const { t } = useTranslation('bookings');
  const { format: formatCurrency } = useCurrency();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>
        {t('workflow.title', { id: booking?.booking_number || booking?.folio_number || `#${booking?.id}` })}
      </DialogTitle>
      <DialogContent dividers>
        {loading ? (
          <LogoLoader variant="page" minHeight={120} />
        ) : (
          <Stack spacing={2.5}>
            {summary && (
              <Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 1.5 }}>
                  <Box>
                    <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>{t('workflow.total')}</Typography>
                    <Typography variant="subtitle2">{formatCurrency(toMoneyNumber(summary.total_amount))}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>{t('workflow.paid')}</Typography>
                    <Typography variant="subtitle2" sx={{
                      color: "success.main"
                    }}>{formatCurrency(toMoneyNumber(summary.total_paid))}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>{t('workflow.balance')}</Typography>
                    <Typography variant="subtitle2" color={isPositiveMoney(summary.balance_due) ? 'warning.main' : 'success.main'}>
                      {formatCurrency(toMoneyNumber(summary.balance_due))}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>{t('workflow.refunded')}</Typography>
                    <Typography variant="subtitle2" sx={{
                      color: "info.main"
                    }}>{formatCurrency(toMoneyNumber(summary.total_refunded))}</Typography>
                  </Box>
                </Box>
                <Box sx={{ mt: 1.5, display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Chip size="small" color="primary" label={summary.next_action} />
                  <Chip size="small" variant="outlined" label={statusLabel(t, 'payment', summary.payment_status)} />
                </Box>
                {summary.warnings.length > 0 && (
                  <Alert severity="warning" sx={{ mt: 1.5 }}>
                    {summary.warnings.join(' / ')}
                  </Alert>
                )}
              </Box>
            )}

            <Divider />

            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, gap: 1, flexDirection: { xs: 'column', sm: 'row' }, mb: 1 }}>
                <Typography variant="subtitle2">{t('workflow.timeline')}</Typography>
                <Stack direction="row" spacing={0.75} useFlexGap sx={{
                  flexWrap: "wrap"
                }}>
                  {[
                    { label: t('workflow.event.update'), color: 'var(--hotel-info)' },
                    { label: t('workflow.event.payment'), color: 'var(--hotel-success)' },
                    { label: t('workflow.event.checkIn'), color: 'var(--hotel-warning)' },
                    { label: t('workflow.event.checkoutVoid'), color: 'var(--hotel-danger)' },
                  ].map((item) => (
                    <Chip
                      key={item.label}
                      size="small"
                      variant="outlined"
                      label={item.label}
                      sx={{
                        height: 24,
                        fontWeight: 700,
                        borderColor: item.color,
                        color: item.color,
                        bgcolor: `color-mix(in srgb, ${item.color} 8%, transparent)`,
                        '& .MuiChip-label': { px: 1 },
                      }}
                    />
                  ))}
                </Stack>
              </Box>
              {timeline.length === 0 ? (
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>{t('workflow.empty')}</Typography>
              ) : (
                <Stack spacing={1.25}>
                  {timeline.map((event) => {
                    const indicator = getWorkflowEventIndicator(event, t);

                    return (
                      <Box
                        key={`${event.source}-${event.id}`}
                        sx={{
                          display: 'flex',
                          gap: 1.5,
                          p: 1.25,
                          border: '1px solid',
                          borderColor: indicator.borderColor,
                          borderRadius: 1.5,
                          bgcolor: indicator.backgroundColor,
                        }}
                      >
                        <Box
                          sx={{
                            width: 30,
                            height: 30,
                            borderRadius: '50%',
                            bgcolor: `color-mix(in srgb, ${indicator.color} 18%, transparent)`,
                            color: indicator.color,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flex: '0 0 auto',
                          }}
                        >
                          {indicator.icon}
                        </Box>
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                            <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary' }}>
                              {event.title}
                              {event.amount && compareMoney(event.amount, 0) !== 0 && (
                                <Typography component="span" variant="body2" sx={{
                                  color: "text.secondary"
                                }}>
                                  {' '}({formatCurrency(toMoneyNumber(event.amount))})
                                </Typography>
                              )}
                            </Typography>
                            <Chip
                              size="small"
                              label={indicator.label}
                              sx={{
                                height: 22,
                                bgcolor: `color-mix(in srgb, ${indicator.color} 12%, transparent)`,
                                color: indicator.color,
                                border: `1px solid color-mix(in srgb, ${indicator.color} 32%, transparent)`,
                                fontWeight: 800,
                                '& .MuiChip-label': { px: 0.9 },
                              }}
                            />
                          </Box>
                          <Typography variant="caption" sx={{
                            color: "text.secondary"
                          }}>
                            {formatHotelDateTime(event.created_at)}
                            {' · '}
                            {t('workflow.actor', { name: event.actor_username || t('workflow.systemActor') })}
                            {event.status_from && event.status_to ? ` / ${statusLabel(t, 'booking', event.status_from)} → ${statusLabel(t, 'booking', event.status_to)}` : ''}
                          </Typography>
                          {event.description && (
                            <Typography
                              variant="body2"
                              sx={{
                                color: "text.secondary",
                                mt: 0.25
                              }}>
                              {event.description}
                            </Typography>
                          )}
                        </Box>
                      </Box>
                    );
                  })}
                </Stack>
              )}
            </Box>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {booking?.id != null && (
          <Button
            component={Link}
            to={`/audit-log?category=bookings&resource_id=${booking.id}`}
            onClick={onClose}
          >
            {t('workflow.openAuditLog')}
          </Button>
        )}
        <Button onClick={onClose}>{t('common:actions.close')}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default WorkflowDialog;
