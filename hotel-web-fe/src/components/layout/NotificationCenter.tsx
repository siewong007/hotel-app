import React from 'react';
import {
  Badge,
  Box,
  Button,
  IconButton,
  Popover,
  Tooltip,
  Typography,
} from '@mui/material';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import CloseIcon from '@mui/icons-material/Close';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import type { ApiNotificationSeverity } from '../../utils/apiNotifications';
import {
  clearAll,
  markAllRead,
  removeNotification,
  useNotifications,
} from '../../utils/notificationStore';
import { useAuth } from '../../auth/AuthContext';

const SEVERITY_META: Record<
  ApiNotificationSeverity,
  { color: string; Icon: React.ComponentType<{ fontSize?: 'small' | 'inherit' | 'medium' | 'large' }> }
> = {
  error: { color: '#d32f2f', Icon: ErrorOutlineIcon },
  warning: { color: '#ed6c02', Icon: WarningAmberIcon },
  info: { color: '#0288d1', Icon: InfoOutlinedIcon },
  success: { color: '#2e7d32', Icon: CheckCircleOutlineIcon },
};

const PRIORITY_LABEL = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
} as const;

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(timestamp).toLocaleString();
}

interface NotificationCenterProps {
  /** White-on-dark appbar styling for the bell icon. */
  darkBg?: boolean;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({ darkBg = false }) => {
  const { user } = useAuth();
  const userId = user?.id;
  const { items, unreadCount } = useNotifications(userId);
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
    // Opening the center acknowledges the unread notifications.
    markAllRead(userId);
  };
  const handleClose = () => setAnchorEl(null);

  const iconColor = darkBg ? 'rgba(255,255,255,0.92)' : 'inherit';

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton
          onClick={handleOpen}
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
          sx={{
            flexShrink: 0,
            color: iconColor,
            display: { xs: 'none', sm: 'inline-flex' },
            '&:hover': { bgcolor: darkBg ? 'rgba(255,255,255,0.14)' : 'action.hover' },
          }}
        >
          <Badge
            badgeContent={unreadCount}
            color="error"
            max={99}
            overlap="circular"
          >
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
        slotProps={{ paper: { sx: { mt: 1, width: 'min(380px, 92vw)', borderRadius: 2, overflow: 'hidden' } } }}
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
          <Typography sx={{ fontSize: '0.9rem', fontWeight: 700 }}>Notifications</Typography>
          {items.length > 0 && (
            <Button size="small" onClick={() => clearAll(userId)} sx={{ textTransform: 'none', fontSize: '0.75rem' }}>
              Clear all
            </Button>
          )}
        </Box>

        <Box sx={{ maxHeight: 420, overflowY: 'auto' }}>
          {items.length === 0 ? (
            <Box sx={{ px: 2, py: 5, textAlign: 'center', color: 'text.secondary' }}>
              <NotificationsNoneIcon sx={{ fontSize: 32, opacity: 0.4, mb: 1 }} />
              <Typography sx={{ fontSize: '0.85rem' }}>You&apos;re all caught up</Typography>
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
                      {PRIORITY_LABEL[item.priority]} priority · {formatRelativeTime(item.timestamp)}
                    </Typography>
                  </Box>
                  <IconButton
                    className="notification-dismiss"
                    size="small"
                    onClick={() => removeNotification(item.id, userId)}
                    aria-label="Dismiss notification"
                    sx={{ opacity: 0, transition: 'opacity 0.15s', flexShrink: 0 }}
                  >
                    <CloseIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Box>
              );
            })
          )}
        </Box>
      </Popover>
    </>
  );
};
