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
  Tabs,
  Typography,
} from '@mui/material';
import {
  Close as CloseIcon,
  PersonSearch as PersonSearchIcon,
  WarningAmber as WarningAmberIcon,
} from '@mui/icons-material';
import { useCurrency } from '../../../hooks/useCurrency';
import type { GuestDuplicateCandidate } from '../../../types';
import { useGuestProfile } from '../hooks/useGuestQueries';
import {
  formatGuestProfileDate,
  GuestReservationsTable,
  ProfileDetailRow,
  ProfileMetric,
} from './GuestProfileParts';

interface GuestProfileDialogProps {
  open: boolean;
  guestId: number | null;
  onClose: () => void;
}

const recommendationLabel = (candidate: GuestDuplicateCandidate) => {
  if (candidate.blocking_reasons.length > 0 || candidate.recommended_action === 'do_not_merge') {
    return 'Blocked';
  }
  if (candidate.score >= 100) return 'High confidence';
  if (candidate.score >= 60) return 'Contact match';
  return 'Manual review';
};

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
                {candidate.guest.nick_name}
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
                    {guest.nick_name}
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
                    Last stay: {formatGuestProfileDate(summary.last_stay_at)}
                  </Typography>
                  <Typography variant="body2" sx={{
                    color: "text.secondary"
                  }}>
                    Next stay: {formatGuestProfileDate(summary.next_stay_at)}
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
              <ProfileMetric label="Total stays" value={summary.completed_stays} />
              <ProfileMetric label="Total nights" value={summary.total_nights} />
              <ProfileMetric label="Lifetime room revenue" value={formatCurrency(Number(summary.total_room_revenue || 0))} />
              <ProfileMetric label="Outstanding balance" value={formatCurrency(Number(summary.outstanding_balance || 0))} />
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
                <ProfileDetailRow label="Phone" value={guest.phone} />
                <ProfileDetailRow label="Email" value={guest.email} />
                <ProfileDetailRow label="Alternate phone" value={guest.alt_phone} />
                <ProfileDetailRow label="Nationality" value={guest.nationality} />
                <ProfileDetailRow label="Company" value={guest.company_name} />
                <ProfileDetailRow label="Total bookings" value={summary.total_bookings} />
                <ProfileDetailRow label="Address" value={[guest.address_line1, guest.city, guest.state_province, guest.country].filter(Boolean).join(', ')} />
                <ProfileDetailRow label="Active reservation" value={summary.active_booking_number || (summary.active_booking_id ? `#${summary.active_booking_id}` : 'N/A')} />
              </Box>
            )}

            {tab === 1 && (
              <GuestReservationsTable reservations={profile.reservations} />
            )}

            {tab === 2 && <DuplicatesTab candidates={profile.duplicate_candidates} />}
          </Stack>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};

export default GuestProfileDialog;
