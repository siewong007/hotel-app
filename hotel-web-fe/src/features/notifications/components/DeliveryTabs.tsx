import React from 'react';
import { Box, Chip, Tab, Tabs, Typography } from '@mui/material';

import { useTranslation, statusLabel } from '../../../i18n';
import type { DeliveryFeedItem, TierFilter } from '../types';
import { formatRelativeIso } from '../utils/relativeTime';

export const DELIVERY_STATUS_COLORS: Record<string, 'default' | 'info' | 'warning' | 'success' | 'error'> = {
  queued: 'info',
  sending: 'warning',
  sent: 'success',
  failed: 'error',
  suppressed: 'default',
  cancelled: 'default',
};

/** Tier value → translation key (resolved through the caller's `t`). */
export const TIER_TAB_KEYS: Record<TierFilter, string> = {
  all: 'common:field.all',
  transactional: 'tier.transactional',
  marketing: 'tier.marketing',
};

interface DeliveryTabsProps {
  tier: TierFilter;
  onTierChange: (tier: TierFilter) => void;
  items: DeliveryFeedItem[];
  emptyMessage: string;
  /** Hide the built-in tab strip when the host already renders tier tabs. */
  showTabs?: boolean;
}

/**
 * Priority-tabbed delivery list shared by the bell popover and the full
 * /notifications page. Tiers come from the backend (kind-derived).
 */
export const DeliveryTabs: React.FC<DeliveryTabsProps> = ({
  tier,
  onTierChange,
  items,
  emptyMessage,
  showTabs = true,
}) => {
  const { t } = useTranslation('notifications');
  return (
  <>
    {showTabs && (
    <Tabs
      value={tier}
      onChange={(_, next: TierFilter) => onTierChange(next)}
      variant="fullWidth"
      sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36, fontSize: '0.78rem' } }}
    >
      {(Object.keys(TIER_TAB_KEYS) as TierFilter[]).map((key) => (
        <Tab key={key} value={key} label={t(TIER_TAB_KEYS[key])} />
      ))}
    </Tabs>
    )}
    <Box sx={{ maxHeight: 420, overflowY: 'auto' }}>
      {items.length === 0 ? (
        <Box sx={{ px: 2, py: 5, textAlign: 'center', color: 'text.secondary' }}>
          <Typography sx={{ fontSize: '0.85rem' }}>{emptyMessage}</Typography>
        </Box>
      ) : (
        items.map((item) => (
          <Box
            key={item.id}
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 1.25,
              px: 2,
              py: 1.25,
              borderBottom: '1px solid',
              borderColor: 'divider',
              '&:last-of-type': { borderBottom: 'none' },
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.82rem', lineHeight: 1.35, wordBreak: 'break-word' }}>
                {item.subject ?? item.kind}
              </Typography>
              <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', mt: 0.25 }}>
                {item.recipient_masked} · {formatRelativeIso(item.created_at, t)}
              </Typography>
            </Box>
            <Chip
              size="small"
              label={statusLabel(t, 'email_delivery', item.status)}
              color={DELIVERY_STATUS_COLORS[item.status] ?? 'default'}
              variant="outlined"
              sx={{ flexShrink: 0, fontSize: '0.68rem' }}
            />
          </Box>
        ))
      )}
    </Box>
  </>
  );
};
