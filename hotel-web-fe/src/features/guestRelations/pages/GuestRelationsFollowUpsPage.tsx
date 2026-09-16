import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Pagination,
  Paper,
  Typography,
} from '@mui/material';
import {
  CheckCircleOutlineOutlined as DoneIcon,
  PendingActionsOutlined as FollowUpsIcon,
} from '@mui/icons-material';
import type { FollowUpDue, FollowUpQueueItem } from '../../../types';
import { errorMessage } from '../../../utils';
import { getQueryErrorMessage } from '../../../api/queryConfig';
import { DataTable, EmptyState, PageHeader } from '../../../components';
import type { ColumnDef } from '../../../components';
import { useAuth } from '../../../auth/AuthContext';
import { Link, useNavigate, useSearchParams } from '../../../router';
import { emitApiNotification } from '../../../utils/apiNotifications';
import { formatHotelDateTime, isHotelDatePast } from '../../../utils/date';
import { formatStatusLabel } from '../../../utils/formatters';
import { getPaginationState } from '../../../utils/pagination';
import { useTranslation } from '../../../i18n';
import { GUEST_DESIGN } from '../../guests/constants';
import { useCompleteFollowUp, useGuestFollowUps } from '../hooks/useGuestRelationsQueries';

const DUE_FILTERS: Array<{ key: FollowUpDue; labelKey: string }> = [
  { key: 'overdue', labelKey: 'followUps.filters.overdue' },
  { key: 'today', labelKey: 'followUps.filters.today' },
  { key: 'upcoming', labelKey: 'followUps.filters.upcoming' },
  { key: 'all', labelKey: 'followUps.filters.all' },
];

/** The API serializes follow_up_at as an instant; the backend bucket boundary
 * is the hotel business day, so "overdue" on a row means its hotel date has
 * passed — exactly what `isHotelDatePast` checks. */
const isOverdue = (item: FollowUpQueueItem) => isHotelDatePast(item.follow_up_at);

const normalizeDueParam = (value: string | null): FollowUpDue | null =>
  value === 'overdue' || value === 'today' || value === 'upcoming' || value === 'all'
    ? value
    : null;

const guestProfilePath = (guestId: number) => `/guest-relations/guests/${guestId}`;

/**
 * `/guest-relations/follow-ups` — the cross-guest queue of open note
 * follow-ups (`GET /guest-relations/follow-ups`). Due-bucket chips drive the
 * server-side `due` param; completion reuses the per-guest interaction PATCH
 * through `useCompleteFollowUp`.
 */
const GuestRelationsFollowUpsPage: React.FC = () => {
  const { t } = useTranslation('guests');
  const navigate = useNavigate();
  const [pageSearchParams] = useSearchParams();
  const { hasPermission } = useAuth();
  const hasAccess = hasPermission('guests:read') || hasPermission('guests:manage');

  const [due, setDue] = useState<FollowUpDue>(
    () => normalizeDueParam(pageSearchParams.get('due')) ?? 'all',
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  // Deep links (`?due=overdue`) — same contract as the guest list's `?search=`
  // handling: a changed param re-seeds the filter, an absent one leaves it.
  const routedDue = normalizeDueParam(pageSearchParams.get('due'));
  useEffect(() => {
    if (!routedDue) return;
    setDue(routedDue);
    setCurrentPage(1);
  }, [routedDue]);

  const followUpsQuery = useGuestFollowUps(due, currentPage, hasAccess);
  const {
    mutateAsync: completeFollowUp,
    isPending: completingFollowUp,
    variables: completingVariables,
  } = useCompleteFollowUp();

  const items = React.useMemo(() => followUpsQuery.data?.data ?? [], [followUpsQuery.data]);
  const total = followUpsQuery.data?.total ?? 0;
  // The hook doesn't send page_size — the backend default rides back on the
  // envelope, so the footer tracks whatever the API actually paginated by.
  const pageSize = followUpsQuery.data?.page_size ?? 20;
  const pageError = error || getQueryErrorMessage(followUpsQuery.error, '') || null;

  const handleDueChange = (next: FollowUpDue) => {
    setDue(next);
    setCurrentPage(1);
  };

  const handleOpenGuest = (item: FollowUpQueueItem) => {
    navigate(guestProfilePath(item.guest_id));
  };

  // `mutateAsync` is a stable reference on the mutation result, so the
  // callback (and therefore the columns memo below) only re-creates when the
  // pending state or in-flight variables change.
  const handleMarkDone = React.useCallback(async (item: FollowUpQueueItem) => {
    try {
      setError(null);
      await completeFollowUp({ guestId: item.guest_id, noteId: item.note_id });
      emitApiNotification({ message: t('followUps.markedDone'), severity: 'success' });
    } catch (err) {
      setError(errorMessage(err, t('followUps.completeFailed')));
    }
  }, [completeFollowUp, t]);

  const columns = React.useMemo<ColumnDef<FollowUpQueueItem, any>[]>(() => [
    {
      id: 'guest',
      header: t('followUps.colGuest'),
      accessorFn: (item: FollowUpQueueItem) => item.guest_name,
      enableSorting: false,
      meta: { stopRowClick: true },
      cell: (info) => {
        const item = info.row.original;
        return (
          <Typography
            component={Link}
            to={guestProfilePath(item.guest_id)}
            sx={{
              fontSize: 13.5,
              fontWeight: 700,
              color: 'primary.main',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            {item.guest_name}
          </Typography>
        );
      },
    },
    {
      id: 'subject',
      header: t('followUps.colSubject'),
      accessorFn: (item: FollowUpQueueItem) => item.subject ?? '',
      enableSorting: false,
      cell: (info) => {
        const item = info.row.original;
        return (
          <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
            {item.subject?.trim() || t('followUps.fallbackSubject')}
          </Typography>
        );
      },
    },
    {
      id: 'type',
      header: t('common:field.type'),
      accessorFn: (item: FollowUpQueueItem) => item.interaction_type,
      enableSorting: false,
      cell: (info) => (
        // intentional: dynamic key — interaction_type is a DB enum value; unknown values humanize
        <Chip
          size="small"
          label={formatStatusLabel(info.row.original.interaction_type)}
          sx={{ bgcolor: GUEST_DESIGN.paper3, color: GUEST_DESIGN.ink2, fontWeight: 600 }}
        />
      ),
    },
    {
      id: 'due',
      header: t('followUps.colDue'),
      accessorFn: (item: FollowUpQueueItem) => item.follow_up_at,
      enableSorting: false,
      cell: (info) => {
        const item = info.row.original;
        const overdue = isOverdue(item);
        return (
          <Box>
            <Typography
              sx={{
                fontSize: 12.5,
                fontWeight: overdue ? 700 : 400,
                color: overdue ? GUEST_DESIGN.rose : 'text.primary',
                fontVariantNumeric: 'tabular-nums',
                whiteSpace: 'nowrap',
              }}
            >
              {formatHotelDateTime(item.follow_up_at)}
            </Typography>
            {overdue && (
              // CSS vars can't go through MUI alpha() — color-mix is the
              // convention for tinting --hotel-* tokens.
              <Chip
                size="small"
                label={t('followUps.filters.overdue')}
                sx={{
                  mt: 0.25,
                  bgcolor: `color-mix(in srgb, ${GUEST_DESIGN.rose} 10%, transparent)`,
                  color: GUEST_DESIGN.rose,
                  fontWeight: 700,
                }}
              />
            )}
          </Box>
        );
      },
    },
    {
      id: 'assignee',
      header: t('followUps.colAssignee'),
      accessorFn: (item: FollowUpQueueItem) => item.assigned_to_name ?? '',
      enableSorting: false,
      cell: (info) => {
        const item = info.row.original;
        return (
          <Typography
            sx={{
              fontSize: 12.5,
              color: item.assigned_to_name ? 'text.primary' : 'text.secondary',
              whiteSpace: 'nowrap',
            }}
          >
            {item.assigned_to_name || t('followUps.unassigned')}
          </Typography>
        );
      },
    },
    {
      id: 'snippet',
      header: t('followUps.colSnippet'),
      accessorFn: (item: FollowUpQueueItem) => item.snippet ?? '',
      enableSorting: false,
      cell: (info) => {
        const item = info.row.original;
        return (
          <Typography
            sx={{
              fontSize: 12,
              color: 'text.secondary',
              maxWidth: 320,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {item.snippet || '—'}
          </Typography>
        );
      },
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      meta: { align: 'right', stopRowClick: true },
      cell: (info) => {
        const item = info.row.original;
        const isCompleting =
          completingFollowUp && completingVariables?.noteId === item.note_id;
        return (
          <Button
            size="small"
            variant="outlined"
            startIcon={<DoneIcon sx={{ fontSize: 16 }} />}
            disabled={isCompleting}
            onClick={() => void handleMarkDone(item)}
            sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
          >
            {t('followUps.markDone')}
          </Button>
        );
      },
    },
  ], [completingFollowUp, completingVariables, handleMarkDone, t]);

  const pagination = React.useMemo(
    () => getPaginationState({ page: currentPage, pageSize, totalItems: total }),
    [currentPage, pageSize, total],
  );

  if (!hasAccess) {
    return (
      <Alert severity="warning" sx={{ m: 2 }}>
        {t('permissionDenied')}
      </Alert>
    );
  }

  const emptyMessage = (
    <EmptyState
      icon={<FollowUpsIcon />}
      title={t('followUps.emptyTitle')}
      description={
        due === 'all'
          ? t('followUps.emptyAll')
          : t('followUps.emptyBucket')
      }
    />
  );

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, color: GUEST_DESIGN.ink }}>
      {pageError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {pageError}
        </Alert>
      )}

      <PageHeader
        kicker={t('followUps.kicker')}
        title={t('followUps.title')}
        subtitle={t('followUps.subtitle')}
      />

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        {/* Due-bucket filter chips — same pill style as GuestSegmentChips. */}
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 0.75,
            p: '12px 16px',
            borderBottom: `1px solid ${GUEST_DESIGN.rule}`,
          }}
        >
          {DUE_FILTERS.map(({ key, labelKey }) => {
            const active = due === key;
            return (
              <Box
                key={key}
                component="button"
                onClick={() => handleDueChange(key)}
                aria-pressed={active}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  px: 1.5,
                  py: 0.85,
                  borderRadius: 999,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: active ? `1px solid ${GUEST_DESIGN.ink}` : `1px solid ${GUEST_DESIGN.rule}`,
                  bgcolor: active ? GUEST_DESIGN.ink : 'background.paper',
                  color: active ? '#fff' : GUEST_DESIGN.ink2,
                  fontFamily: 'inherit',
                  transition: 'background-color 120ms',
                  '&:hover': { bgcolor: active ? GUEST_DESIGN.ink : GUEST_DESIGN.paper2 },
                }}
              >
                {t(labelKey)}
              </Box>
            );
          })}
        </Box>

        {/* Count row — same strip as the guest list's count/sort row. */}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            px: 2,
            py: 1.25,
            bgcolor: GUEST_DESIGN.paper2,
            borderBottom: `1px solid ${GUEST_DESIGN.rule}`,
            fontSize: 11.5,
            color: GUEST_DESIGN.ink3,
          }}
        >
          <Box>
            {t('followUps.countOfTotal', { shown: items.length, total })}
          </Box>
          <Box sx={{ fontSize: 11.5, color: GUEST_DESIGN.ink2, fontWeight: 600 }}>
            {t('followUps.oldestFirst')}
          </Box>
        </Box>

        {followUpsQuery.isError && !followUpsQuery.data ? (
          <Alert
            severity="error"
            sx={{ m: 2 }}
            action={
              <Button color="inherit" size="small" onClick={() => void followUpsQuery.refetch()}>
                {t('common:actions.retry')}
              </Button>
            }
          >
            {getQueryErrorMessage(followUpsQuery.error, 'Failed to load follow-ups')}
          </Alert>
        ) : (
          <DataTable<FollowUpQueueItem>
            data={items}
            columns={columns}
            loading={followUpsQuery.isPending}
            loadingRowCount={6}
            emptyMessage={emptyMessage}
            onRowClick={handleOpenGuest}
            getRowId={(row) => String(row.note_id)}
            containerProps={{ sx: { borderRadius: 0, boxShadow: 'none' } }}
          />
        )}

        {/* Pagination footer — server-side paging via the `page` param. */}
        {pagination.hasMultiplePages && (
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              px: 2,
              py: 1.5,
              bgcolor: GUEST_DESIGN.paper2,
              borderTop: `1px solid ${GUEST_DESIGN.rule}`,
              fontSize: 12,
              color: GUEST_DESIGN.ink3,
            }}
          >
            <Box>
              Showing {pagination.startItem}–{pagination.endItem} of {pagination.totalItems}
            </Box>
            <Pagination
              count={pagination.totalPages}
              page={pagination.currentPage}
              onChange={(_, page) => setCurrentPage(page)}
              size="small"
              showFirstButton
              showLastButton
              sx={{
                '& .MuiPaginationItem-root': { fontSize: 12, fontWeight: 600 },
                '& .Mui-selected': { bgcolor: `${GUEST_DESIGN.green700} !important`, color: '#fff' },
              }}
            />
          </Box>
        )}
      </Paper>
    </Box>
  );
};

export default GuestRelationsFollowUpsPage;
