import React from 'react';
import {
  Alert,
  Box,
  Chip,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import {
  BlockOutlined as BlacklistedIcon,
  EventAvailableOutlined as StayIcon,
  LockOutlined as RestrictedIcon,
  NotificationsActiveOutlined as AlertIcon,
  PersonSearchOutlined as DuplicateIcon,
  RateReviewOutlined as ReviewIcon,
  SupportAgentOutlined as SupportIcon,
  TaskAltOutlined as FollowUpIcon,
} from '@mui/icons-material';
import type { GuestProfile } from '../../../../types';
import { formatStatusLabel } from '../../../../utils/formatters';
import { useCurrency } from '../../../../hooks/useCurrency';
import {
  formatGuestProfileDate,
  ProfileDetailRow,
  ProfileMetric,
} from '../../../guests/components/GuestProfileParts';
import {
  useGuestInteractions,
  useGuestPreferences,
  useGuestReviews,
  useGuestSupportConversations,
} from '../../hooks/useGuestRelationsQueries';

const OPEN_SUPPORT_STATUSES = new Set(['waiting_for_staff', 'waiting_for_guest']);

const SectionCard: React.FC<{ title: React.ReactNode; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <Paper variant="outlined" sx={{ p: 2 }}>
    <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1.5 }}>
      {title}
    </Typography>
    {children}
  </Paper>
);

interface OverviewTabProps {
  guestId: number;
  profile: GuestProfile;
  /** `support:read` — the open-items card hides its support row without it. */
  canViewSupport: boolean;
  /** `reviews:read` — the unanswered-review count needs the reviews endpoint. */
  canViewReviews: boolean;
}

/** Guest 360 overview: KPI tiles, current/next stay, alert panel, profile and
 *  preference details, open work items, duplicate-review and sensitive-
 *  identity sections. Lighter queries run only while this tab is mounted. */
const OverviewTab: React.FC<OverviewTabProps> = ({
  guestId,
  profile,
  canViewSupport,
  canViewReviews,
}) => {
  const { format: formatCurrency } = useCurrency();
  const { guest, summary, reservations, duplicate_candidates: duplicates } = profile;

  // First page is enough for panels — they surface "what needs attention",
  // not a full history (the Interactions tab owns that).
  const alertsQuery = useGuestInteractions(guestId, { page: 1, page_size: 20 });
  const preferencesQuery = useGuestPreferences(guestId);
  const supportQuery = useGuestSupportConversations(guestId, canViewSupport);
  const reviewsQuery = useGuestReviews(guestId, canViewReviews);

  const alertNotes = React.useMemo(
    () => (alertsQuery.data?.data ?? []).filter((note) => note.is_alert),
    [alertsQuery.data],
  );
  const pendingFollowUps = React.useMemo(
    () => (alertsQuery.data?.data ?? []).filter(
      (note) => note.follow_up_at != null && note.follow_up_completed_at == null,
    ),
    [alertsQuery.data],
  );
  const openSupportCount = React.useMemo(
    () => (supportQuery.data ?? []).filter((c) => OPEN_SUPPORT_STATUSES.has(c.status)).length,
    [supportQuery.data],
  );
  const unansweredReviews = React.useMemo(
    () => (reviewsQuery.data ?? []).filter((review) => review.response == null).length,
    [reviewsQuery.data],
  );

  const activeReservation = React.useMemo(
    () => reservations.find((booking) => booking.id === summary.active_booking_id) ?? null,
    [reservations, summary.active_booking_id],
  );
  const upcomingReservation = React.useMemo(
    () => (summary.next_stay_at
      ? reservations.find((booking) => booking.check_in_date === summary.next_stay_at) ?? null
      : null),
    [reservations, summary.next_stay_at],
  );

  const hasAlerts = guest.is_blacklisted || alertNotes.length > 0;
  const sensitive = profile.sensitive ?? null;

  return (
    <Stack spacing={2.5}>
      {/* KPI tiles — same Metric layout as the legacy profile dialog */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
          gap: 1.5,
        }}
      >
        <ProfileMetric label="Completed stays" value={summary.completed_stays} />
        <ProfileMetric label="Total nights" value={summary.total_nights} />
        <ProfileMetric label="Lifetime room revenue" value={formatCurrency(Number(summary.total_room_revenue || 0))} />
        <ProfileMetric label="Outstanding balance" value={formatCurrency(Number(summary.outstanding_balance || 0))} />
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
          gap: 2,
        }}
      >
        {/* Current / upcoming stay */}
        <SectionCard
          title={
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <StayIcon sx={{ fontSize: 16 }} />
              <span>Stay status</span>
            </Stack>
          }
        >
          {activeReservation || summary.active_booking_id ? (
            <Box sx={{ mb: 1.5 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                Active stay
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {summary.active_booking_number || `#${summary.active_booking_id}`}
                {activeReservation && ` · Room ${activeReservation.room_number}`}
              </Typography>
              {activeReservation && (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {formatGuestProfileDate(activeReservation.check_in_date)} – {formatGuestProfileDate(activeReservation.check_out_date)}
                  {activeReservation.room_type ? ` · ${activeReservation.room_type}` : ''}
                </Typography>
              )}
            </Box>
          ) : (
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
              No active stay.
            </Typography>
          )}
          <Box>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
              Next stay
            </Typography>
            {summary.next_stay_at ? (
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {formatGuestProfileDate(summary.next_stay_at)}
                {upcomingReservation && ` · ${upcomingReservation.booking_number || `#${upcomingReservation.id}`}`}
                {upcomingReservation?.room_number ? ` · Room ${upcomingReservation.room_number}` : ''}
              </Typography>
            ) : (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Nothing on the books.
              </Typography>
            )}
          </Box>
        </SectionCard>

        {/* Alerts */}
        <SectionCard
          title={
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <AlertIcon sx={{ fontSize: 16 }} />
              <span>Alerts</span>
            </Stack>
          }
        >
          {alertsQuery.isPending ? (
            <Skeleton variant="rounded" height={48} />
          ) : hasAlerts ? (
            <Stack spacing={1}>
              {guest.is_blacklisted && (
                <Alert
                  severity="error"
                  icon={<BlacklistedIcon fontSize="inherit" />}
                  sx={{ py: 0 }}
                >
                  Blacklisted{guest.blacklist_reason ? `: ${guest.blacklist_reason}` : ''}
                </Alert>
              )}
              {alertNotes.map((note) => (
                <Alert key={note.id} severity="warning" sx={{ py: 0 }}>
                  {note.subject ? `${note.subject} — ` : ''}{note.content}
                </Alert>
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              No active alerts for this guest.
            </Typography>
          )}
        </SectionCard>
      </Box>

      {/* Profile details */}
      <SectionCard title="Profile details">
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
          <ProfileDetailRow label="Job title" value={guest.job_title} />
          <ProfileDetailRow
            label="Address"
            value={[guest.address_line1, guest.city, guest.state_province, guest.postal_code, guest.country]
              .filter(Boolean)
              .join(', ')}
          />
          <ProfileDetailRow label="Language" value={guest.language_preference} />
          <ProfileDetailRow label="Preferred channel" value={guest.communication_preference} />
          <ProfileDetailRow
            label="Marketing opt-in"
            value={guest.marketing_opt_in == null ? undefined : guest.marketing_opt_in ? 'Yes' : 'No'}
          />
          <ProfileDetailRow label="Total bookings" value={summary.total_bookings} />
          <ProfileDetailRow label="Tourism type" value={guest.tourism_type ? formatStatusLabel(guest.tourism_type) : undefined} />
          <ProfileDetailRow
            label="Tags"
            value={guest.tags?.length ? guest.tags.join(', ') : undefined}
          />
        </Box>
      </SectionCard>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
          gap: 2,
        }}
      >
        {/* Preferences summary */}
        <SectionCard title="Preferences">
          {preferencesQuery.isPending ? (
            <Skeleton variant="rounded" height={48} />
          ) : (preferencesQuery.data ?? []).length === 0 ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              No preferences recorded yet.
            </Typography>
          ) : (
            <Stack spacing={0.75}>
              {(preferencesQuery.data ?? []).slice(0, 6).map((pref) => (
                <Stack key={pref.id} direction="row" spacing={1} sx={{ alignItems: 'baseline', minWidth: 0 }}>
                  <Chip label={formatStatusLabel(pref.category)} size="small" variant="outlined" />
                  <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                    <Box component="span" sx={{ fontWeight: 700 }}>{pref.preference_key}</Box>
                    {' — '}
                    {pref.preference_value}
                  </Typography>
                </Stack>
              ))}
              {(preferencesQuery.data ?? []).length > 6 && (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  +{(preferencesQuery.data ?? []).length - 6} more — see the Preferences tab
                </Typography>
              )}
            </Stack>
          )}
        </SectionCard>

        {/* Open items */}
        <SectionCard title="Open items">
          <Stack spacing={1.25}>
            {canViewSupport && (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <SupportIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                <Typography variant="body2">
                  {supportQuery.isPending ? '…' : openSupportCount} open support conversation{openSupportCount === 1 ? '' : 's'}
                </Typography>
              </Stack>
            )}
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <FollowUpIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              <Typography variant="body2">
                {alertsQuery.isPending ? '…' : pendingFollowUps.length} pending follow-up{pendingFollowUps.length === 1 ? '' : 's'}
              </Typography>
            </Stack>
            {canViewReviews && (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <ReviewIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                <Typography variant="body2">
                  {reviewsQuery.isPending ? '…' : unansweredReviews} unanswered review{unansweredReviews === 1 ? '' : 's'}
                </Typography>
              </Stack>
            )}
          </Stack>
        </SectionCard>
      </Box>

      {/* Duplicate review */}
      {duplicates.length > 0 && (
        <SectionCard
          title={
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <DuplicateIcon sx={{ fontSize: 16 }} />
              <span>Possible duplicates ({duplicates.length})</span>
            </Stack>
          }
        >
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            {duplicates.length} other profile{duplicates.length === 1 ? '' : 's'} may belong to the same person.
          </Alert>
          <Stack spacing={1}>
            {duplicates.slice(0, 3).map((candidate) => (
              <Stack
                key={candidate.guest.id}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', justifyContent: 'space-between' }}
              >
                <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  #{candidate.guest.id} — {candidate.guest.nick_name}
                  {candidate.guest.email ? ` · ${candidate.guest.email}` : ''}
                </Typography>
                <Chip
                  size="small"
                  variant="outlined"
                  color={candidate.blocking_reasons.length > 0 ? 'error' : 'warning'}
                  label={`score ${candidate.score}`}
                />
              </Stack>
            ))}
          </Stack>
        </SectionCard>
      )}

      {/* Sensitive identity — present only for `guests:reveal` holders; the
          backend omits the field entirely otherwise. Read-only here; edits go
          through the guest form dialog. */}
      {sensitive && (
        <SectionCard
          title={
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <RestrictedIcon sx={{ fontSize: 16 }} />
              <span>Sensitive identity</span>
            </Stack>
          }
        >
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
              gap: 2,
            }}
          >
            <ProfileDetailRow label="Date of birth" value={sensitive.date_of_birth ? formatGuestProfileDate(sensitive.date_of_birth) : null} />
            <ProfileDetailRow label="ID type" value={sensitive.id_type ? formatStatusLabel(sensitive.id_type) : null} />
            <ProfileDetailRow label="ID number" value={sensitive.id_number} />
            <ProfileDetailRow label="ID expiry" value={sensitive.id_expiry ? formatGuestProfileDate(sensitive.id_expiry) : null} />
            <ProfileDetailRow label="ID country" value={sensitive.id_country} />
          </Box>
        </SectionCard>
      )}
    </Stack>
  );
};

export default OverviewTab;
