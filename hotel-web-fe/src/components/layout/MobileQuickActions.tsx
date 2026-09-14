import React from 'react';
import { Fab, List, ListItemButton, ListItemIcon, ListItemText } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AddTaskIcon from '@mui/icons-material/AddTask';
import BuildIcon from '@mui/icons-material/Build';
import FlightLandIcon from '@mui/icons-material/FlightLand';
import FlightTakeoffIcon from '@mui/icons-material/FlightTakeoff';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import PaymentsIcon from '@mui/icons-material/Payments';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import SearchIcon from '@mui/icons-material/Search';
import { useNavigate } from '../../router';
import { useAuth } from '../../auth/AuthContext';
import { useTranslation } from '../../i18n';
import { BottomSheet } from '../common/BottomSheet';
import { useCommandPalette } from './CommandPalette';
import { MOBILE_NAV_HEIGHT } from './MobileNavBar';
import {
  canAccessNavigationRoute,
  navigationRouteDefinitions,
} from '../../navigation/routeRegistry';

interface QuickAction {
  key: string;
  icon: React.ReactNode;
  run: () => void;
}

/**
 * Phone-only quick-action affordance: a FAB above the bottom nav that opens a
 * sheet of role-filtered staff actions. Every action delegates to a canonical
 * surface — deep links like `/bookings?create=1` (UnifiedBookingModal),
 * `/bookings?view=arriving`, `/housekeeping?create=ticket` — or the existing
 * command palette. Nothing here re-implements a workflow.
 */
export const MobileQuickActions: React.FC = () => {
  const [open, setOpen] = React.useState(false);
  const navigate = useNavigate();
  const { hasPermission, hasRole, getRoutePolicy } = useAuth();
  const { t: tNav } = useTranslation('nav');
  const { open: openPalette } = useCommandPalette();

  const canOpen = (routeId: string) => {
    const route = navigationRouteDefinitions.find((r) => r.id === routeId);
    return route
      ? canAccessNavigationRoute(route, { hasPermission, hasRole, getRoutePolicy })
      : false;
  };

  const candidates: (QuickAction | false)[] = [
    canOpen('bookings') && {
      key: 'newBooking',
      icon: <AddIcon />,
      run: () => navigate('/bookings?create=1'),
    },
    {
      key: 'search',
      icon: <SearchIcon />,
      run: () => openPalette(),
    },
    canOpen('bookings') && {
      key: 'todaysArrivals',
      icon: <FlightLandIcon />,
      run: () => navigate('/bookings?view=arriving'),
    },
    canOpen('bookings') && {
      key: 'todaysDepartures',
      icon: <FlightTakeoffIcon />,
      run: () => navigate('/bookings?view=departing'),
    },
    canOpen('bookings') && {
      key: 'collectPayment',
      icon: <PaymentsIcon />,
      run: () => navigate('/bookings?view=balance'),
    },
    (canOpen('room-management') || canOpen('housekeeping')) && {
      key: 'roomStatus',
      icon: <HomeWorkIcon />,
      run: () => navigate(canOpen('room-management') ? '/room-management' : '/housekeeping'),
    },
    canOpen('housekeeping') && {
      key: 'newTask',
      icon: <AddTaskIcon />,
      run: () => navigate('/housekeeping?create=task'),
    },
    canOpen('housekeeping') && {
      key: 'reportIssue',
      icon: <BuildIcon />,
      run: () => navigate('/housekeeping?create=ticket'),
    },
    canOpen('guest-config') && {
      key: 'newGuest',
      icon: <PersonAddIcon />,
      run: () => navigate('/guest-config'),
    },
  ];
  const actions = candidates.filter((a): a is QuickAction => Boolean(a));

  return (
    <>
      <Fab
        color="primary"
        size="medium"
        aria-label={tNav('mobile.quickActions')}
        onClick={() => setOpen(true)}
        sx={{
          position: 'fixed',
          right: 'calc(16px + var(--sar))',
          bottom: `calc(${MOBILE_NAV_HEIGHT}px + 16px + var(--sab))`,
          zIndex: (theme) => theme.zIndex.appBar - 1,
          display: { xs: 'flex', sm: 'none' },
        }}
      >
        <AddIcon />
      </Fab>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={tNav('mobile.quickActions')}>
        <List disablePadding>
          {actions.map((action) => (
            <ListItemButton
              key={action.key}
              sx={{ borderRadius: 2 }}
              onClick={() => {
                setOpen(false);
                action.run();
              }}
            >
              <ListItemIcon sx={{ minWidth: 40, color: 'primary.main' }}>{action.icon}</ListItemIcon>
              <ListItemText
                primary={tNav(`mobile.${action.key}`)}
                slotProps={{ primary: { sx: { fontWeight: 600 } } }}
              />
            </ListItemButton>
          ))}
        </List>
      </BottomSheet>
    </>
  );
};
