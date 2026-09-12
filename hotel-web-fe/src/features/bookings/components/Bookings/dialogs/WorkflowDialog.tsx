import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
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
import type { BookingTimelineEntry, BookingWithDetails, PaymentWorkflowSummary } from '../../../../../types';
import { useCurrency } from '../../../../../hooks/useCurrency';
import { getPaymentStatusText } from '../../../../../utils/bookingUtils';
import { compareMoney, isPositiveMoney, toMoneyNumber } from '../../../../../utils/money';

interface WorkflowDialogProps {
  open: boolean;
  booking: BookingWithDetails | null;
  summary: PaymentWorkflowSummary | null;
  timeline: BookingTimelineEntry[];
  loading: boolean;
  onClose: () => void;
}

const getWorkflowEventIndicator = (event: BookingTimelineEntry) => {
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
      label: statusTo === 'voided' || eventType.includes('void') || title.includes('void') ? 'Void' : 'Checkout',
      color: '#d32f2f',
      backgroundColor: 'rgba(211, 47, 47, 0.12)',
      borderColor: 'rgba(211, 47, 47, 0.35)',
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
      label: 'Check-in',
      color: '#ed6c02',
      backgroundColor: 'rgba(237, 108, 2, 0.12)',
      borderColor: 'rgba(237, 108, 2, 0.35)',
      icon: <LoginIcon fontSize="small" />,
    };
  }

  if (source === 'payments') {
    return {
      label: 'Payment',
      color: '#2e7d32',
      backgroundColor: 'rgba(46, 125, 50, 0.12)',
      borderColor: 'rgba(46, 125, 50, 0.35)',
      icon: <PaymentIcon fontSize="small" />,
    };
  }

  return {
    label: 'Update',
    color: '#1976d2',
    backgroundColor: 'rgba(25, 118, 210, 0.12)',
    borderColor: 'rgba(25, 118, 210, 0.35)',
    icon: <EditIcon fontSize="small" />,
  };
};

const WorkflowDialog: React.FC<WorkflowDialogProps> = ({ open, booking, summary, timeline, loading, onClose }) => {
  const { format: formatCurrency } = useCurrency();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>
        Workflow - {booking?.booking_number || booking?.folio_number || `#${booking?.id}`}
      </DialogTitle>
      <DialogContent dividers>
        {loading ? (
          <Box sx={{ py: 5, display: 'flex', justifyContent: 'center' }}>
            <CircularProgress />
          </Box>
        ) : (
          <Stack spacing={2.5}>
            {summary && (
              <Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 1.5 }}>
                  <Box>
                    <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>Total</Typography>
                    <Typography variant="subtitle2">{formatCurrency(toMoneyNumber(summary.total_amount))}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>Paid</Typography>
                    <Typography variant="subtitle2" sx={{
                      color: "success.main"
                    }}>{formatCurrency(toMoneyNumber(summary.total_paid))}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>Balance</Typography>
                    <Typography variant="subtitle2" color={isPositiveMoney(summary.balance_due) ? 'warning.main' : 'success.main'}>
                      {formatCurrency(toMoneyNumber(summary.balance_due))}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{
                      color: "text.secondary"
                    }}>Refunded</Typography>
                    <Typography variant="subtitle2" sx={{
                      color: "info.main"
                    }}>{formatCurrency(toMoneyNumber(summary.total_refunded))}</Typography>
                  </Box>
                </Box>
                <Box sx={{ mt: 1.5, display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Chip size="small" color="primary" label={summary.next_action} />
                  <Chip size="small" variant="outlined" label={getPaymentStatusText(summary.payment_status)} />
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
                <Typography variant="subtitle2">Timeline</Typography>
                <Stack direction="row" spacing={0.75} useFlexGap sx={{
                  flexWrap: "wrap"
                }}>
                  {[
                    { label: 'Update', color: '#1976d2' },
                    { label: 'Payment', color: '#2e7d32' },
                    { label: 'Check-in', color: '#ed6c02' },
                    { label: 'Checkout / Void', color: '#d32f2f' },
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
                        bgcolor: `${item.color}14`,
                        '& .MuiChip-label': { px: 1 },
                      }}
                    />
                  ))}
                </Stack>
              </Box>
              {timeline.length === 0 ? (
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>No workflow events recorded yet.</Typography>
              ) : (
                <Stack spacing={1.25}>
                  {timeline.map((event) => {
                    const indicator = getWorkflowEventIndicator(event);

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
                            bgcolor: indicator.color,
                            color: 'white',
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
                                bgcolor: indicator.color,
                                color: 'white',
                                fontWeight: 800,
                                '& .MuiChip-label': { px: 0.9 },
                              }}
                            />
                          </Box>
                          <Typography variant="caption" sx={{
                            color: "text.secondary"
                          }}>
                            {new Date(event.created_at).toLocaleString()}
                            {event.status_from && event.status_to ? ` / ${event.status_from} -> ${event.status_to}` : ''}
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
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default WorkflowDialog;
