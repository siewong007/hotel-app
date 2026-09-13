import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import {
  BlockOutlined as SuppressedIcon,
  EditOutlined as EditIcon,
  MailOutlineOutlined as MailIcon,
  SendOutlined as DeliveryIcon,
  SubscriptionsOutlined as SubscriptionsIcon,
} from '@mui/icons-material';
import { formatStatusLabel } from '../../../../utils/formatters';
import { formatHotelDateTime } from '../../../../utils/date';
import { getQueryErrorMessage } from '../../../../api/queryConfig';
import { emitApiNotification } from '../../../../utils/apiNotifications';
import { ProfileDetailRow } from '../../../guests/components/GuestProfileParts';
import { TOPIC_LABELS, type NotificationTopic } from '../../../communications/types';
import { useGuestCommunications } from '../../hooks/useGuestRelationsQueries';
import GuestConsentDialog from '../GuestConsentDialog';

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

const DELIVERY_STATUS_COLORS: Record<string, 'success' | 'error' | 'warning' | 'default' | 'info'> = {
  sent: 'success',
  delivered: 'success',
  failed: 'error',
  bounced: 'error',
  suppressed: 'warning',
  queued: 'info',
  pending: 'info',
};

const deliveryStatusColor = (status: string) => DELIVERY_STATUS_COLORS[status] ?? 'default';

interface CommunicationTabProps {
  guestId: number;
  guestName: string;
  /** `communications:manage` — the consent endpoint requires it, so the
   *  "Edit consent" affordance hides without it. */
  canManageConsent: boolean;
}

/**
 * Guest 360 "Communication" — consent state, per-topic email subscriptions,
 * and recent deliveries from `GET /guests/{id}/communications`. Read-only
 * except the consent editor, which records staff-captured opt-ins through the
 * communications module's admin endpoint.
 */
const CommunicationTab: React.FC<CommunicationTabProps> = ({
  guestId,
  guestName,
  canManageConsent,
}) => {
  const communicationsQuery = useGuestCommunications(guestId);
  const [consentDialogOpen, setConsentDialogOpen] = useState(false);

  const summary = communicationsQuery.data;

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
              <MailIcon sx={{ fontSize: 16 }} />
              <span>Consent & contact preferences</span>
            </Stack>
            {canManageConsent && summary && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<EditIcon />}
                onClick={() => setConsentDialogOpen(true)}
                sx={{ textTransform: 'none' }}
              >
                Edit consent
              </Button>
            )}
          </Stack>
        }
      >
        {communicationsQuery.isPending ? (
          <Skeleton variant="rounded" height={96} />
        ) : communicationsQuery.isError ? (
          <Alert
            severity="error"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => void communicationsQuery.refetch()}
              >
                Retry
              </Button>
            }
          >
            {getQueryErrorMessage(
              communicationsQuery.error,
              'Failed to load communication preferences',
            ) ?? 'Failed to load communication preferences'}
          </Alert>
        ) : summary ? (
          <>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
                gap: 2,
              }}
            >
              <ProfileDetailRow
                label="Marketing opt-in"
                value={
                  <Chip
                    size="small"
                    color={summary.marketing_opt_in ? 'success' : 'default'}
                    variant={summary.marketing_opt_in ? 'filled' : 'outlined'}
                    label={summary.marketing_opt_in ? 'Opted in' : 'Opted out'}
                  />
                }
              />
              <ProfileDetailRow
                label="Preferred channel"
                value={summary.communication_preference}
              />
              <ProfileDetailRow label="Language" value={summary.language_preference} />
              <ProfileDetailRow
                label="Email deliverability"
                value={
                  summary.email_suppressed ? (
                    <Chip
                      size="small"
                      color="error"
                      icon={<SuppressedIcon sx={{ fontSize: 14 }} />}
                      label="Suppressed — do not email"
                    />
                  ) : (
                    <Chip size="small" variant="outlined" color="success" label="Deliverable" />
                  )
                }
              />
            </Box>
            {summary.email_suppressed && (
              <Alert severity="warning" sx={{ mt: 1.5 }}>
                This guest's address is on the suppression list (unsubscribe, bounce, or complaint).
                Marketing email is held back until the suppression is lifted in Communications.
              </Alert>
            )}
            <Typography
              variant="caption"
              sx={{ color: 'text.secondary', display: 'block', mt: 1.5 }}
            >
              Marketing opt-in and topic subscriptions gate optional mail only — transactional
              messages (booking confirmations, receipts, check-in details) still go out.
            </Typography>
          </>
        ) : null}
      </SectionCard>

      {summary && (
        <>
          <SectionCard
            title={
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                <SubscriptionsIcon sx={{ fontSize: 16 }} />
                <span>
                  Topic subscriptions
                  {summary.subscriptions.length > 0 ? ` (${summary.subscriptions.length})` : ''}
                </span>
              </Stack>
            }
          >
            {summary.subscriptions.length === 0 ? (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                No topic subscriptions recorded — the guest is treated as opted out of all optional
                topics.
              </Typography>
            ) : (
              <TableContainer>
                <Table size="small" aria-label="Topic subscriptions">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>Topic</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Channel</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Subscribed</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Updated</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {summary.subscriptions.map((subscription) => (
                      <TableRow key={`${subscription.channel}:${subscription.topic}`}>
                        <TableCell>
                          {TOPIC_LABELS[subscription.topic as NotificationTopic] ??
                            formatStatusLabel(subscription.topic)}
                        </TableCell>
                        <TableCell>{formatStatusLabel(subscription.channel)}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            color={subscription.subscribed ? 'success' : 'default'}
                            variant={subscription.subscribed ? 'filled' : 'outlined'}
                            label={subscription.subscribed ? 'Subscribed' : 'Unsubscribed'}
                          />
                        </TableCell>
                        <TableCell>{formatHotelDateTime(subscription.updated_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </SectionCard>

          <SectionCard
            title={
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                <DeliveryIcon sx={{ fontSize: 16 }} />
                <span>
                  Recent deliveries
                  {summary.recent_deliveries.length > 0
                    ? ` (${summary.recent_deliveries.length})`
                    : ''}
                </span>
              </Stack>
            }
          >
            {summary.recent_deliveries.length === 0 ? (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                No recent deliveries to this guest.
              </Typography>
            ) : (
              <TableContainer>
                <Table size="small" aria-label="Recent deliveries">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>Kind</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Subject</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Date</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {summary.recent_deliveries.map((delivery) => (
                      <TableRow key={delivery.id}>
                        <TableCell>{formatStatusLabel(delivery.kind)}</TableCell>
                        <TableCell sx={{ overflowWrap: 'anywhere' }}>
                          {delivery.subject ?? '—'}
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            variant="outlined"
                            color={deliveryStatusColor(delivery.status)}
                            label={formatStatusLabel(delivery.status)}
                          />
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {formatHotelDateTime(delivery.created_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </SectionCard>
        </>
      )}

      {summary && (
        <GuestConsentDialog
          open={consentDialogOpen}
          guestId={guestId}
          guestName={guestName}
          subscriptions={summary.subscriptions}
          onClose={() => setConsentDialogOpen(false)}
          onSaved={(message) => emitApiNotification({ message, severity: 'success' })}
        />
      )}
    </Stack>
  );
};

export default CommunicationTab;
