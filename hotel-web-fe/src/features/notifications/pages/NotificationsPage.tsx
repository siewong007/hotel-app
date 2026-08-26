import React from 'react';
import { Box, Button, MenuItem, Pagination, Select, Typography } from '@mui/material';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';

import { useAuth } from '../../../auth/AuthContext';
import { useDeliveryFeed } from '../hooks/useDeliveryFeed';
import { DeliveryTabs, TIER_TAB_LABELS } from '../components/DeliveryTabs';
import type { TierFilter } from '../types';

const DELIVERY_STATUSES = ['queued', 'sending', 'sent', 'failed', 'suppressed', 'cancelled'];

/**
 * Full-page notification center: every outbound guest delivery, grouped into
 * priority tabs derived from the delivery kind.
 */
const NotificationsPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const [tier, setTier] = React.useState<TierFilter>('all');
  const [status, setStatus] = React.useState('');
  const [page, setPage] = React.useState(1);

  const canReadFeed = hasPermission('communications:read');
  const feed = useDeliveryFeed(
    { tier, status: status || undefined, page },
    canReadFeed,
  );
  const totalPages = Math.max(1, Math.ceil((feed.data?.total ?? 0) / (feed.data?.page_size ?? 20)));

  if (!canReadFeed) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h5" sx={{ mb: 2 }}>Notifications</Typography>
        <Typography color="text.secondary">
          You do not have permission to view the notification center.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h5">Notifications</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Select
            size="small"
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            displayEmpty
            aria-label="Filter by status"
            sx={{ minWidth: 140 }}
          >
            <MenuItem value="">All statuses</MenuItem>
            {DELIVERY_STATUSES.map((s) => (
              <MenuItem key={s} value={s}>{s}</MenuItem>
            ))}
          </Select>
        </Box>
      </Box>

      <Box
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          overflow: 'hidden',
          bgcolor: 'background.paper',
        }}
      >
        <DeliveryTabs
          tier={tier}
          onTierChange={(next) => { setTier(next); setPage(1); }}
          items={feed.data?.items ?? []}
          emptyMessage={
            feed.isPending ? 'Loading…' : TIER_TAB_LABELS[tier] + ': nothing here yet'
          }
        />
      </Box>

      {(feed.data?.total ?? 0) > (feed.data?.page_size ?? 20) ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <Pagination
            count={totalPages}
            page={page}
            onChange={(_, next) => setPage(next)}
            color="primary"
          />
        </Box>
      ) : (
        (feed.data?.total ?? 0) === 0 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
            <Button startIcon={<NotificationsNoneIcon />} disabled sx={{ textTransform: 'none' }}>
              No deliveries match the current filters
            </Button>
          </Box>
        )
      )}
    </Box>
  );
};

export default NotificationsPage;
