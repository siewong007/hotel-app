import React from 'react';
import { Alert, Box, CircularProgress, Grid } from '@mui/material';
import {
  FlightLandOutlined as ArrivalsIcon,
  FlightTakeoffOutlined as DeparturesIcon,
  HotelOutlined as InHouseIcon,
  PendingActionsOutlined as FollowUpsIcon,
  RateReviewOutlined as ReviewsIcon,
  SupportAgentOutlined as SupportIcon,
  WorkspacePremiumOutlined as VipIcon,
} from '@mui/icons-material';
import type {
  FollowUpQueueItem,
  OverviewBookingItem,
  OverviewReviewItem,
  OverviewSupportItem,
} from '../../../types';
import { getQueryErrorMessage } from '../../../api/queryConfig';
import { PageHeader, StatStrip } from '../../../components';
import type { StatStripItem } from '../../../components';
import { useAuth } from '../../../auth/AuthContext';
import { useNavigate } from '../../../router';
import { formatHotelDateTime } from '../../../utils/date';
import { GUEST_DESIGN } from '../../guests/constants';
import { useGuestRelationsOverview } from '../hooks/useGuestRelationsQueries';
import OverviewSectionCard from '../components/OverviewSectionCard';
import type { OverviewPreviewRow } from '../components/OverviewSectionCard';

const guestProfilePath = (guestId: number) => `/guest-relations/guests/${guestId}`;

const bookingRows = (items: OverviewBookingItem[]): OverviewPreviewRow[] =>
  items.slice(0, 5).map((item) => ({
    key: item.booking_id,
    to: guestProfilePath(item.guest_id),
    primary: item.guest_name,
    secondary: [item.room_label ? `Room ${item.room_label}` : null, item.status]
      .filter(Boolean)
      .join(' · '),
  }));

const supportRows = (items: OverviewSupportItem[]): OverviewPreviewRow[] =>
  items.slice(0, 5).map((item) => ({
    key: item.conversation_id,
    // Unglinked conversations have no guest 360 to land on — send the reader
    // to the inbox row's owning module instead.
    to: item.guest_id != null ? guestProfilePath(item.guest_id) : '/support',
    primary: `${item.conversation_number} — ${item.subject}`,
    secondary: [item.guest_name, item.status, item.priority].filter(Boolean).join(' · '),
  }));

const reviewRows = (items: OverviewReviewItem[]): OverviewPreviewRow[] =>
  items.slice(0, 5).map((item) => ({
    key: item.review_id,
    to: guestProfilePath(item.guest_id),
    primary: item.guest_name,
    secondary: [
      item.rating != null ? `Rating ${item.rating}/5` : 'Unrated',
      formatHotelDateTime(item.created_at),
    ].join(' · '),
  }));

const followUpRows = (items: FollowUpQueueItem[]): OverviewPreviewRow[] =>
  items.slice(0, 5).map((item) => ({
    key: item.note_id,
    to: guestProfilePath(item.guest_id),
    primary: item.subject || 'Follow-up',
    secondary: [item.guest_name, `due ${formatHotelDateTime(item.follow_up_at)}`].join(' · '),
  }));

/**
 * `/guest-relations` landing — the cross-guest operational dashboard. One
 * aggregate query feeds a stat strip plus one work-queue card per section;
 * `support`/`reviews` cards (and their stats) render only when the backend
 * includes those sections for the caller's permissions.
 */
const GuestRelationsOverviewPage: React.FC = () => {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const hasAccess = hasPermission('guests:read') || hasPermission('guests:manage');

  const overviewQuery = useGuestRelationsOverview(hasAccess);
  const overview = overviewQuery.data;
  const pageError = getQueryErrorMessage(overviewQuery.error, '');

  if (!hasAccess) {
    return (
      <Alert severity="warning" sx={{ m: 2 }}>
        You do not have permission to access this page. Contact your administrator for access.
      </Alert>
    );
  }

  const dateLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const statItems: StatStripItem[] = overview
    ? [
        {
          key: 'arrivals',
          label: 'Arrivals',
          value: overview.arrivals.count,
          icon: <ArrivalsIcon />,
          color: GUEST_DESIGN.blue,
          onClick: () => navigate('/bookings'),
        },
        {
          key: 'inHouse',
          label: 'In house',
          value: overview.in_house.count,
          icon: <InHouseIcon />,
          color: GUEST_DESIGN.green700,
          onClick: () => navigate('/bookings'),
        },
        {
          key: 'departures',
          label: 'Departures',
          value: overview.departures.count,
          icon: <DeparturesIcon />,
          color: GUEST_DESIGN.amber,
          onClick: () => navigate('/bookings'),
        },
        {
          key: 'vipArrivals',
          label: 'VIP arrivals',
          value: overview.vip_arrivals.count,
          icon: <VipIcon />,
          color: GUEST_DESIGN.gold,
          onClick: () => navigate('/bookings'),
        },
        ...(overview.support
          ? [
              {
                key: 'support',
                label: 'Open support',
                value: overview.support.open,
                hint: `${overview.support.waiting_for_staff} waiting for staff`,
                icon: <SupportIcon />,
                color: GUEST_DESIGN.rose,
                onClick: () => navigate('/support'),
              },
            ]
          : []),
        ...(overview.reviews
          ? [
              {
                key: 'reviews',
                label: 'Awaiting review',
                value: overview.reviews.count,
                icon: <ReviewsIcon />,
                color: GUEST_DESIGN.amber,
              },
            ]
          : []),
        {
          key: 'followUps',
          label: 'Follow-ups due',
          value: overview.follow_ups.count,
          icon: <FollowUpsIcon />,
          color: GUEST_DESIGN.rose,
          onClick: () => navigate('/guest-relations/follow-ups'),
        },
      ]
    : [];

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, color: GUEST_DESIGN.ink }}>
      {pageError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {pageError}
        </Alert>
      )}

      <PageHeader
        kicker={dateLabel}
        title="Guest Relations"
        subtitle="Today's flow, open requests and follow-ups across the whole guest book."
      />

      {overviewQuery.isPending || !overview ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <StatStrip items={statItems} sx={{ mb: 2 }} />

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6, xl: 4 }}>
              <OverviewSectionCard
                title="Arrivals today"
                icon={<ArrivalsIcon />}
                accent={GUEST_DESIGN.blue}
                count={overview.arrivals.count}
                rows={bookingRows(overview.arrivals.items)}
                viewAllTo="/bookings"
                viewAllLabel="View all in bookings"
                emptyText="No arrivals due today."
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6, xl: 4 }}>
              <OverviewSectionCard
                title="In-house guests"
                icon={<InHouseIcon />}
                accent={GUEST_DESIGN.green700}
                count={overview.in_house.count}
                rows={bookingRows(overview.in_house.items)}
                viewAllTo="/bookings"
                viewAllLabel="View all in bookings"
                emptyText="No guests currently in house."
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6, xl: 4 }}>
              <OverviewSectionCard
                title="Departures today"
                icon={<DeparturesIcon />}
                accent={GUEST_DESIGN.amber}
                count={overview.departures.count}
                rows={bookingRows(overview.departures.items)}
                viewAllTo="/bookings"
                viewAllLabel="View all in bookings"
                emptyText="No departures due today."
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6, xl: 4 }}>
              <OverviewSectionCard
                title="VIP arrivals today"
                icon={<VipIcon />}
                accent={GUEST_DESIGN.gold}
                count={overview.vip_arrivals.count}
                rows={bookingRows(overview.vip_arrivals.items)}
                viewAllTo="/bookings"
                viewAllLabel="View all in bookings"
                emptyText="No VIP arrivals due today."
              />
            </Grid>

            {overview.support && (
              <Grid size={{ xs: 12, md: 6, xl: 4 }}>
                <OverviewSectionCard
                  title="Open support requests"
                  icon={<SupportIcon />}
                  accent={GUEST_DESIGN.rose}
                  count={overview.support.open}
                  subtitle={`${overview.support.waiting_for_staff} waiting for staff`}
                  rows={supportRows(overview.support.items)}
                  viewAllTo="/support"
                  viewAllLabel="Open the support inbox"
                  emptyText="No open support conversations."
                />
              </Grid>
            )}

            {overview.reviews && (
              <Grid size={{ xs: 12, md: 6, xl: 4 }}>
                <OverviewSectionCard
                  title="Reviews awaiting a response"
                  icon={<ReviewsIcon />}
                  accent={GUEST_DESIGN.amber}
                  count={overview.reviews.count}
                  rows={reviewRows(overview.reviews.items)}
                  emptyText="No reviews awaiting a response."
                />
              </Grid>
            )}

            <Grid size={{ xs: 12, md: 6, xl: 4 }}>
              <OverviewSectionCard
                title="Open follow-ups"
                icon={<FollowUpsIcon />}
                accent={GUEST_DESIGN.rose}
                count={overview.follow_ups.count}
                rows={followUpRows(overview.follow_ups.items)}
                viewAllTo="/guest-relations/follow-ups"
                viewAllLabel="View the follow-up queue"
                emptyText="No follow-ups due."
              />
            </Grid>
          </Grid>
        </>
      )}
    </Box>
  );
};

export default GuestRelationsOverviewPage;
