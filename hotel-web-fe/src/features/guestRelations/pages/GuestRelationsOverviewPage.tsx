import React from 'react';
import { Alert, Box, Button, CircularProgress, Grid } from '@mui/material';
import {
  FlightLandOutlined as ArrivalsIcon,
  FlightTakeoffOutlined as DeparturesIcon,
  GroupsOutlined as DirectoryIcon,
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
import { dateFormatter } from '../../../i18n/format';
import { statusLabel } from '../../../i18n/statusLabel';
import { useTranslation } from '../../../i18n/useTranslation';
import type { UseTranslationResult } from '../../../i18n/useTranslation';
import { useNavigate } from '../../../router';
import { formatHotelDateTime } from '../../../utils/date';
import { GUEST_DESIGN } from '../../guests/constants';
import { useGuestRelationsOverview } from '../hooks/useGuestRelationsQueries';
import OverviewSectionCard from '../components/OverviewSectionCard';
import type { OverviewPreviewRow } from '../components/OverviewSectionCard';

const guestProfilePath = (guestId: number) => `/guest-relations/guests/${guestId}`;

const bookingRows = (items: OverviewBookingItem[], t: UseTranslationResult['t']): OverviewPreviewRow[] =>
  items.slice(0, 5).map((item) => ({
    key: item.booking_id,
    to: guestProfilePath(item.guest_id),
    primary: item.guest_name,
    secondary: [item.room_label ? t('dashboard.room', { label: item.room_label }) : null, item.status ? statusLabel(t, 'booking', item.status) : null]
      .filter(Boolean)
      .join(' · '),
  }));

const supportRows = (items: OverviewSupportItem[], t: UseTranslationResult['t']): OverviewPreviewRow[] =>
  items.slice(0, 5).map((item) => ({
    key: item.conversation_id,
    // Unglinked conversations have no guest 360 to land on — send the reader
    // to the inbox row's owning module instead.
    to: item.guest_id != null ? guestProfilePath(item.guest_id) : '/support',
    primary: `${item.conversation_number} — ${item.subject}`,
    secondary: [
      item.guest_name,
      item.status ? statusLabel(t, 'support', item.status) : null,
      item.priority ? statusLabel(t, 'priority', item.priority) : null,
    ].filter(Boolean).join(' · '),
  }));

const reviewRows = (items: OverviewReviewItem[], t: UseTranslationResult['t']): OverviewPreviewRow[] =>
  items.slice(0, 5).map((item) => ({
    key: item.review_id,
    to: guestProfilePath(item.guest_id),
    primary: item.guest_name,
    secondary: [
      item.rating != null ? t('dashboard.rating', { rating: item.rating }) : t('dashboard.unrated'),
      formatHotelDateTime(item.created_at),
    ].join(' · '),
  }));

const followUpRows = (items: FollowUpQueueItem[], t: UseTranslationResult['t']): OverviewPreviewRow[] =>
  items.slice(0, 5).map((item) => ({
    key: item.note_id,
    to: guestProfilePath(item.guest_id),
    primary: item.subject || t('followUps.subjectFallback'),
    secondary: [item.guest_name, t('dashboard.dueAt', { date: formatHotelDateTime(item.follow_up_at) })].join(' · '),
  }));

/**
 * `/guest-relations` landing — the cross-guest operational dashboard. One
 * aggregate query feeds a stat strip plus one work-queue card per section;
 * `support`/`reviews` cards (and their stats) render only when the backend
 * includes those sections for the caller's permissions.
 */
const GuestRelationsOverviewPage: React.FC = () => {
  const { t } = useTranslation('guests');
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const hasAccess = hasPermission('guests:read') || hasPermission('guests:manage');

  const overviewQuery = useGuestRelationsOverview(hasAccess);
  const overview = overviewQuery.data;
  const pageError = getQueryErrorMessage(overviewQuery.error, '');

  if (!hasAccess) {
    return (
      <Alert severity="warning" sx={{ m: 2 }}>
        {t('permissionDenied')}
      </Alert>
    );
  }

  const dateLabel = dateFormatter({
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  const statItems: StatStripItem[] = overview
    ? [
        {
          key: 'arrivals',
          label: t('dashboard.stats.arrivals'),
          value: overview.arrivals.count,
          icon: <ArrivalsIcon />,
          color: GUEST_DESIGN.blue,
          onClick: () => navigate('/bookings'),
        },
        {
          key: 'inHouse',
          label: t('dashboard.stats.inHouse'),
          value: overview.in_house.count,
          icon: <InHouseIcon />,
          color: GUEST_DESIGN.green700,
          onClick: () => navigate('/bookings'),
        },
        {
          key: 'departures',
          label: t('dashboard.stats.departures'),
          value: overview.departures.count,
          icon: <DeparturesIcon />,
          color: GUEST_DESIGN.amber,
          onClick: () => navigate('/bookings'),
        },
        {
          key: 'vipArrivals',
          label: t('dashboard.stats.vipArrivals'),
          value: overview.vip_arrivals.count,
          icon: <VipIcon />,
          color: GUEST_DESIGN.gold,
          onClick: () => navigate('/bookings'),
        },
        ...(overview.support
          ? [
              {
                key: 'support',
                label: t('dashboard.stats.openSupport'),
                value: overview.support.open,
                hint: t('dashboard.waitingForStaff', { count: overview.support.waiting_for_staff }),
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
                label: t('dashboard.stats.awaitingReview'),
                value: overview.reviews.count,
                icon: <ReviewsIcon />,
                color: GUEST_DESIGN.amber,
              },
            ]
          : []),
        {
          key: 'followUps',
          label: t('dashboard.stats.followUpsDue'),
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
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle')}
        actions={(
          <Button
            startIcon={<DirectoryIcon />}
            onClick={() => navigate('/guest-relations/guests')}
            variant="contained"
            sx={{ textTransform: 'none' }}
          >
            {t('dashboard.directory')}
          </Button>
        )}
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
                title={t('dashboard.cards.arrivalsTitle')}
                icon={<ArrivalsIcon />}
                accent={GUEST_DESIGN.blue}
                count={overview.arrivals.count}
                rows={bookingRows(overview.arrivals.items, t)}
                viewAllTo="/bookings"
                viewAllLabel={t('dashboard.cards.viewAllBookings')}
                emptyText={t('dashboard.cards.arrivalsEmpty')}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6, xl: 4 }}>
              <OverviewSectionCard
                title={t('dashboard.cards.inHouseTitle')}
                icon={<InHouseIcon />}
                accent={GUEST_DESIGN.green700}
                count={overview.in_house.count}
                rows={bookingRows(overview.in_house.items, t)}
                viewAllTo="/bookings"
                viewAllLabel={t('dashboard.cards.viewAllBookings')}
                emptyText={t('dashboard.cards.inHouseEmpty')}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6, xl: 4 }}>
              <OverviewSectionCard
                title={t('dashboard.cards.departuresTitle')}
                icon={<DeparturesIcon />}
                accent={GUEST_DESIGN.amber}
                count={overview.departures.count}
                rows={bookingRows(overview.departures.items, t)}
                viewAllTo="/bookings"
                viewAllLabel={t('dashboard.cards.viewAllBookings')}
                emptyText={t('dashboard.cards.departuresEmpty')}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6, xl: 4 }}>
              <OverviewSectionCard
                title={t('dashboard.cards.vipTitle')}
                icon={<VipIcon />}
                accent={GUEST_DESIGN.gold}
                count={overview.vip_arrivals.count}
                rows={bookingRows(overview.vip_arrivals.items, t)}
                viewAllTo="/bookings"
                viewAllLabel={t('dashboard.cards.viewAllBookings')}
                emptyText={t('dashboard.cards.vipEmpty')}
              />
            </Grid>

            {overview.support && (
              <Grid size={{ xs: 12, md: 6, xl: 4 }}>
                <OverviewSectionCard
                  title={t('dashboard.cards.supportTitle')}
                  icon={<SupportIcon />}
                  accent={GUEST_DESIGN.rose}
                  count={overview.support.open}
                  subtitle={t('dashboard.waitingForStaff', { count: overview.support.waiting_for_staff })}
                  rows={supportRows(overview.support.items, t)}
                  viewAllTo="/support"
                  viewAllLabel={t('dashboard.cards.supportViewAll')}
                  emptyText={t('dashboard.cards.supportEmpty')}
                />
              </Grid>
            )}

            {overview.reviews && (
              <Grid size={{ xs: 12, md: 6, xl: 4 }}>
                <OverviewSectionCard
                  title={t('dashboard.cards.reviewsTitle')}
                  icon={<ReviewsIcon />}
                  accent={GUEST_DESIGN.amber}
                  count={overview.reviews.count}
                  rows={reviewRows(overview.reviews.items, t)}
                  emptyText={t('dashboard.cards.reviewsEmpty')}
                />
              </Grid>
            )}

            <Grid size={{ xs: 12, md: 6, xl: 4 }}>
              <OverviewSectionCard
                title={t('dashboard.cards.followUpsTitle')}
                icon={<FollowUpsIcon />}
                accent={GUEST_DESIGN.rose}
                count={overview.follow_ups.count}
                rows={followUpRows(overview.follow_ups.items, t)}
                viewAllTo="/guest-relations/follow-ups"
                viewAllLabel={t('dashboard.cards.followUpsViewAll')}
                emptyText={t('dashboard.cards.followUpsEmpty')}
              />
            </Grid>
          </Grid>
        </>
      )}
    </Box>
  );
};

export default GuestRelationsOverviewPage;
