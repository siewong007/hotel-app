import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Link as MuiLink,
  Paper,
  Rating,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import {
  AddOutlined as AddIcon,
  OpenInNewOutlined as OpenIcon,
  RateReviewOutlined as ReviewIcon,
  SupportAgentOutlined as SupportIcon,
} from '@mui/icons-material';
import type {
  GuestProfileBooking,
  GuestReview,
  GuestSupportConversationSummary,
} from '../../../../types';
import { Link } from '../../../../router';
import { errorMessage } from '../../../../utils';
import { formatStatusLabel } from '../../../../utils/formatters';
import { formatHotelDate, formatHotelDateTime } from '../../../../utils/date';
import { getQueryErrorMessage } from '../../../../api/queryConfig';
import { emitApiNotification } from '../../../../utils/apiNotifications';
import {
  SupportPriorityChip,
  SupportSlaChip,
  SupportStatusChip,
} from '../../../support/components/SupportStatusChip';
import {
  useGuestReviews,
  useGuestSupportConversations,
  useRespondToReview,
} from '../../hooks/useGuestRelationsQueries';

const MAX_RESPONSE_CHARS = 2000;

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

interface SupportFeedbackTabProps {
  guestId: number;
  /** Profile reservations — resolves `booking_id` on reviews to booking numbers. */
  reservations: GuestProfileBooking[];
  /** `support:write` — shows the "New conversation" button. */
  canWriteSupport: boolean;
  /** `reviews:read` — without it the whole feedback section is hidden (the
   *  tab itself is gated on `support:read` by the page). */
  canViewReviews: boolean;
  /** `reviews:update` — enables the inline respond form. */
  canRespondToReviews: boolean;
  /** Opens the page-level `OpenSupportDialog` (the same instance the header's
   *  "Open a support request" quick action drives). */
  onNewConversation: () => void;
}

/**
 * Guest 360 "Support & Feedback" — the staff support queue entries for this
 * guest (read-only summary; work happens in `/support`, which has no
 * conversation deep-link param, so the link lands on the inbox) plus the
 * guest's reviews with an inline staff-response form.
 */
const SupportFeedbackTab: React.FC<SupportFeedbackTabProps> = ({
  guestId,
  reservations,
  canWriteSupport,
  canViewReviews,
  canRespondToReviews,
  onNewConversation,
}) => {
  const conversationsQuery = useGuestSupportConversations(guestId);
  const reviewsQuery = useGuestReviews(guestId, canViewReviews);
  const respondMutation = useRespondToReview();

  const conversations = conversationsQuery.data ?? [];
  const reviews = reviewsQuery.data ?? [];

  const [respondingTo, setRespondingTo] = useState<number | null>(null);
  const [responseDraft, setResponseDraft] = useState('');
  const [responseError, setResponseError] = useState<string | null>(null);

  const bookingLabel = (bookingId: number | null | undefined): string | null => {
    if (bookingId == null) return null;
    const booking = reservations.find((r) => r.id === bookingId);
    return booking?.booking_number || `#${bookingId}`;
  };

  const handleStartResponse = (review: GuestReview) => {
    setRespondingTo(review.id);
    setResponseDraft(review.response ?? '');
    setResponseError(null);
  };

  const handleSubmitResponse = async (review: GuestReview) => {
    const trimmed = responseDraft.trim();
    if (!trimmed) {
      setResponseError('A response is required');
      return;
    }
    try {
      setResponseError(null);
      await respondMutation.mutateAsync({
        guestId,
        reviewId: review.id,
        data: { response: trimmed },
      });
      emitApiNotification({ message: 'Review response saved', severity: 'success' });
      setRespondingTo(null);
      setResponseDraft('');
    } catch (err) {
      setResponseError(errorMessage(err, 'Failed to save review response'));
    }
  };

  const renderConversation = (conversation: GuestSupportConversationSummary) => (
    <TableRow key={conversation.id}>
      <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
        {conversation.conversation_number}
      </TableCell>
      <TableCell>
        <Chip size="small" variant="outlined" label={formatStatusLabel(conversation.category)} />
      </TableCell>
      <TableCell>
        <SupportStatusChip status={conversation.status} />
      </TableCell>
      <TableCell>
        <SupportPriorityChip priority={conversation.priority} />
      </TableCell>
      <TableCell>{conversation.assigned_to_name ?? 'Unassigned'}</TableCell>
      <TableCell>
        <SupportSlaChip
          isAtRisk={conversation.is_sla_at_risk}
          isBreached={conversation.is_sla_breached}
          dueAt={conversation.first_response_at == null
            ? conversation.first_response_due_at
            : conversation.resolution_due_at}
        />
      </TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>
        {formatHotelDateTime(conversation.last_activity_at)}
      </TableCell>
    </TableRow>
  );

  const renderReview = (review: GuestReview) => {
    const label = bookingLabel(review.booking_id);
    const isResponding = respondingTo === review.id;

    return (
      <Paper key={review.id} variant="outlined" sx={{ p: 1.5 }}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}
        >
          <Rating value={review.overall_rating} readOnly size="small" precision={0.5} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {review.overall_rating}/5
          </Typography>
          <Chip
            size="small"
            variant="outlined"
            color={review.is_published ? 'success' : 'default'}
            label={review.is_published ? 'Published' : 'Unpublished'}
          />
          {label && <Chip size="small" variant="outlined" label={`Booking ${label}`} />}
          <Box sx={{ flex: 1 }} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {formatHotelDate(review.created_at)}
          </Typography>
        </Stack>

        {review.title && (
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 1 }}>
            {review.title}
          </Typography>
        )}
        {review.content && (
          <Typography
            variant="body2"
            sx={{ mt: review.title ? 0.5 : 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
          >
            {review.content}
          </Typography>
        )}

        {isResponding ? (
          <Box sx={{ mt: 1.5 }}>
            {responseError && (
              <Alert severity="error" sx={{ mb: 1 }} onClose={() => setResponseError(null)}>
                {responseError}
              </Alert>
            )}
            <TextField
              label="Response to guest"
              value={responseDraft}
              onChange={(event) => setResponseDraft(event.target.value)}
              size="small"
              fullWidth
              multiline
              minRows={3}
              autoFocus
              slotProps={{ htmlInput: { maxLength: MAX_RESPONSE_CHARS } }}
              helperText={`${responseDraft.length}/${MAX_RESPONSE_CHARS} — posted as the property's public reply`}
            />
            <Stack direction="row" spacing={1} sx={{ mt: 1, justifyContent: 'flex-end' }}>
              <Button
                size="small"
                onClick={() => {
                  setRespondingTo(null);
                  setResponseDraft('');
                  setResponseError(null);
                }}
                disabled={respondMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                size="small"
                variant="contained"
                onClick={() => void handleSubmitResponse(review)}
                disabled={respondMutation.isPending || !responseDraft.trim()}
                sx={{ textTransform: 'none' }}
              >
                {respondMutation.isPending
                  ? 'Saving…'
                  : review.response
                    ? 'Update response'
                    : 'Post response'}
              </Button>
            </Stack>
          </Box>
        ) : (
          <Box sx={{ mt: 1.5 }}>
            {review.response ? (
              <Paper
                variant="outlined"
                sx={{ p: 1.25, bgcolor: 'action.hover', borderStyle: 'dashed' }}
              >
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 700, color: 'text.secondary', display: 'block' }}
                >
                  PROPERTY RESPONSE
                  {review.response_at ? ` · ${formatHotelDateTime(review.response_at)}` : ''}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ mt: 0.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                >
                  {review.response}
                </Typography>
              </Paper>
            ) : (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                No response yet.
              </Typography>
            )}
            {canRespondToReviews && (
              <Box sx={{ mt: 1 }}>
                <Button
                  size="small"
                  onClick={() => handleStartResponse(review)}
                  sx={{ textTransform: 'none' }}
                >
                  {review.response ? 'Edit response' : 'Respond'}
                </Button>
              </Box>
            )}
          </Box>
        )}
      </Paper>
    );
  };

  return (
    <Stack spacing={2.5}>
      <SectionCard
        title={
          <Stack
            direction="row"
            spacing={0.75}
            sx={{ alignItems: 'center', justifyContent: 'space-between', width: '100%' }}
          >
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <SupportIcon sx={{ fontSize: 16 }} />
              <span>
                Support conversations{conversations.length > 0 ? ` (${conversations.length})` : ''}
              </span>
            </Stack>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <MuiLink
                component={Link}
                to="/support"
                underline="hover"
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.5,
                  fontSize: 12,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                Open in Support
                <OpenIcon sx={{ fontSize: 13 }} />
              </MuiLink>
              {canWriteSupport && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={onNewConversation}
                  sx={{ textTransform: 'none' }}
                >
                  New conversation
                </Button>
              )}
            </Stack>
          </Stack>
        }
      >
        {conversationsQuery.isPending ? (
          <Skeleton variant="rounded" height={120} />
        ) : conversationsQuery.isError ? (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={() => void conversationsQuery.refetch()}>
                Retry
              </Button>
            }
          >
            {getQueryErrorMessage(
              conversationsQuery.error,
              'Failed to load support conversations',
            ) ?? 'Failed to load support conversations'}
          </Alert>
        ) : conversations.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            No support conversations for this guest.
            {canWriteSupport ? ' Use "New conversation" to file one on their behalf.' : ''}
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small" aria-label="Guest support conversations">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Conversation</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Category</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Priority</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Assignee</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>SLA</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Last activity</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>{conversations.map(renderConversation)}</TableBody>
            </Table>
          </TableContainer>
        )}
      </SectionCard>

      {canViewReviews && (
        <SectionCard
          title={
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <ReviewIcon sx={{ fontSize: 16 }} />
              <span>Feedback — reviews{reviews.length > 0 ? ` (${reviews.length})` : ''}</span>
            </Stack>
          }
        >
          {reviewsQuery.isPending ? (
            <Stack spacing={1.5}>
              <Skeleton variant="rounded" height={96} />
              <Skeleton variant="rounded" height={96} />
            </Stack>
          ) : reviewsQuery.isError ? (
            <Alert
              severity="error"
              action={
                <Button color="inherit" size="small" onClick={() => void reviewsQuery.refetch()}>
                  Retry
                </Button>
              }
            >
              {getQueryErrorMessage(reviewsQuery.error, 'Failed to load reviews') ??
                'Failed to load reviews'}
            </Alert>
          ) : reviews.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              No reviews from this guest yet.
            </Typography>
          ) : (
            <Stack spacing={1.5}>{reviews.map(renderReview)}</Stack>
          )}
        </SectionCard>
      )}
    </Stack>
  );
};

export default SupportFeedbackTab;
