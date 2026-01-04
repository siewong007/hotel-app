import React, { lazy, Suspense } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { Container, AppBar, Toolbar, Typography, Tabs, Tab, Box, Avatar, Menu, MenuItem, ListItemIcon, ListItemText, Divider, Breadcrumbs, IconButton, Tooltip } from '@mui/material';
import HotelIcon from '@mui/icons-material/Hotel';
import LogoutIcon from '@mui/icons-material/Logout';
import PersonIcon from '@mui/icons-material/Person';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import HomeIcon from '@mui/icons-material/Home';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import EventNoteIcon from '@mui/icons-material/EventNote';
import PeopleIcon from '@mui/icons-material/People';
import MeetingRoomIcon from '@mui/icons-material/MeetingRoom';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import SecurityIcon from '@mui/icons-material/Security';
import SettingsIcon from '@mui/icons-material/Settings';
import AssessmentIcon from '@mui/icons-material/Assessment';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import CardGiftcardIcon from '@mui/icons-material/CardGiftcard';
import CategoryIcon from '@mui/icons-material/Category';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import HistoryIcon from '@mui/icons-material/History';
import NightsStayIcon from '@mui/icons-material/NightsStay';
import { BrowserRouter as Router, Routes, Route, Link, useLocation, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';

// Import critical components from barrel exports
import { ProtectedRoute } from './features/auth';
import { AnimatedRoute, HotelSpinner, ErrorBoundary, PageErrorBoundary, ComponentErrorBoundary } from './components';

// Lazy load page components for code splitting - using feature barrel exports
const LandingPage = lazy(() => import('./components/layout/LandingPage'));
const DashboardRouter = lazy(() => import('./features/dashboard/components/DashboardRouter'));
const RoomsPage = lazy(() => import('./features/rooms/components/RoomsPage'));
const BookingsPage = lazy(() => import('./features/bookings/components/BookingsPage'));
const MyBookingsPage = lazy(() => import('./features/bookings/components/MyBookingsPage'));
const ModernReportsPage = lazy(() => import('./features/reports/components/ModernReportsPage'));
const LoyaltyPortal = lazy(() => import('./features/loyalty/components/LoyaltyPortal'));
const LoyaltyDashboard = lazy(() => import('./features/loyalty/components/LoyaltyDashboard'));
const UserProfilePage = lazy(() => import('./features/user/components/UserProfilePage'));
const SettingsPage = lazy(() => import('./features/user/components/SettingsPage'));
const RBACManagementPageV2 = lazy(() => import('./features/admin/components/rbac/RBACManagementPageV2'));
const EkycRegistrationPage = lazy(() => import('./features/ekyc/components/EkycRegistrationPage'));
const EkycManagementPage = lazy(() => import('./features/ekyc/components/EkycManagementPage'));
const LoginPage = lazy(() => import('./features/auth/components/LoginPage'));
const RegisterPage = lazy(() => import('./features/auth/components/RegisterPage'));
const EmailVerificationPage = lazy(() => import('./features/auth/components/EmailVerificationPage'));
const FirstLoginPasskeyPrompt = lazy(() => import('./features/auth/components/FirstLoginPasskeyPrompt'));
const RoomReservationTimeline = lazy(() => import('./features/rooms/components/RoomReservationTimeline'));
const RoomConfigurationPage = lazy(() => import('./features/rooms/components/RoomConfigurationPage'));
const RoomTypeConfigurationPage = lazy(() => import('./features/rooms/components/RoomTypeConfigurationPage'));
const RoomManagementPage = lazy(() => import('./features/rooms/components/RoomManagementPage'));
const GuestConfigurationPage = lazy(() => import('./features/guests/components/GuestConfigurationPage'));
const GuestCheckInLanding = lazy(() => import('./features/bookings/components/GuestCheckInLanding'));
const GuestCheckInVerify = lazy(() => import('./features/bookings/components/GuestCheckInVerify'));
const GuestCheckInForm = lazy(() => import('./features/bookings/components/GuestCheckInForm'));
const GuestCheckInConfirmation = lazy(() => import('./features/bookings/components/GuestCheckInConfirmation'));
const CustomerLedgerPage = lazy(() => import('./features/admin/components/CustomerLedgerPage'));
const ComplimentaryManagementPage = lazy(() => import('./features/admin/components/ComplimentaryManagementPage'));
const AuditLogPage = lazy(() => import('./features/admin/components/AuditLogPage'));
const NightAuditPage = lazy(() => import('./features/admin/components/NightAuditPage'));

// Loading fallback component with stable layout to prevent shifts
const LoadingFallback = () => (
  <Box
    sx={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: 'calc(100vh - 200px)',
      opacity: 0.8,
    }}
  >
    <HotelSpinner size={80} />
  </Box>
);

// Minimal loading fallback for smaller components (modals, etc.)
const MinimalLoadingFallback = () => (
  <Box
    sx={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100px',
    }}
  >
    <HotelSpinner size={40} />
  </Box>
);

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#26a69a', // Comfortable teal-green
      light: '#64d8cb',
      dark: '#00796b',
      contrastText: '#fff',
    },
    secondary: {
      main: '#00bcd4', // Bright cyan
      light: '#62efff',
      dark: '#008ba3',
      contrastText: '#fff',
    },
    background: {
      default: '#f1f8f6', // Light mint background
      paper: '#ffffff',
    },
    text: {
      primary: '#1a4d42', // Deep teal for text
      secondary: '#5f7976',
    },
    success: {
      main: '#26a69a',
      light: '#64d8cb',
      dark: '#00796b',
    },
    info: {
      main: '#00bcd4',
      light: '#62efff',
      dark: '#008ba3',
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: {
      fontWeight: 700,
      fontSize: '2.5rem',
    },
    h2: {
      fontWeight: 700,
      fontSize: '2rem',
    },
    h3: {
      fontWeight: 600,
      fontSize: '1.75rem',
    },
    h4: {
      fontWeight: 600,
      fontSize: '1.5rem',
    },
    h5: {
      fontWeight: 600,
      fontSize: '1.25rem',
    },
    h6: {
      fontWeight: 600,
      fontSize: '1rem',
    },
  },
  shape: {
    borderRadius: 12,
  },
  shadows: [
    'none',
    '0px 2px 4px rgba(0,0,0,0.05)',
    '0px 4px 8px rgba(0,0,0,0.08)',
    '0px 8px 16px rgba(0,0,0,0.1)',
    '0px 12px 24px rgba(0,0,0,0.12)',
    '0px 14px 28px rgba(0,0,0,0.13)',
    '0px 16px 32px rgba(0,0,0,0.14)',
    '0px 18px 36px rgba(0,0,0,0.15)',
    '0px 20px 40px rgba(0,0,0,0.16)',
    '0px 22px 44px rgba(0,0,0,0.17)',
    '0px 24px 48px rgba(0,0,0,0.18)',
    '0px 26px 52px rgba(0,0,0,0.19)',
    '0px 28px 56px rgba(0,0,0,0.20)',
    '0px 30px 60px rgba(0,0,0,0.21)',
    '0px 32px 64px rgba(0,0,0,0.22)',
    '0px 34px 68px rgba(0,0,0,0.23)',
    '0px 36px 72px rgba(0,0,0,0.24)',
    '0px 38px 76px rgba(0,0,0,0.25)',
    '0px 40px 80px rgba(0,0,0,0.26)',
    '0px 42px 84px rgba(0,0,0,0.27)',
    '0px 44px 88px rgba(0,0,0,0.28)',
    '0px 46px 92px rgba(0,0,0,0.29)',
    '0px 48px 96px rgba(0,0,0,0.30)',
    '0px 50px 100px rgba(0,0,0,0.31)',
    '0px 52px 104px rgba(0,0,0,0.32)',
  ] as any,
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        // Global styles for preventing screen glitches
        '*, *::before, *::after': {
          // Smooth font rendering
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
        },
        // Prevent FOUC (Flash of Unstyled Content)
        body: {
          visibility: 'visible',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: '0px 4px 12px rgba(0,0,0,0.08)',
          // GPU-accelerated transition
          transition: 'box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1), transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          willChange: 'transform, box-shadow',
          backfaceVisibility: 'hidden',
          '&:hover': {
            boxShadow: '0px 8px 24px rgba(0,0,0,0.12)',
            transform: 'translateY(-2px) translateZ(0)',
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          borderRadius: 8,
          padding: '10px 24px',
          // Smooth transitions for buttons
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: '0px 2px 8px rgba(0,0,0,0.1)',
          background: 'linear-gradient(135deg, #26a69a 0%, #00796b 100%)',
          // Prevent flicker on scroll
          willChange: 'transform',
          backfaceVisibility: 'hidden',
        },
      },
    },
    MuiModal: {
      styleOverrides: {
        root: {
          // Smooth modal transitions
          '& .MuiBackdrop-root': {
            transition: 'opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          },
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          // GPU-accelerated drawer
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
        },
      },
    },
  },
});

// Icon mapping for navigation items
const navIcons: Record<string, React.ReactElement> = {
  'timeline': <CalendarMonthIcon sx={{ fontSize: 18 }} />,
  'my-bookings': <EventNoteIcon sx={{ fontSize: 18 }} />,
  'guest-config': <PeopleIcon sx={{ fontSize: 18 }} />,
  'bookings': <EventNoteIcon sx={{ fontSize: 18 }} />,
  'room-management': <HomeWorkIcon sx={{ fontSize: 18 }} />,
  'ekyc-admin': <VerifiedUserIcon sx={{ fontSize: 18 }} />,
  'rbac': <SecurityIcon sx={{ fontSize: 18 }} />,
  'room-config': <MeetingRoomIcon sx={{ fontSize: 18 }} />,
  'room-type-config': <CategoryIcon sx={{ fontSize: 18 }} />,
  'company-ledger': <AccountBalanceIcon sx={{ fontSize: 18 }} />,
  'complimentary': <CardGiftcardIcon sx={{ fontSize: 18 }} />,
  'audit-log': <HistoryIcon sx={{ fontSize: 18 }} />,
  'night-audit': <NightsStayIcon sx={{ fontSize: 18 }} />,
  'reports': <AssessmentIcon sx={{ fontSize: 18 }} />,
  'settings': <SettingsIcon sx={{ fontSize: 18 }} />,
};

const NavigationTabs = React.memo(function NavigationTabs() {
  const location = useLocation();
  const navigate = useNavigate();
  const { hasPermission, hasRole, logout, user } = useAuth();

  // Navigation items configuration - permission and role-based architecture
  type NavGroup = 'main' | 'operations' | 'admin' | 'config';

  interface NavItem {
    id: string;
    label: string;
    path: string;
    permissions: string[]; // Array of permissions - user needs ANY of these to see the tab
    roles?: string[]; // Array of roles - user needs ANY of these to see the tab (optional)
    excludeRoles?: string[]; // Array of roles - user with ANY of these roles will NOT see the tab
    group: NavGroup; // Navigation group for organization
  }

  const navigationItems: NavItem[] = [
    // === MAIN TABS (Always visible in main nav) ===
    {
      id: 'timeline',
      label: 'Timeline',
      path: '/timeline',
      permissions: ['navigation_timeline:read', 'bookings:read'],
      roles: ['admin', 'receptionist', 'manager'],
      group: 'main',
    },
    {
      id: 'my-bookings',
      label: 'My Bookings',
      path: '/my-bookings',
      permissions: ['navigation_my_bookings:read'],
      excludeRoles: ['admin', 'receptionist', 'manager'],
      group: 'main',
    },
    {
      id: 'room-management',
      label: 'Rooms',
      path: '/room-management',
      permissions: ['navigation_room_management:read', 'rooms:read', 'rooms:manage'],
      roles: ['admin', 'receptionist', 'manager'],
      group: 'main',
    },
    {
      id: 'bookings',
      label: 'Bookings',
      path: '/bookings',
      permissions: ['navigation_bookings:read', 'bookings:manage'],
      roles: ['admin', 'receptionist', 'manager'],
      group: 'main',
    },
    {
      id: 'guest-config',
      label: 'Guests',
      path: '/guest-config',
      permissions: ['navigation_guest_config:read', 'guests:read', 'guests:manage'],
      roles: ['admin', 'receptionist', 'manager'],
      group: 'main',
    },
    // === OPERATIONS (In main nav, after divider) ===
    {
      id: 'company-ledger',
      label: 'Ledger',
      path: '/company-ledger',
      permissions: ['ledgers:read', 'ledgers:manage'],
      roles: ['admin', 'receptionist', 'manager'],
      group: 'operations',
    },
    {
      id: 'reports',
      label: 'Reports',
      path: '/reports',
      permissions: [],
      group: 'operations',
    },
    // === ADMIN (In "More" dropdown) ===
    {
      id: 'rbac',
      label: 'Access Control',
      path: '/rbac',
      permissions: ['rbac:manage', 'rbac:read', 'users:manage', 'users:read'],
      roles: ['admin', 'superadmin'],
      group: 'admin',
    },
    {
      id: 'ekyc-admin',
      label: 'eKYC Admin',
      path: '/ekyc-admin',
      permissions: ['ekyc:manage'],
      group: 'admin',
    },
    {
      id: 'complimentary',
      label: 'Complimentary Nights',
      path: '/complimentary',
      permissions: ['bookings:read', 'bookings:update'],
      roles: ['admin', 'manager'],
      group: 'admin',
    },
    {
      id: 'audit-log',
      label: 'Audit Log',
      path: '/audit-log',
      permissions: ['audit:read'],
      roles: ['admin', 'superadmin'],
      group: 'admin',
    },
    {
      id: 'night-audit',
      label: 'Night Audit',
      path: '/night-audit',
      permissions: ['night_audit:read', 'night_audit:run'],
      roles: ['admin', 'manager'],
      group: 'admin',
    },
    // === CONFIG (In "More" dropdown) ===
    {
      id: 'room-config',
      label: 'Room Configuration',
      path: '/room-config',
      permissions: ['navigation_room_config:read', 'rooms:update', 'rooms:manage'],
      roles: ['admin', 'receptionist', 'manager'],
      group: 'config',
    },
    {
      id: 'room-type-config',
      label: 'Room Types',
      path: '/room-type-config',
      permissions: ['rooms:write', 'rooms:manage'],
      roles: ['admin', 'manager'],
      group: 'config',
    },
    {
      id: 'settings',
      label: 'Settings',
      path: '/settings',
      permissions: ['navigation_settings:read', 'settings:read', 'settings:manage'],
      group: 'config',
    },
  ];

  // Helper to check if user can see an item
  const canSeeItem = (item: NavItem): boolean => {
    // First check if user should be excluded (case-insensitive)
    const isExcluded = item.excludeRoles?.some(role =>
      hasRole(role) || hasRole(role.toLowerCase()) || hasRole(role.charAt(0).toUpperCase() + role.slice(1).toLowerCase())
    ) ?? false;
    if (isExcluded) return false;

    // If no permissions and no roles specified, show to all authenticated users
    const noRestrictions = item.permissions.length === 0 && (!item.roles || item.roles.length === 0);
    if (noRestrictions) return true;

    const hasRequiredPermission = item.permissions.some(perm => hasPermission(perm));
    // Case-insensitive role matching
    const hasRequiredRole = item.roles?.some(role =>
      hasRole(role) || hasRole(role.toLowerCase()) || hasRole(role.charAt(0).toUpperCase() + role.slice(1).toLowerCase())
    ) ?? false;

    return hasRequiredPermission || hasRequiredRole;
  };

  // Get visible items by group
  const visibleItems = navigationItems.filter(canSeeItem);
  const mainNavItems = visibleItems.filter(item => item.group === 'main' || item.group === 'operations');
  const moreMenuItems = visibleItems.filter(item => item.group === 'admin' || item.group === 'config');

  // Build visible tabs for main nav only (for tab index calculation)
  const visibleTabs: string[] = mainNavItems.map(item => item.path);

  // Calculate current tab index
  const currentTab = visibleTabs.indexOf(location.pathname);
  const isMoreMenuActive = moreMenuItems.some(item => item.path === location.pathname);
  const activeTab = currentTab >= 0 ? currentTab : false;

  // Get user initials for avatar
  const getUserInitials = () => {
    if (user?.full_name) {
      const names = user.full_name.split(' ');
      return names.length > 1
        ? `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase()
        : names[0][0].toUpperCase();
    }
    return user?.username?.[0]?.toUpperCase() || 'U';
  };

  // User menu state
  const [userMenuAnchor, setUserMenuAnchor] = React.useState<null | HTMLElement>(null);
  const userMenuOpen = Boolean(userMenuAnchor);

  // More menu state
  const [moreMenuAnchor, setMoreMenuAnchor] = React.useState<null | HTMLElement>(null);
  const moreMenuOpen = Boolean(moreMenuAnchor);

  const handleUserMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setUserMenuAnchor(event.currentTarget);
  };

  const handleUserMenuClose = () => {
    setUserMenuAnchor(null);
  };

  const handleMoreMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setMoreMenuAnchor(event.currentTarget);
  };

  const handleMoreMenuClose = () => {
    setMoreMenuAnchor(null);
  };

  const handleMenuItemClick = (path: string) => {
    handleUserMenuClose();
    handleMoreMenuClose();
    navigate(path);
  };

  const handleLogout = () => {
    handleUserMenuClose();
    logout();
    navigate('/login');
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 1 }}>
      <Tabs
        value={activeTab}
        textColor="inherit"
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          flexGrow: 1,
          minHeight: 56,
          '& .MuiTab-root': {
            color: 'rgba(255, 255, 255, 0.75)',
            fontWeight: 500,
            minHeight: 56,
            px: 2,
            fontSize: '0.85rem',
            textTransform: 'none',
            '&.Mui-selected': {
              color: 'white',
              fontWeight: 600,
            },
            '&:hover': {
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              color: 'white',
            },
          },
          '& .MuiTabs-indicator': {
            backgroundColor: 'white',
            height: 3,
            borderRadius: '3px 3px 0 0',
          },
          '& .MuiTabs-scrollButtons': {
            color: 'white',
            '&.Mui-disabled': {
              opacity: 0.3,
            },
          },
        }}
      >
        {mainNavItems.map(item => (
          <Tab
            key={item.id}
            icon={navIcons[item.id] || undefined}
            iconPosition="start"
            label={item.label}
            component={Link}
            to={item.path}
            sx={{
              gap: 0.75,
              '& .MuiTab-iconWrapper': {
                marginRight: 0,
                marginBottom: 0,
              },
            }}
          />
        ))}
      </Tabs>

      {/* More Menu Button - Only show if there are items in it */}
      {moreMenuItems.length > 0 && (
        <>
          <Tooltip title="More options">
            <IconButton
              onClick={handleMoreMenuOpen}
              sx={{
                color: isMoreMenuActive ? 'white' : 'rgba(255, 255, 255, 0.75)',
                bgcolor: isMoreMenuActive || moreMenuOpen ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
                borderRadius: 2,
                px: 1.5,
                '&:hover': {
                  bgcolor: 'rgba(255, 255, 255, 0.15)',
                  color: 'white',
                },
              }}
            >
              <MoreHorizIcon sx={{ fontSize: 20 }} />
              <Typography
                variant="body2"
                sx={{
                  ml: 0.5,
                  fontSize: '0.85rem',
                  fontWeight: isMoreMenuActive ? 600 : 500,
                  display: { xs: 'none', sm: 'block' },
                }}
              >
                More
              </Typography>
            </IconButton>
          </Tooltip>

          {/* More Dropdown Menu */}
          <Menu
            anchorEl={moreMenuAnchor}
            open={moreMenuOpen}
            onClose={handleMoreMenuClose}
            transformOrigin={{ horizontal: 'right', vertical: 'top' }}
            anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
            slotProps={{
              paper: {
                elevation: 8,
                sx: {
                  mt: 1,
                  minWidth: 220,
                  borderRadius: 2,
                  overflow: 'visible',
                  '&::before': {
                    content: '""',
                    display: 'block',
                    position: 'absolute',
                    top: 0,
                    right: 20,
                    width: 10,
                    height: 10,
                    bgcolor: 'background.paper',
                    transform: 'translateY(-50%) rotate(45deg)',
                    zIndex: 0,
                  },
                },
              },
            }}
          >
              {/* Admin Section Header */}
            {moreMenuItems.filter(item => item.group === 'admin').length > 0 && (
              <Box key="admin-header" sx={{ px: 2, py: 1, bgcolor: 'grey.50' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  ADMINISTRATION
                </Typography>
              </Box>
            )}
            {/* Admin Section Items */}
            {moreMenuItems
              .filter(item => item.group === 'admin')
              .map(item => (
                <MenuItem
                  key={item.id}
                  onClick={() => handleMenuItemClick(item.path)}
                  selected={location.pathname === item.path}
                  sx={{ py: 1.25 }}
                >
                  <ListItemIcon>{navIcons[item.id]}</ListItemIcon>
                  <ListItemText>{item.label}</ListItemText>
                </MenuItem>
              ))}

            {/* Divider between sections */}
            {moreMenuItems.filter(item => item.group === 'admin').length > 0 &&
              moreMenuItems.filter(item => item.group === 'config').length > 0 && (
              <Divider key="section-divider" />
            )}

            {/* Config Section Header */}
            {moreMenuItems.filter(item => item.group === 'config').length > 0 && (
              <Box key="config-header" sx={{ px: 2, py: 1, bgcolor: 'grey.50' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  CONFIGURATION
                </Typography>
              </Box>
            )}
            {/* Config Section Items */}
            {moreMenuItems
              .filter(item => item.group === 'config')
              .map(item => (
                <MenuItem
                  key={item.id}
                  onClick={() => handleMenuItemClick(item.path)}
                  selected={location.pathname === item.path}
                  sx={{ py: 1.25 }}
                >
                  <ListItemIcon>{navIcons[item.id]}</ListItemIcon>
                  <ListItemText>{item.label}</ListItemText>
                </MenuItem>
              ))}
          </Menu>
        </>
      )}

      {/* User Section */}
      <Box sx={{ display: 'flex', alignItems: 'center', ml: 'auto' }}>
        <Box
          onClick={handleUserMenuOpen}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            pl: 0.75,
            pr: 1.5,
            py: 0.5,
            borderRadius: 3,
            backgroundColor: userMenuOpen ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.08)',
            border: '1px solid',
            borderColor: userMenuOpen ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.12)',
            cursor: 'pointer',
            userSelect: 'none',
            '&:hover': {
              backgroundColor: 'rgba(255, 255, 255, 0.15)',
              borderColor: 'rgba(255, 255, 255, 0.25)',
            },
          }}
        >
          <Box
            sx={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Avatar
              sx={{
                width: 32,
                height: 32,
                fontSize: '0.8rem',
                fontWeight: 700,
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                boxShadow: '0 2px 8px rgba(102, 126, 234, 0.4)',
              }}
            >
              {getUserInitials()}
            </Avatar>
            <Box
              sx={{
                position: 'absolute',
                bottom: -1,
                right: -1,
                width: 10,
                height: 10,
                borderRadius: '50%',
                bgcolor: '#4caf50',
                border: '2px solid #1a1a2e',
              }}
            />
          </Box>
          <Box sx={{ display: { xs: 'none', md: 'flex' }, flexDirection: 'column', alignItems: 'flex-start' }}>
            <Typography
              variant="body2"
              sx={{
                color: 'white',
                fontWeight: 600,
                fontSize: '0.8rem',
                lineHeight: 1.2,
                letterSpacing: '0.01em',
              }}
            >
              {user?.full_name || user?.username}
            </Typography>
            <Typography
              variant="caption"
              sx={{
                color: 'rgba(255, 255, 255, 0.6)',
                fontSize: '0.65rem',
                lineHeight: 1,
                textTransform: 'capitalize',
              }}
            >
              {user?.username || 'Staff'}
            </Typography>
          </Box>
          <KeyboardArrowDownIcon
            sx={{
              fontSize: 18,
              color: 'rgba(255, 255, 255, 0.6)',
              transition: 'transform 0.2s',
              transform: userMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          />
        </Box>

        {/* User Dropdown Menu */}
        <Menu
          anchorEl={userMenuAnchor}
          open={userMenuOpen}
          onClose={handleUserMenuClose}
          onClick={handleUserMenuClose}
          transformOrigin={{ horizontal: 'right', vertical: 'top' }}
          anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
          slotProps={{
            paper: {
              elevation: 8,
              sx: {
                mt: 1,
                minWidth: 200,
                borderRadius: 2,
                overflow: 'visible',
                '&::before': {
                  content: '""',
                  display: 'block',
                  position: 'absolute',
                  top: 0,
                  right: 20,
                  width: 10,
                  height: 10,
                  bgcolor: 'background.paper',
                  transform: 'translateY(-50%) rotate(45deg)',
                  zIndex: 0,
                },
              },
            },
          }}
        >
          {/* User Info Header */}
          <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {user?.full_name || user?.username}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {user?.email || user?.username}
            </Typography>
          </Box>

          <MenuItem onClick={() => handleMenuItemClick('/profile?edit=true')} sx={{ py: 1.25 }}>
            <ListItemIcon>
              <PersonIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>My Profile</ListItemText>
          </MenuItem>

          <MenuItem onClick={() => handleMenuItemClick('/settings')} sx={{ py: 1.25 }}>
            <ListItemIcon>
              <ManageAccountsIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Account Settings</ListItemText>
          </MenuItem>

          <MenuItem onClick={() => handleMenuItemClick('/help')} sx={{ py: 1.25 }}>
            <ListItemIcon>
              <HelpOutlineIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Help & Support</ListItemText>
          </MenuItem>

          <Divider sx={{ my: 1 }} />

          <MenuItem
            onClick={handleLogout}
            sx={{
              py: 1.25,
              color: 'error.main',
              '&:hover': {
                backgroundColor: 'error.lighter',
              },
            }}
          >
            <ListItemIcon>
              <LogoutIcon fontSize="small" sx={{ color: 'error.main' }} />
            </ListItemIcon>
            <ListItemText>Sign Out</ListItemText>
          </MenuItem>
        </Menu>
      </Box>
    </Box>
  );
});

// Breadcrumb configuration - maps routes to display names and icons
const breadcrumbConfig: Record<string, { label: string; icon?: React.ReactElement }> = {
  '/': { label: 'Dashboard', icon: <HomeIcon sx={{ fontSize: 16 }} /> },
  '/timeline': { label: 'Reservation Timeline', icon: <CalendarMonthIcon sx={{ fontSize: 16 }} /> },
  '/my-bookings': { label: 'My Bookings', icon: <EventNoteIcon sx={{ fontSize: 16 }} /> },
  '/guest-config': { label: 'Guest Management', icon: <PeopleIcon sx={{ fontSize: 16 }} /> },
  '/bookings': { label: 'Bookings', icon: <EventNoteIcon sx={{ fontSize: 16 }} /> },
  '/room-management': { label: 'Room Management', icon: <HomeWorkIcon sx={{ fontSize: 16 }} /> },
  '/ekyc-admin': { label: 'eKYC Admin', icon: <VerifiedUserIcon sx={{ fontSize: 16 }} /> },
  '/rbac': { label: 'Access Control', icon: <SecurityIcon sx={{ fontSize: 16 }} /> },
  '/room-config': { label: 'Room Configuration', icon: <MeetingRoomIcon sx={{ fontSize: 16 }} /> },
  '/room-type-config': { label: 'Room Types', icon: <CategoryIcon sx={{ fontSize: 16 }} /> },
  '/company-ledger': { label: 'Company Ledger', icon: <AccountBalanceIcon sx={{ fontSize: 16 }} /> },
  '/complimentary': { label: 'Complimentary Nights', icon: <CardGiftcardIcon sx={{ fontSize: 16 }} /> },
  '/audit-log': { label: 'Audit Log', icon: <HistoryIcon sx={{ fontSize: 16 }} /> },
  '/night-audit': { label: 'Night Audit', icon: <NightsStayIcon sx={{ fontSize: 16 }} /> },
  '/reports': { label: 'Reports', icon: <AssessmentIcon sx={{ fontSize: 16 }} /> },
  '/settings': { label: 'Settings', icon: <SettingsIcon sx={{ fontSize: 16 }} /> },
  '/profile': { label: 'My Profile', icon: <PersonIcon sx={{ fontSize: 16 }} /> },
  '/help': { label: 'Help & Support', icon: <HelpOutlineIcon sx={{ fontSize: 16 }} /> },
  '/rooms': { label: 'Rooms', icon: <MeetingRoomIcon sx={{ fontSize: 16 }} /> },
};

const BreadcrumbNav = React.memo(function BreadcrumbNav() {
  const location = useLocation();
  const pathnames = location.pathname.split('/').filter((x) => x);

  // Don't show breadcrumbs on dashboard (home)
  if (location.pathname === '/') {
    return null;
  }

  // Build breadcrumb items
  const breadcrumbItems: { path: string; label: string; icon?: React.ReactElement; isLast: boolean }[] = [
    { path: '/', label: 'Dashboard', icon: <HomeIcon sx={{ fontSize: 16 }} />, isLast: false },
  ];

  let currentPath = '';
  pathnames.forEach((segment, index) => {
    currentPath += `/${segment}`;
    const config = breadcrumbConfig[currentPath];
    const isLast = index === pathnames.length - 1;

    if (config) {
      breadcrumbItems.push({
        path: currentPath,
        label: config.label,
        icon: config.icon,
        isLast,
      });
    } else {
      // Handle dynamic segments (e.g., /bookings/123)
      const formattedSegment = segment
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      breadcrumbItems.push({
        path: currentPath,
        label: formattedSegment,
        isLast,
      });
    }
  });

  // Get the current page info for the title
  const currentPage = breadcrumbItems[breadcrumbItems.length - 1];

  return (
    <Box
      sx={{
        bgcolor: 'background.paper',
        borderBottom: '1px solid',
        borderColor: 'divider',
        px: { xs: 2, sm: 3 },
        py: 1.5,
      }}
    >
      <Container maxWidth="xl" sx={{ px: { xs: 0, sm: 0 } }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: { xs: 'flex-start', sm: 'center' },
            justifyContent: 'space-between',
            flexDirection: { xs: 'column', sm: 'row' },
            gap: { xs: 0.5, sm: 2 },
          }}
        >
          {/* Page Title */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {currentPage.icon && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 36,
                  height: 36,
                  borderRadius: 1.5,
                  bgcolor: 'primary.50',
                  color: 'primary.main',
                  '& svg': { fontSize: 20 },
                }}
              >
                {currentPage.icon}
              </Box>
            )}
            <Typography
              variant="h6"
              sx={{
                fontWeight: 700,
                fontSize: { xs: '1.1rem', sm: '1.25rem' },
                color: 'text.primary',
                lineHeight: 1.2,
              }}
            >
              {currentPage.label}
            </Typography>
          </Box>

          {/* Breadcrumbs */}
          <Breadcrumbs
            separator={<NavigateNextIcon sx={{ fontSize: 14, color: 'text.disabled' }} />}
            aria-label="breadcrumb"
            sx={{
              '& .MuiBreadcrumbs-ol': {
                flexWrap: 'nowrap',
              },
              '& .MuiBreadcrumbs-separator': {
                mx: 0.5,
              },
            }}
          >
            {breadcrumbItems.slice(0, -1).map((item) => (
              <Box
                key={item.path}
                component={Link}
                to={item.path}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  color: 'text.secondary',
                  textDecoration: 'none',
                  fontSize: '0.75rem',
                  '&:hover': {
                    color: 'primary.main',
                    textDecoration: 'underline',
                  },
                }}
              >
                {item.icon && (
                  <Box sx={{ display: 'flex', '& svg': { fontSize: 14 } }}>{item.icon}</Box>
                )}
                <Typography variant="caption" sx={{ fontSize: '0.75rem' }}>
                  {item.label}
                </Typography>
              </Box>
            ))}
            <Typography
              variant="caption"
              sx={{
                color: 'text.primary',
                fontWeight: 600,
                fontSize: '0.75rem',
              }}
            >
              {currentPage.label}
            </Typography>
          </Breadcrumbs>
        </Box>
      </Container>
    </Box>
  );
});

function AppContent() {
  const { isAuthenticated, shouldPromptPasskey, user, dismissPasskeyPrompt } = useAuth();

  if (!isAuthenticated) {
    return (
      <ErrorBoundary title="Authentication Error">
        <Suspense fallback={<LoadingFallback />}>
          <Routes>
            <Route
              path="/"
              element={
                <AnimatedRoute animationType="fade">
                  <LandingPage />
                </AnimatedRoute>
              }
            />
            <Route
              path="/login"
              element={
                <AnimatedRoute animationType="fade">
                  <LoginPage />
                </AnimatedRoute>
              }
            />
            <Route
              path="/register"
              element={
                <AnimatedRoute animationType="fade">
                  <RegisterPage />
                </AnimatedRoute>
              }
            />
            <Route
              path="/verify-email"
              element={
                <AnimatedRoute animationType="fade">
                  <EmailVerificationPage />
                </AnimatedRoute>
              }
            />
            <Route
              path="/guest-checkin"
              element={
                <AnimatedRoute animationType="fade">
                  <GuestCheckInLanding />
                </AnimatedRoute>
              }
            />
            <Route
              path="/guest-checkin/verify"
              element={
                <AnimatedRoute animationType="fade">
                  <GuestCheckInVerify />
                </AnimatedRoute>
              }
            />
            <Route
              path="/guest-checkin/form"
              element={
                <AnimatedRoute animationType="fade">
                  <GuestCheckInForm />
                </AnimatedRoute>
              }
            />
            <Route
              path="/guest-checkin/confirm"
              element={
                <AnimatedRoute animationType="fade">
                  <GuestCheckInConfirmation />
                </AnimatedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    );
  }

  return (
    <Box sx={{ flexGrow: 1, minHeight: '100vh', backgroundColor: 'background.default' }}>
      <AppBar position="sticky" elevation={0}>
        <Toolbar sx={{ minHeight: 64, px: { xs: 2, sm: 3 } }}>
          <Box
            component={Link}
            to="/"
            sx={{
              display: 'flex',
              alignItems: 'center',
              textDecoration: 'none',
              cursor: 'pointer',
              mr: 3,
              flexShrink: 0,
              '&:hover': {
                opacity: 0.9,
              },
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 36,
                height: 36,
                borderRadius: 1.5,
                bgcolor: 'rgba(255, 255, 255, 0.15)',
                mr: 1.5,
              }}
            >
              <HotelIcon sx={{ fontSize: 22, color: 'white' }} />
            </Box>
            <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
              <Typography variant="body1" sx={{ fontWeight: 700, color: 'white', lineHeight: 1.2 }}>
                Hotel Manager
              </Typography>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.65rem' }}>
                Management System
              </Typography>
            </Box>
          </Box>
          <NavigationTabs />
        </Toolbar>
      </AppBar>

      {/* Breadcrumb Navigation */}
      <BreadcrumbNav />

      {/* Passkey Registration Prompt */}
      <Suspense fallback={<MinimalLoadingFallback />}>
        <FirstLoginPasskeyPrompt
          open={shouldPromptPasskey}
          username={user?.username || ''}
          onClose={dismissPasskeyPrompt}
        />
      </Suspense>

      <Container
        maxWidth="xl"
        sx={{
          mt: 4,
          mb: 4,
          px: { xs: 2, sm: 3 },
          // Stable layout container to prevent shifts
          minHeight: 'calc(100vh - 200px)',
          contain: 'layout style',
          isolation: 'isolate',
        }}
      >
        <PageErrorBoundary>
          <Suspense fallback={<LoadingFallback />}>
            <Routes>
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <AnimatedRoute animationType="fade">
                    <ComponentErrorBoundary>
                      <DashboardRouter />
                    </ComponentErrorBoundary>
                  </AnimatedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/rooms"
              element={
                <ProtectedRoute requiredPermission="rooms:read">
                  <AnimatedRoute animationType="slide">
                    <ComponentErrorBoundary>
                      <RoomsPage />
                    </ComponentErrorBoundary>
                  </AnimatedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/timeline"
              element={
                <ProtectedRoute requiredPermission="rooms:read">
                  <AnimatedRoute animationType="slide">
                    <ComponentErrorBoundary>
                      <RoomReservationTimeline />
                    </ComponentErrorBoundary>
                  </AnimatedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/guest-config"
              element={
                <ProtectedRoute>
                  <AnimatedRoute animationType="slide">
                    <ComponentErrorBoundary>
                      <GuestConfigurationPage />
                    </ComponentErrorBoundary>
                  </AnimatedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/bookings"
              element={
                <ProtectedRoute requiredRoles={['admin', 'receptionist', 'manager']}>
                  <AnimatedRoute animationType="slide">
                    <ComponentErrorBoundary>
                      <BookingsPage />
                    </ComponentErrorBoundary>
                  </AnimatedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/my-bookings"
              element={
                <AnimatedRoute animationType="slide">
                  <ComponentErrorBoundary>
                    <MyBookingsPage />
                  </ComponentErrorBoundary>
                </AnimatedRoute>
              }
            />
            <Route
              path="/room-management"
              element={
                <ProtectedRoute requiredRoles={['admin', 'receptionist', 'manager']}>
                  <AnimatedRoute animationType="slide">
                    <ComponentErrorBoundary>
                      <RoomManagementPage />
                    </ComponentErrorBoundary>
                  </AnimatedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/reports"
              element={
                <ProtectedRoute>
                  <AnimatedRoute animationType="grow">
                    <ComponentErrorBoundary>
                      <ModernReportsPage />
                    </ComponentErrorBoundary>
                  </AnimatedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/loyalty"
              element={
                <ProtectedRoute requiredPermission="analytics:read">
                  <AnimatedRoute animationType="grow">
                    <ComponentErrorBoundary>
                      <LoyaltyPortal />
                    </ComponentErrorBoundary>
                  </AnimatedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/my-rewards"
              element={
                <ProtectedRoute>
                  <AnimatedRoute animationType="grow">
                    <ComponentErrorBoundary>
                      <LoyaltyDashboard />
                    </ComponentErrorBoundary>
                  </AnimatedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <AnimatedRoute animationType="fade">
                    <ComponentErrorBoundary>
                      <UserProfilePage />
                    </ComponentErrorBoundary>
                  </AnimatedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/ekyc"
              element={
                <ProtectedRoute>
                  <AnimatedRoute animationType="slide">
                    <ComponentErrorBoundary>
                      <EkycRegistrationPage />
                    </ComponentErrorBoundary>
                  </AnimatedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/rbac"
              element={
                <ProtectedRoute requiredRoles={['admin', 'superadmin']}>
                  <AnimatedRoute animationType="fade">
                    <ComponentErrorBoundary>
                      <RBACManagementPageV2 />
                    </ComponentErrorBoundary>
                  </AnimatedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/ekyc-admin"
              element={
                <ProtectedRoute requiredPermission="ekyc:manage">
                  <AnimatedRoute animationType="slide">
                    <ComponentErrorBoundary>
                      <EkycManagementPage />
                    </ComponentErrorBoundary>
                  </AnimatedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/room-config"
              element={
                <ProtectedRoute requiredRoles={['admin', 'receptionist', 'manager']}>
                  <AnimatedRoute animationType="fade">
                    <ComponentErrorBoundary>
                      <RoomConfigurationPage />
                    </ComponentErrorBoundary>
                  </AnimatedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/room-type-config"
              element={
                <ProtectedRoute requiredRoles={['admin', 'manager']}>
                  <AnimatedRoute animationType="fade">
                    <ComponentErrorBoundary>
                      <RoomTypeConfigurationPage />
                    </ComponentErrorBoundary>
                  </AnimatedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <ProtectedRoute requiredPermission="settings:read">
                  <AnimatedRoute animationType="fade">
                    <ComponentErrorBoundary>
                      <SettingsPage />
                    </ComponentErrorBoundary>
                  </AnimatedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/company-ledger"
              element={
                <ProtectedRoute requiredRoles={['admin', 'receptionist', 'manager']}>
                  <AnimatedRoute animationType="slide">
                    <ComponentErrorBoundary>
                      <CustomerLedgerPage />
                    </ComponentErrorBoundary>
                  </AnimatedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/complimentary"
              element={
                <ProtectedRoute requiredRoles={['admin', 'manager']}>
                  <AnimatedRoute animationType="slide">
                    <ComponentErrorBoundary>
                      <ComplimentaryManagementPage />
                    </ComponentErrorBoundary>
                  </AnimatedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/audit-log"
              element={
                <ProtectedRoute requiredPermission="audit:read">
                  <AnimatedRoute animationType="fade">
                    <ComponentErrorBoundary>
                      <AuditLogPage />
                    </ComponentErrorBoundary>
                  </AnimatedRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/night-audit"
              element={
                <ProtectedRoute requiredRoles={['admin', 'manager']}>
                  <AnimatedRoute animationType="fade">
                    <ComponentErrorBoundary>
                      <NightAuditPage />
                    </ComponentErrorBoundary>
                  </AnimatedRoute>
                </ProtectedRoute>
              }
            />
            <Route path="/login" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </PageErrorBoundary>
      </Container>
    </Box>
  );
}

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <Router>
          <Suspense fallback={<LoadingFallback />}>
            <AppContent />
          </Suspense>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
