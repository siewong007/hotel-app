import React, { lazy, Suspense } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { Container, AppBar, Toolbar, Typography, Tabs, Tab, Box, Button } from '@mui/material';
import HotelIcon from '@mui/icons-material/Hotel';
import LogoutIcon from '@mui/icons-material/Logout';
import { BrowserRouter as Router, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';

// Import only critical components (always needed)
import { ProtectedRoute } from './components/ProtectedRoute';
import { AnimatedRoute } from './components/AnimatedRoute';
import HotelSpinner from './components/HotelSpinner';

// Lazy load page components for code splitting
const Dashboard = lazy(() => import('./components/Dashboard'));
const RoomsPage = lazy(() => import('./components/RoomsPage'));
const GuestsPage = lazy(() => import('./components/GuestsPage'));
const BookingsPage = lazy(() => import('./components/BookingsPage'));
const MyBookingsPage = lazy(() => import('./components/MyBookingsPage'));
const AnalyticsDashboard = lazy(() => import('./components/AnalyticsDashboard'));
const ReportsPage = lazy(() => import('./components/ReportsPage'));
const LoyaltyPortal = lazy(() => import('./components/LoyaltyPortal'));
const LoyaltyDashboard = lazy(() => import('./components/LoyaltyDashboard'));
const RewardsManagementPage = lazy(() => import('./components/RewardsManagementPage'));
const UserProfilePage = lazy(() => import('./components/UserProfilePage'));
const SettingsPage = lazy(() => import('./components/SettingsPage'));
const RBACManagementPage = lazy(() => import('./components/RBACManagementPage'));
const LoginPage = lazy(() => import('./components/LoginPage'));
const APITestPage = lazy(() => import('./components/APITestPage'));
const FirstLoginPasskeyPrompt = lazy(() => import('./components/FirstLoginPasskeyPrompt'));

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
      main: '#1a73e8',
      light: '#4285f4',
      dark: '#1557b0',
      contrastText: '#fff',
    },
    secondary: {
      main: '#ff6b6b',
      light: '#ff8787',
      dark: '#ee5a52',
      contrastText: '#fff',
    },
    background: {
      default: '#f5f7fa',
      paper: '#ffffff',
    },
    text: {
      primary: '#2d3748',
      secondary: '#718096',
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
          background: 'linear-gradient(135deg, #1a73e8 0%, #1557b0 100%)',
        },
      },
    },
  },
});

const NavigationTabs = React.memo(function NavigationTabs() {
  const location = useLocation();
  const { hasPermission, hasRole, logout, user } = useAuth();

  const pathToIndex: Record<string, number> = {
    '/rooms': 0,
    '/my-bookings': 1,
    '/guests': 2,
    '/bookings': 3,
    '/analytics': 4,
    '/reports': 5,
    '/loyalty': 6,
    '/my-rewards': 7,
    '/rewards-admin': 8,
    '/profile': 9,
    '/rbac': 10,
    '/api-test': 11,
    '/settings': 12,
  };

  const currentTab = pathToIndex[location.pathname] ?? 0;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 2 }}>
      <Tabs
        value={currentTab}
        textColor="inherit"
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
        {hasPermission('rooms:read') && <Tab label="Rooms" component={Link} to="/rooms" />}
        <Tab label="My Bookings" component={Link} to="/my-bookings" />
        {hasRole('admin') && <Tab label="Guests" component={Link} to="/guests" />}
        {hasRole('admin') && <Tab label="Bookings" component={Link} to="/bookings" />}
        {hasPermission('analytics:read') && <Tab label="Analytics" component={Link} to="/analytics" />}
        {hasPermission('analytics:read') && <Tab label="My Reports" component={Link} to="/reports" />}
        {hasPermission('analytics:read') && <Tab label="Loyalty Portal" component={Link} to="/loyalty" />}
        <Tab label="My Rewards" component={Link} to="/my-rewards" />
        {hasRole('admin') && <Tab label="Rewards Admin" component={Link} to="/rewards-admin" />}
        <Tab label="Profile" component={Link} to="/profile" />
        {hasRole('admin') && <Tab label="Roles" component={Link} to="/rbac" />}
        {hasRole('admin') && <Tab label="API Test" component={Link} to="/api-test" />}
        {hasPermission('settings:read') && <Tab label="Settings" component={Link} to="/settings" />}
      </Tabs>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, ml: 2 }}>
        <Box sx={{
          display: { xs: 'none', sm: 'flex' },
          alignItems: 'center',
          gap: 1,
          px: 2,
          py: 0.5,
          borderRadius: 2,
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
        }}>
          <Typography variant="body2" sx={{ color: 'white', fontWeight: 500 }}>
            {user?.full_name || user?.username}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<LogoutIcon />}
          onClick={logout}
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
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route
            path="/login"
            element={
              <AnimatedRoute animationType="fade">
                <LoginPage />
              </AnimatedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <Box sx={{ flexGrow: 1, minHeight: '100vh', backgroundColor: 'background.default' }}>
      <AppBar position="sticky" elevation={0}>
        <Toolbar sx={{ py: 1 }}>
          <HotelIcon sx={{ mr: 2, fontSize: 32, color: 'white' }} />
          <Typography variant="h6" component="div" sx={{ flexGrow: 1, fontWeight: 700, color: 'white' }}>
            Hotel Management System
          </Typography>
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
        <Suspense fallback={<LoadingFallback />}>
          <Routes>
          <Route 
            path="/" 
            element={
              <ProtectedRoute>
                <AnimatedRoute animationType="fade">
                  <Dashboard />
                </AnimatedRoute>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/rooms" 
            element={
              <ProtectedRoute requiredPermission="rooms:read">
                <AnimatedRoute animationType="slide">
                  <RoomsPage />
                </AnimatedRoute>
              </ProtectedRoute>
            } 
          />
          <Route
            path="/guests"
            element={
              <ProtectedRoute requiredRole="admin">
                <AnimatedRoute animationType="slide">
                  <GuestsPage />
                </AnimatedRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/bookings"
            element={
              <ProtectedRoute requiredRole="admin">
                <AnimatedRoute animationType="slide">
                  <BookingsPage />
                </AnimatedRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/my-bookings"
            element={
              <AnimatedRoute animationType="slide">
                <MyBookingsPage />
              </AnimatedRoute>
            }
          />
          <Route
            path="/analytics" 
            element={
              <ProtectedRoute requiredPermission="analytics:read">
                <AnimatedRoute animationType="grow">
                  <AnalyticsDashboard />
                </AnimatedRoute>
              </ProtectedRoute>
            } 
          />
          <Route
            path="/reports"
            element={
              <ProtectedRoute requiredPermission="analytics:read">
                <AnimatedRoute animationType="grow">
                  <ReportsPage />
                </AnimatedRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/loyalty"
            element={
              <ProtectedRoute requiredPermission="analytics:read">
                <AnimatedRoute animationType="grow">
                  <LoyaltyPortal />
                </AnimatedRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/my-rewards"
            element={
              <ProtectedRoute>
                <AnimatedRoute animationType="grow">
                  <LoyaltyDashboard />
                </AnimatedRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/rewards-admin"
            element={
              <ProtectedRoute requiredRole="admin">
                <AnimatedRoute animationType="grow">
                  <RewardsManagementPage />
                </AnimatedRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <AnimatedRoute animationType="fade">
                  <UserProfilePage />
                </AnimatedRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/rbac"
            element={
              <ProtectedRoute requiredRole="admin">
                <AnimatedRoute animationType="fade">
                  <RBACManagementPage />
                </AnimatedRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/api-test"
            element={
              <ProtectedRoute requiredRole="admin">
                <AnimatedRoute animationType="fade">
                  <APITestPage />
                </AnimatedRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings" 
            element={
              <ProtectedRoute requiredPermission="settings:read">
                <AnimatedRoute animationType="fade">
                  <SettingsPage />
                </AnimatedRoute>
              </ProtectedRoute>
            } 
          />
          <Route path="/login" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
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
