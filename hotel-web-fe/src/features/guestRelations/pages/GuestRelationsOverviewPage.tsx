import React from 'react';
import { Alert, Box, Button, Grid } from '@mui/material';
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
import { LogoLoader, PageHeader, StatStrip } from '../../../components';
import type { StatStripItem } from '../../../components';
import { useAuth } from '../../../auth/AuthContext';
import { useNavigate } from '../../../router';
import { formatHotelDateTime } from '../../../utils/date';
import { GUEST_DESIGN } from '../../guests/constants';
import { useGuestRelationsOverview } from '../hooks/useGuestRelationsQueries';
import { dateFormatter, statusLabel, useTranslation, type UseTranslationResult } from '../../../i18n';
import OverviewSectionCard from '../components/OverviewSectionCard';
import type { OverviewPreviewRow } from '../components/OverviewSectionCard';

const guestProfilePath = (guestId: number) => `/guest-relations/guests/${guestId}`;

const bookingRows = (t: UseTranslationResult['t'], items: OverviewBookingItem[]): OverviewPreviewRow[] =>
  items.slice(0, 5).map((item) => ({
    key: item.booking_id,
    to: guestProfilePath(item.guest_id),
    primary: item.guest_name,
    secondary: [item.room_label ? t('overviewPage.roomLabel', { room: item.room_label }) : null, item.status ? statusLabel(t, 'booking', item.status) : null]
      .filter(Boolean)
      .join(' · '),
  }));

const supportRows = (t: UseTranslationResult['t'], items: OverviewSupportItem[]): OverviewPreviewRow[] =>
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

const reviewRows = (t: UseTranslationResult['t'], items: OverviewReviewItem[]): OverviewPreviewRow[] =>
  items.slice(0, 5).map((item) => ({
    key: item.review_id,
    to: guestProfilePath(item.guest_id),
    primary: item.guest_name,
    secondary: [
      item.rating != null ? t('overviewPage.rating', { rating: item.rating }) : t('overviewPage.unrated'),
      formatHotelDateTime(item.created_at),
    ].join(' · '),
  }));

const followUpRows = (t: UseTranslationResult['t'], items: FollowUpQueueItem[]): OverviewPreviewRow[] =>
  items.slice(0, 5).map((item) => ({
    key: item.note_id,
    to: guestProfilePath(item.guest_id),
    primary: item.subject || t('followUps.fallbackSubject'),
    secondary: [item.guest_name, t('overviewPage.due', { date: formatHotelDateTime(item.follow_up_at) })].join(' · '),
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
          label: t('overviewPage.stats.arrivals'),
          value: overview.arrivals.count,
          icon: <ArrivalsIcon />,
          color: GUEST_DESIGN.blue,
          onClick: () => navigate('/bookings'),
        },
        {
          key: 'inHouse',
          label: t('overviewPage.stats.inHouse'),
          value: overview.in_house.count,
          icon: <InHouseIcon />,
          color: GUEST_DESIGN.green700,
          onClick: () => navigate('/bookings'),
        },
        {
          key: 'departures',
          label: t('overviewPage.stats.departures'),
          value: overview.departures.count,
          icon: <DeparturesIcon />,
          color: GUEST_DESIGN.amber,
          onClick: () => navigate('/bookings'),
        },
        {
          key: 'vipArrivals',
          label: t('overviewPage.stats.vipArrivals'),
          value: overview.vip_arrivals.count,
          icon: <VipIcon />,
          color: GUEST_DESIGN.gold,
          onClick: () => navigate('/bookings'),
        },
        ...(overview.support
          ? [
              {
                key: 'support',
                label: t('overviewPage.stats.openSupport'),
                value: overview.support.open,
                hint: t('overviewPage.waitingForStaff', { count: overview.support.waiting_for_staff }),
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
                label: t('overviewPage.stats.awaitingReview'),
                value: overview.reviews.count,
                icon: <ReviewsIcon />,
                color: GUEST_DESIGN.amber,
              },
            ]
          : []),
        {
          key: 'followUps',
          label: t('overviewPage.stats.followUpsDue'),
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
        title={t('overviewPage.title')}
        subtitle={t('overviewPage.subtitle')}
        actions={(
          <Button
            startIcon={<DirectoryIcon />}
            onClick={() => navigate('/guest-relations/guests')}
            variant="contained"
            sx={{ textTransform: 'none' }}
          >
            {t('overviewPage.guestDirectory')}
          </Button>
        )}
      />

      {overviewQuery.isPending || !overview ? (
        <LogoLoader variant="page" />
      ) : (
        <>
          <StatStrip items={statItems} sx={{ mb: 2 }} />

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6, xl: 4 }}>
              <OverviewSectionCard
                title={t('overviewPage.cards.arrivals')}
                icon={<ArrivalsIcon />}
                accent={GUEST_DESIGN.blue}
                count={overview.arrivals.count}
                rows={bookingRows(t, overview.arrivals.items)}
                viewAllTo="/bookings"
                viewAllLabel={t('overviewPage.viewAllBookings')}
                emptyText={t('overviewPage.empty.arrivals')}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6, xl: 4 }}>
              <OverviewSectionCard
                title={t('overviewPage.cards.inHouse')}
                icon={<InHouseIcon />}
                accent={GUEST_DESIGN.green700}
                count={overview.in_house.count}
                rows={bookingRows(t, overview.in_house.items)}
                viewAllTo="/bookings"
                viewAllLabel={t('overviewPage.viewAllBookings')}
                emptyText={t('overviewPage.empty.inHouse')}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6, xl: 4 }}>
              <OverviewSectionCard
                title={t('overviewPage.cards.departures')}
                icon={<DeparturesIcon />}
                accent={GUEST_DESIGN.amber}
                count={overview.departures.count}
                rows={bookingRows(t, overview.departures.items)}
                viewAllTo="/bookings"
                viewAllLabel={t('overviewPage.viewAllBookings')}
                emptyText={t('overviewPage.empty.departures')}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6, xl: 4 }}>
              <OverviewSectionCard
                title={t('overviewPage.cards.vipArrivals')}
                icon={<VipIcon />}
                accent={GUEST_DESIGN.gold}
                count={overview.vip_arrivals.count}
                rows={bookingRows(t, overview.vip_arrivals.items)}
                viewAllTo="/bookings"
                viewAllLabel={t('overviewPage.viewAllBookings')}
                emptyText={t('overviewPage.empty.vipArrivals')}
              />
            </Grid>

            {overview.support && (
              <Grid size={{ xs: 12, md: 6, xl: 4 }}>
                <OverviewSectionCard
                  title={t('overviewPage.cards.openSupport')}
                  icon={<SupportIcon />}
                  accent={GUEST_DESIGN.rose}
                  count={overview.support.open}
                  subtitle={t('overviewPage.waitingForStaff', { count: overview.support.waiting_for_staff })}
                  rows={supportRows(t, overview.support.items)}
                  viewAllTo="/support"
                  viewAllLabel={t('overviewPage.openSupportInbox')}
                  emptyText={t('overviewPage.empty.support')}
                />
              </Grid>
            )}

            {overview.reviews && (
              <Grid size={{ xs: 12, md: 6, xl: 4 }}>
                <OverviewSectionCard
                  title={t('overviewPage.cards.reviewsAwaiting')}
                  icon={<ReviewsIcon />}
                  accent={GUEST_DESIGN.amber}
                  count={overview.reviews.count}
                  rows={reviewRows(t, overview.reviews.items)}
                  emptyText={t('overviewPage.empty.reviews')}
                />
              </Grid>
            )}

            <Grid size={{ xs: 12, md: 6, xl: 4 }}>
              <OverviewSectionCard
                title={t('overviewPage.cards.openFollowUps')}
                icon={<FollowUpsIcon />}
                accent={GUEST_DESIGN.rose}
                count={overview.follow_ups.count}
                rows={followUpRows(t, overview.follow_ups.items)}
                viewAllTo="/guest-relations/follow-ups"
                viewAllLabel={t('overviewPage.viewFollowUpQueue')}
                emptyText={t('overviewPage.empty.followUps')}
              />
            </Grid>
          </Grid>
        </>
      )}
    </Box>
  );
};

export default GuestRelationsOverviewPage;
