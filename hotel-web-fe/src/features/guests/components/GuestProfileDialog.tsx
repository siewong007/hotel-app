import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material';
import {
  Close as CloseIcon,
  PersonSearch as PersonSearchIcon,
  WarningAmber as WarningAmberIcon,
} from '@mui/icons-material';
import { useCurrency } from '../../../hooks/useCurrency';
import type { GuestDuplicateCandidate, GuestProfileBooking } from '../../../types';
import { useGuestProfile } from '../hooks/useGuestQueries';

interface GuestProfileDialogProps {
  open: boolean;
  guestId: number | null;
  onClose: () => void;
}

const formatDate = (value?: string | null) => {
  if (!value) return 'N/A';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(
        Number(value.slice(0, 4)),
        Number(value.slice(5, 7)) - 1,
        Number(value.slice(8, 10))
      )
    : new Date(value);

  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const formatStatus = (value?: string | null) =>
  value ? value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()) : 'N/A';

const recommendationLabel = (candidate: GuestDuplicateCandidate) => {
  if (candidate.blocking_reasons.length > 0 || candidate.recommended_action === 'do_not_merge') {
    return 'Blocked';
  }
  if (candidate.score >= 100) return 'High confidence';
  if (candidate.score >= 60) return 'Contact match';
  return 'Manual review';
};

const Metric = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <Box
    sx={{
      border: '1px solid',
      borderColor: 'divider',
      borderRadius: 1,
      px: 2,
      py: 1.5,
      minHeight: 76,
    }}
  >
    <Typography
      variant="caption"
      sx={{
        color: "text.secondary",
        display: 'block'
      }}>
      {label}
    </Typography>
    <Typography variant="h6" sx={{ fontWeight: 800, mt: 0.5 }}>
      {value}
    </Typography>
  </Box>
);

const DetailRow = ({ label, value }: { label: string; value: React.ReactNode }) => {
  const displayValue = value === null || value === undefined || value === '' ? 'N/A' : value;

  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        variant="caption"
        sx={{
          color: "text.secondary",
          display: 'block'
        }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
        {displayValue}
      </Typography>
    </Box>
  );
};

const ReservationsTab = ({
  reservations,
  formatCurrency,
}: {
  reservations: GuestProfileBooking[];
  formatCurrency: (value: number) => string;
}) => (
  <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Booking</TableCell>
          <TableCell>Dates</TableCell>
          <TableCell>Room</TableCell>
          <TableCell>Status</TableCell>
          <TableCell align="right">Balance</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {reservations.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
              <Typography variant="body2" sx={{
                color: "text.secondary"
              }}>
                No reservations found
              </Typography>
            </TableCell>
          </TableRow>
        ) : (
          reservations.map((booking) => (
            <TableRow key={booking.id} hover>
              <TableCell>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {booking.booking_number || `#${booking.id}`}
                </Typography>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>
                  {booking.source ? formatStatus(booking.source) : 'Direct'}
                </Typography>
              </TableCell>
              <TableCell>
                <Typography variant="body2">
                  {formatDate(booking.check_in_date)} - {formatDate(booking.check_out_date)}
                </Typography>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>
                  {booking.nights} night{booking.nights === 1 ? '' : 's'}
                </Typography>
              </TableCell>
              <TableCell>
                <Typography variant="body2">Room {booking.room_number}</Typography>
                <Typography variant="caption" sx={{
                  color: "text.secondary"
                }}>
                  {booking.room_type || 'N/A'}
                </Typography>
              </TableCell>
              <TableCell>
                <Chip label={formatStatus(booking.status)} size="small" variant="outlined" />
              </TableCell>
              <TableCell align="right">
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 700 }}
                  color={Number(booking.balance_due || 0) > 0 ? 'error.main' : 'success.main'}
                >
                  {formatCurrency(Number(booking.balance_due || 0))}
                </Typography>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  </TableContainer>
);

const DuplicatesTab = ({ candidates }: { candidates: GuestDuplicateCandidate[] }) => (
  <Stack spacing={1.5}>
    {candidates.length > 0 && (
      <Alert severity="warning" icon={<WarningAmberIcon fontSize="inherit" />}>
        {candidates.length} possible duplicate profile{candidates.length === 1 ? '' : 's'} found
      </Alert>
    )}

    {candidates.length === 0 ? (
      <Box sx={{ py: 5, textAlign: 'center', color: 'text.secondary' }}>
        <PersonSearchIcon sx={{ fontSize: 40, mb: 1 }} />
        <Typography variant="body2">No duplicate candidates found</Typography>
      </Box>
    ) : (
      candidates.map((candidate) => (
        <Box
          key={candidate.guest.id}
          sx={{
            border: '1px solid',
            borderColor: candidate.blocking_reasons.length > 0 ? 'error.light' : 'divider',
            borderRadius: 1,
            p: 1.5,
          }}
        >
          <Stack
            direction="row"
            spacing={2}
            sx={{
              justifyContent: "space-between",
              alignItems: "flex-start"
            }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                {candidate.guest.full_name}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: "text.secondary",
                  overflowWrap: 'anywhere'
                }}>
                #{candidate.guest.id} - {candidate.guest.email || 'No email'} - {candidate.guest.phone || 'No phone'}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} sx={{
              alignItems: "center"
            }}>
              <Chip
                label={recommendationLabel(candidate)}
                size="small"
                color={candidate.blocking_reasons.length > 0 ? 'error' : 'warning'}
              />
              <Chip label={`${candidate.score}`} size="small" variant="outlined" />
            </Stack>
          </Stack>

          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{
              flexWrap: "wrap",
              mt: 1
            }}>
            {candidate.match_reasons.map((reason) => (
              <Chip key={reason} label={reason} size="small" variant="outlined" />
            ))}
            {candidate.blocking_reasons.map((reason) => (
              <Chip key={reason} label={reason} size="small" color="error" variant="outlined" />
            ))}
          </Stack>
        </Box>
      ))
    )}
  </Stack>
);

const GuestProfileDialog: React.FC<GuestProfileDialogProps> = ({ open, guestId, onClose }) => {
  const [tab, setTab] = useState(0);
  const { format: formatCurrency } = useCurrency();
  const profileQuery = useGuestProfile(guestId, open && guestId != null);
  const profile = profileQuery.data;

  useEffect(() => {
    if (open) setTab(0);
  }, [open, guestId]);

  const guest = profile?.guest;
  const summary = profile?.summary;
  const hasDuplicates = (profile?.duplicate_candidates.length ?? 0) > 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ px: 3, py: 2 }}>
        <Stack
          direction="row"
          spacing={2}
          sx={{
            alignItems: "center",
            justifyContent: "space-between"
          }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Guest Profile
          </Typography>
          <IconButton onClick={onClose} size="small" aria-label="Close guest profile">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ px: 3, pb: 3 }}>
        {profileQuery.isPending ? (
          <Box sx={{ py: 8, display: 'flex', justifyContent: 'center' }}>
            <CircularProgress size={34} />
          </Box>
        ) : profileQuery.error ? (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={() => profileQuery.refetch()}>
                Retry
              </Button>
            }
          >
            Failed to load guest profile.
          </Alert>
        ) : guest && summary ? (
          <Stack spacing={2.5}>
            <Box>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{
                justifyContent: "space-between"
              }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="h5" sx={{ fontWeight: 900, overflowWrap: 'anywhere' }}>
                    {guest.full_name}
                  </Typography>
                  <Stack
                    direction="row"
                    spacing={1}
                    useFlexGap
                    sx={{
                      flexWrap: "wrap",
                      mt: 1
                    }}>
                    {guest.guest_type === 'member' && <Chip label="Member" size="small" color="primary" />}
                    {summary.completed_stays > 0 && <Chip label="Returning Guest" size="small" color="success" />}
                    {guest.company_name && <Chip label={guest.company_name} size="small" variant="outlined" />}
                    {hasDuplicates && <Chip label="Duplicate Review" size="small" color="warning" />}
                  </Stack>
                </Box>
                <Box sx={{ textAlign: { xs: 'left', sm: 'right' } }}>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    Last stay: {formatDate(summary.last_stay_at)}
                  </Typography>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    Next stay: {formatDate(summary.next_stay_at)}
                  </Typography>
                </Box>
              </Stack>
            </Box>

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
                gap: 1.5,
              }}
            >
              <Metric label="Total stays" value={summary.completed_stays} />
              <Metric label="Total nights" value={summary.total_nights} />
              <Metric label="Lifetime room revenue" value={formatCurrency(Number(summary.total_room_revenue || 0))} />
              <Metric label="Outstanding balance" value={formatCurrency(Number(summary.outstanding_balance || 0))} />
            </Box>

            <Divider />

            <Box>
              <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ minHeight: 40 }}>
                <Tab label="Overview" />
                <Tab label="Reservations" />
                <Tab label="Duplicates" />
              </Tabs>
            </Box>

            {tab === 0 && (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
                  gap: 2,
                }}
              >
                <DetailRow label="Phone" value={guest.phone} />
                <DetailRow label="Email" value={guest.email} />
                <DetailRow label="Alternate phone" value={guest.alt_phone} />
                <DetailRow label="Nationality" value={guest.nationality} />
                <DetailRow label="Company" value={guest.company_name} />
                <DetailRow label="Total bookings" value={summary.total_bookings} />
                <DetailRow label="Address" value={[guest.address_line1, guest.city, guest.state_province, guest.country].filter(Boolean).join(', ')} />
                <DetailRow label="Active reservation" value={summary.active_booking_number || (summary.active_booking_id ? `#${summary.active_booking_id}` : 'N/A')} />
              </Box>
            )}

            {tab === 1 && (
              <ReservationsTab reservations={profile.reservations} formatCurrency={formatCurrency} />
            )}

            {tab === 2 && <DuplicatesTab candidates={profile.duplicate_candidates} />}
          </Stack>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};

export default GuestProfileDialog;
