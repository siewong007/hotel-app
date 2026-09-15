import React from 'react';
import {
  Badge,
  Box,
  Button,
  IconButton,
  Popover,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import CloseIcon from '@mui/icons-material/Close';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import type { ApiNotificationSeverity, ApiNotificationPriority } from '../../utils/apiNotifications';
import {
  clearAll,
  markAllRead,
  removeNotification,
  useNotifications,
} from '../../utils/notificationStore';
import { useAuth } from '../../auth/AuthContext';
import { useTranslation } from '../../i18n';
import { Link } from '../../router/compat';
import { useDeliveryFeed } from '../../features/notifications/hooks/useDeliveryFeed';
import { DeliveryTabs, TIER_TAB_KEYS } from '../../features/notifications/components/DeliveryTabs';
import { formatRelativeMs } from '../../features/notifications/utils/relativeTime';
import type { TierFilter } from '../../features/notifications/types';
import {
  useMarkAllStaffNotificationsRead,
  useStaffNotifications,
} from '../../features/admin/system/hooks';

const SEVERITY_META: Record<
  ApiNotificationSeverity,
  { color: string; Icon: React.ComponentType<{ fontSize?: 'small' | 'inherit' | 'medium' | 'large' }> }
> = {
  error: { color: 'var(--hotel-danger)', Icon: ErrorOutlineIcon },
  warning: { color: 'var(--hotel-warning)', Icon: WarningAmberIcon },
  info: { color: 'var(--hotel-info)', Icon: InfoOutlinedIcon },
  success: { color: 'var(--hotel-success)', Icon: CheckCircleOutlineIcon },
};

/** Priority value → `notifications` translation key. */
const PRIORITY_KEYS: Record<ApiNotificationPriority, string> = {
  info: 'priority.info',
  warning: 'priority.warning',
  critical: 'priority.critical',
};

/** Which popover tab is active: in-app alerts, persisted staff alerts, or one
 * of the guest-email server tiers. */
type CenterTab = 'alerts' | 'system' | TierFilter;

export const NotificationCenter: React.FC = () => {
  const { user, hasPermission } = useAuth();
  const { t } = useTranslation('notifications');
  const userId = user?.id;
  const { items, unreadCount } = useNotifications(userId);
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const [tab, setTab] = React.useState<CenterTab>('alerts');
  const open = Boolean(anchorEl);

  // Staff holding communications:read additionally see the guest-email outbox
  // feed, grouped into priority tiers by delivery kind.
  const canReadFeed = hasPermission('communications:read');
  const feedTier: TierFilter = tab === 'alerts' || tab === 'system' ? 'all' : tab;
  const feed = useDeliveryFeed(
    { tier: feedTier },
    open && canReadFeed && tab !== 'alerts' && tab !== 'system',
  );
  const serverUnread = canReadFeed ? feed.data?.unread ?? null : null;

  // Persisted staff alerts (job failures today) are addressed to permission
  // holders — gated on settings:manage, matching the producer's audience.
  const canSeeStaffAlerts = hasPermission('settings:manage');
  const staffAlerts = useStaffNotifications(canSeeStaffAlerts, open);
  const markAllStaffRead = useMarkAllStaffNotificationsRead();
  const staffUnread = canSeeStaffAlerts ? staffAlerts.data?.unread ?? 0 : 0;

  const badgeCount = unreadCount + (serverUnread ?? 0) + staffUnread;

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
    // Opening the center acknowledges the unread in-app notifications.
    markAllRead(userId);
  };
  const handleClose = () => setAnchorEl(null);

  return (
    <>
      <Tooltip title={t('title')}>
        <IconButton
          onClick={handleOpen}
          aria-label={
            badgeCount > 0 ? t('center.unreadAria', { count: badgeCount }) : t('title')
          }
          sx={{
            flexShrink: 0,
            color: 'inherit',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <Badge badgeContent={badgeCount} color="error" max={99} overlap="circular">
            <NotificationsNoneIcon fontSize="small" />
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { mt: 1, width: 'min(420px, 92vw)', borderRadius: 2, overflow: 'hidden' } } }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 2,
            py: 1.25,
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography sx={{ fontSize: '0.9rem', fontWeight: 700 }}>{t('title')}</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {items.length > 0 && (
              <Button size="small" onClick={() => clearAll(userId)} sx={{ textTransform: 'none', fontSize: '0.75rem' }}>
                {t('center.clearAll')}
              </Button>
            )}
            {canReadFeed && (
              <Button
                size="small"
                component={Link}
                to="/notifications"
                onClick={handleClose}
                sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                aria-label={t('center.viewAllAria')}
              >
                {t('common:actions.viewAll')}
              </Button>
            )}
          </Box>
        </Box>

        {(canReadFeed || canSeeStaffAlerts) && (
          <Tabs
            value={tab}
            onChange={(_, next: CenterTab) => {
              setTab(next);
              if (next === 'system') markAllStaffRead.mutate();
            }}
            variant="fullWidth"
            sx={{ minHeight: 36, borderBottom: '1px solid', borderColor: 'divider', '& .MuiTab-root': { minHeight: 36, fontSize: '0.75rem' } }}
          >
            <Tab value="alerts" label={t('center.alerts')} />
            {canSeeStaffAlerts && <Tab value="system" label={t('center.system')} />}
            {canReadFeed &&
              (Object.keys(TIER_TAB_KEYS) as TierFilter[]).map((key) => (
                <Tab key={key} value={key} label={t(TIER_TAB_KEYS[key])} />
              ))}
          </Tabs>
        )}

        {canSeeStaffAlerts && tab === 'system' ? (
          <Box sx={{ maxHeight: 420, overflowY: 'auto' }}>
            {(staffAlerts.data?.items ?? []).length === 0 ? (
              <Box sx={{ px: 2, py: 5, textAlign: 'center', color: 'text.secondary' }}>
                <NotificationsNoneIcon sx={{ fontSize: 32, opacity: 0.4, mb: 1 }} />
                <Typography sx={{ fontSize: '0.85rem' }}>
                  {staffAlerts.isPending ? t('common:state.loading') : t('center.noSystemAlerts')}
                </Typography>
              </Box>
            ) : (
              (staffAlerts.data?.items ?? []).map((item) => (
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
                  <Box sx={{ color: 'var(--hotel-danger)', display: 'flex', mt: '2px' }}>
                    <ErrorOutlineIcon fontSize="small" />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      sx={{
                        fontSize: '0.82rem',
                        lineHeight: 1.35,
                        fontWeight: item.read_at ? 400 : 600,
                      }}
                    >
                      {item.title}
                    </Typography>
                    {item.body && (
                      <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', mt: 0.25 }}>
                        {item.body}
                      </Typography>
                    )}
                    <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', mt: 0.25 }}>
                      {formatRelativeMs(Date.parse(item.created_at), t)}
                    </Typography>
                  </Box>
                </Box>
              ))
            )}
          </Box>
        ) : canReadFeed && tab !== 'alerts' ? (
          <DeliveryTabs
            showTabs={false}
            tier={feedTier}
            onTierChange={(next) => setTab(next)}
            items={feed.data?.items ?? []}
            emptyMessage={
              feed.isPending ? t('common:state.loading') : t('center.allCaughtUp')
            }
          />
        ) : (
          <Box sx={{ maxHeight: 420, overflowY: 'auto' }}>
            {items.length === 0 ? (
              <Box sx={{ px: 2, py: 5, textAlign: 'center', color: 'text.secondary' }}>
                <NotificationsNoneIcon sx={{ fontSize: 32, opacity: 0.4, mb: 1 }} />
                <Typography sx={{ fontSize: '0.85rem' }}>{t('center.allCaughtUp')}</Typography>
              </Box>
            ) : (
              items.map((item) => {
                const meta = SEVERITY_META[item.severity] ?? SEVERITY_META.info;
                const { Icon } = meta;
                return (
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
                      '&:hover .notification-dismiss': { opacity: 1 },
                    }}
                  >
                    <Box sx={{ color: meta.color, display: 'flex', mt: '2px' }}>
                      <Icon fontSize="small" />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontSize: '0.82rem', lineHeight: 1.35, wordBreak: 'break-word' }}>
                        {item.message}
                      </Typography>
                      <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', mt: 0.25 }}>
                        {t('meta', {
                          priority: t(PRIORITY_KEYS[item.priority]),
                          time: formatRelativeMs(item.timestamp, t),
                        })}
                      </Typography>
                    </Box>
                    <IconButton
                      className="notification-dismiss"
                      size="small"
                      onClick={() => removeNotification(item.id, userId)}
                      aria-label={t('center.dismiss')}
                      sx={{ opacity: 0, transition: 'opacity 0.15s', flexShrink: 0 }}
                    >
                      <CloseIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Box>
                );
              })
            )}
          </Box>
        )}
      </Popover>
    </>
  );
};
