import React, { lazy, Suspense } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { Container, AppBar, Toolbar, Typography, Tabs, Tab, Box, Button } from '@mui/material';
import HotelIcon from '@mui/icons-material/Hotel';
import LogoutIcon from '@mui/icons-material/Logout';
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
const EnhancedRBACManagementPage = lazy(() => import('./features/admin/components/EnhancedRBACManagementPage'));
const EkycRegistrationPage = lazy(() => import('./features/ekyc/components/EkycRegistrationPage'));
const EkycManagementPage = lazy(() => import('./features/ekyc/components/EkycManagementPage'));
const LoginPage = lazy(() => import('./features/auth/components/LoginPage'));
const RegisterPage = lazy(() => import('./features/auth/components/RegisterPage'));
const EmailVerificationPage = lazy(() => import('./features/auth/components/EmailVerificationPage'));
const FirstLoginPasskeyPrompt = lazy(() => import('./features/auth/components/FirstLoginPasskeyPrompt'));
const RoomReservationTimeline = lazy(() => import('./features/rooms/components/RoomReservationTimeline'));
const RoomConfigurationPage = lazy(() => import('./features/rooms/components/RoomConfigurationPage'));
const RoomManagementPage = lazy(() => import('./features/rooms/components/RoomManagementPage'));
const GuestConfigurationPage = lazy(() => import('./features/guests/components/GuestConfigurationPage'));
const GuestCheckInLanding = lazy(() => import('./features/bookings/components/GuestCheckInLanding'));
const GuestCheckInVerify = lazy(() => import('./features/bookings/components/GuestCheckInVerify'));
const GuestCheckInForm = lazy(() => import('./features/bookings/components/GuestCheckInForm'));
const GuestCheckInConfirmation = lazy(() => import('./features/bookings/components/GuestCheckInConfirmation'));
const CustomerLedgerPage = lazy(() => import('./features/admin/components/CustomerLedgerPage'));
const ComplimentaryManagementPage = lazy(() => import('./features/admin/components/ComplimentaryManagementPage'));

// Loading fallback component
const LoadingFallback = () => (
  <Box
    sx={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '60vh',
    }}
  >
    <HotelSpinner size={120} />
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
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: '0px 4px 12px rgba(0,0,0,0.08)',
          transition: 'all 0.3s ease-in-out',
          '&:hover': {
            boxShadow: '0px 8px 24px rgba(0,0,0,0.12)',
            transform: 'translateY(-2px)',
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
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: '0px 2px 8px rgba(0,0,0,0.1)',
          background: 'linear-gradient(135deg, #26a69a 0%, #00796b 100%)',
        },
      },
    },
  },
});

const NavigationTabs = React.memo(function NavigationTabs() {
  const location = useLocation();
  const navigate = useNavigate();
  const { hasPermission, hasRole, logout, user } = useAuth();

  // Navigation items configuration - permission and role-based architecture
  interface NavItem {
    id: string;
    label: string;
    path: string;
    permissions: string[]; // Array of permissions - user needs ANY of these to see the tab
    roles?: string[]; // Array of roles - user needs ANY of these to see the tab (optional)
    excludeRoles?: string[]; // Array of roles - user with ANY of these roles will NOT see the tab
  }

  const navigationItems: NavItem[] = [
    {
      id: 'timeline',
      label: 'Reservation Timeline',
      path: '/timeline',
      permissions: ['navigation_timeline:read', 'bookings:read'],
      roles: ['admin', 'receptionist', 'manager']
    },
    {
      id: 'my-bookings',
      label: 'My Bookings',
      path: '/my-bookings',
      permissions: ['navigation_my_bookings:read'],
      excludeRoles: ['admin', 'receptionist', 'manager'] // Staff should not see this tab
    },
    {
      id: 'guest-config',
      label: 'Guest',
      path: '/guest-config',
      permissions: ['navigation_guest_config:read', 'guests:read', 'guests:manage'],
      roles: ['admin', 'receptionist', 'manager']
    },
    {
      id: 'bookings',
      label: 'Bookings',
      path: '/bookings',
      permissions: ['navigation_bookings:read', 'bookings:manage'],
      roles: ['admin', 'receptionist', 'manager']
    },
    {
      id: 'room-management',
      label: 'Room Management',
      path: '/room-management',
      permissions: ['navigation_room_management:read', 'rooms:read', 'rooms:manage'],
      roles: ['admin', 'receptionist', 'manager']
    },
    {
      id: 'ekyc-admin',
      label: 'eKYC Verification',
      path: '/ekyc-admin',
      permissions: ['ekyc:manage']
    },
    {
      id: 'rbac',
      label: 'Roles',
      path: '/rbac',
      permissions: ['rbac:manage', 'rbac:read'],
      roles: ['admin']
    },
    {
      id: 'room-config',
      label: 'Room Config',
      path: '/room-config',
      permissions: ['navigation_room_config:read', 'rooms:update', 'rooms:manage'],
      roles: ['admin', 'receptionist', 'manager']
    },
    {
      id: 'company-ledger',
      label: 'Company Ledger',
      path: '/company-ledger',
      permissions: ['ledgers:read', 'ledgers:manage'],
      roles: ['admin', 'receptionist', 'manager']
    },
    {
      id: 'complimentary',
      label: 'Complimentary',
      path: '/complimentary',
      permissions: ['bookings:read', 'bookings:update'],
      roles: ['admin', 'manager']
    },
    {
      id: 'reports',
      label: 'Reports',
      path: '/reports',
      permissions: [], // No permission required - visible to all authenticated users
    },
    {
      id: 'settings',
      label: 'Settings',
      path: '/settings',
      permissions: ['navigation_settings:read', 'settings:read', 'settings:manage']
    },
  ];

  // Build visible tabs array - user needs ANY of the listed permissions OR ANY of the listed roles to see the tab
  // But if user has ANY of the excludeRoles, they will NOT see the tab
  // If no permissions AND no roles are specified, the tab is visible to all authenticated users
  const visibleTabs: string[] = navigationItems
    .filter(item => {
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
    })
    .map(item => item.path);

  // Calculate current tab index based on visible tabs
  const currentTab = visibleTabs.indexOf(location.pathname);
  const activeTab = currentTab >= 0 ? currentTab : false;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 2 }}>
      <Tabs
        value={activeTab}
        textColor="inherit"
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          flexGrow: 1,
          '& .MuiTab-root': {
            color: 'rgba(255, 255, 255, 0.7)',
            fontWeight: 500,
            minHeight: 48,
            transition: 'all 0.2s ease-in-out',
            '&.Mui-selected': {
              color: 'white',
              fontWeight: 600,
            },
            '&:hover': {
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              transform: 'translateY(-1px)',
            },
          },
          '& .MuiTabs-indicator': {
            backgroundColor: 'white',
            height: 3,
            borderRadius: '3px 3px 0 0',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          },
        }}
      >
        {navigationItems
          .filter(item => visibleTabs.includes(item.path))
          .map(item => (
            <Tab
              key={item.id}
              label={item.label}
              component={Link}
              to={item.path}
            />
          ))
        }
      </Tabs>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, ml: 2 }}>
        <Box
          component={Link}
          to="/profile?edit=true"
          sx={{
            display: { xs: 'none', sm: 'flex' },
            alignItems: 'center',
            gap: 1,
            px: 2,
            py: 0.5,
            borderRadius: 2,
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            textDecoration: 'none',
            cursor: 'pointer',
            transition: 'all 0.2s ease-in-out',
            '&:hover': {
              backgroundColor: 'rgba(255, 255, 255, 0.2)',
              transform: 'translateY(-1px)',
            },
          }}
        >
          <Typography variant="body2" sx={{ color: 'white', fontWeight: 500 }}>
            {user?.full_name || user?.username}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<LogoutIcon />}
          onClick={() => {
            logout();
            navigate('/login');
          }}
          size="small"
          sx={{
            color: 'white',
            borderColor: 'rgba(255, 255, 255, 0.5)',
            '&:hover': {
              borderColor: 'white',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
            },
          }}
        >
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Logout</Box>
        </Button>
      </Box>
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
        <Toolbar sx={{ py: 1 }}>
          <Box
            component={Link}
            to="/"
            sx={{
              display: 'flex',
              alignItems: 'center',
              textDecoration: 'none',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              '&:hover': {
                transform: 'scale(1.05)',
              },
            }}
          >
            <HotelIcon sx={{ mr: 2, fontSize: 32, color: 'white' }} />
            <Typography variant="h6" component="div" sx={{ fontWeight: 700, color: 'white' }}>
              Hotel Management System
            </Typography>
          </Box>
          <Box sx={{ flexGrow: 1 }} />
          <NavigationTabs />
        </Toolbar>
      </AppBar>

      {/* Passkey Registration Prompt */}
      <Suspense fallback={null}>
        <FirstLoginPasskeyPrompt
          open={shouldPromptPasskey}
          username={user?.username || ''}
          onClose={dismissPasskeyPrompt}
        />
      </Suspense>

      <Container maxWidth="xl" sx={{ mt: 4, mb: 4, px: { xs: 2, sm: 3 } }}>
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
                <ProtectedRoute requiredRole="admin">
                  <AnimatedRoute animationType="fade">
                    <ComponentErrorBoundary>
                      <EnhancedRBACManagementPage />
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
