import React from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { Container, AppBar, Toolbar, Typography, Tabs, Tab, Box, Button } from '@mui/material';
import HotelIcon from '@mui/icons-material/Hotel';
import LogoutIcon from '@mui/icons-material/Logout';
import { BrowserRouter as Router, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';

// Import components
import Dashboard from './components/Dashboard';
import RoomsPage from './components/RoomsPage';
import GuestsPage from './components/GuestsPage';
import BookingsPage from './components/BookingsPage';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import PersonalizedReportsPage from './components/PersonalizedReportsPage';
import SettingsPage from './components/SettingsPage';
import RBACManagementPage from './components/RBACManagementPage';
import LoginPage from './components/LoginPage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AnimatedRoute } from './components/AnimatedRoute';

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
    '0px 16px 32px rgba(0,0,0,0.14)',
    '0px 20px 40px rgba(0,0,0,0.16)',
    '0px 24px 48px rgba(0,0,0,0.18)',
    '0px 28px 56px rgba(0,0,0,0.2)',
    '0px 32px 64px rgba(0,0,0,0.22)',
    '0px 36px 72px rgba(0,0,0,0.24)',
    '0px 40px 80px rgba(0,0,0,0.26)',
    '0px 44px 88px rgba(0,0,0,0.28)',
    '0px 48px 96px rgba(0,0,0,0.3)',
    '0px 52px 104px rgba(0,0,0,0.32)',
    '0px 56px 112px rgba(0,0,0,0.34)',
    '0px 60px 120px rgba(0,0,0,0.36)',
    '0px 64px 128px rgba(0,0,0,0.38)',
    '0px 68px 136px rgba(0,0,0,0.4)',
    '0px 72px 144px rgba(0,0,0,0.42)',
    '0px 76px 152px rgba(0,0,0,0.44)',
    '0px 80px 160px rgba(0,0,0,0.46)',
    '0px 84px 168px rgba(0,0,0,0.48)',
    '0px 88px 176px rgba(0,0,0,0.5)',
    '0px 92px 184px rgba(0,0,0,0.52)',
  ],
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

function NavigationTabs() {
  const location = useLocation();
  const { hasPermission, hasRole, logout, user } = useAuth();
  const currentTab = location.pathname === '/rooms' ? 0 :
                    location.pathname === '/guests' ? 1 :
                    location.pathname === '/bookings' ? 2 :
                    location.pathname === '/analytics' ? 3 :
                    location.pathname === '/reports' ? 4 :
                    location.pathname === '/rbac' ? 5 :
                    location.pathname === '/settings' ? 6 : 0;

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
            '&.Mui-selected': {
              color: 'white',
              fontWeight: 600,
            },
          },
          '& .MuiTabs-indicator': {
            backgroundColor: 'white',
            height: 3,
            borderRadius: '3px 3px 0 0',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          },
          '& .MuiTab-root': {
            transition: 'all 0.2s ease-in-out',
            '&:hover': {
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              transform: 'translateY(-1px)',
            },
          },
        }}
      >
        {hasPermission('rooms:read') && <Tab label="Rooms" component={Link} to="/rooms" />}
        {hasPermission('guests:read') && <Tab label="Guests" component={Link} to="/guests" />}
        {hasPermission('bookings:read') && <Tab label="Bookings" component={Link} to="/bookings" />}
        {hasPermission('analytics:read') && <Tab label="Analytics" component={Link} to="/analytics" />}
        {hasPermission('analytics:read') && <Tab label="My Reports" component={Link} to="/reports" />}
        {hasRole('admin') && <Tab label="RBAC" component={Link} to="/rbac" />}
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
}

function AppContent() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return (
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

      <Container maxWidth="xl" sx={{ mt: 4, mb: 4, px: { xs: 2, sm: 3 } }}>
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
              <ProtectedRoute requiredPermission="guests:read">
                <AnimatedRoute animationType="slide">
                  <GuestsPage />
                </AnimatedRoute>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/bookings" 
            element={
              <ProtectedRoute requiredPermission="bookings:read">
                <AnimatedRoute animationType="slide">
                  <BookingsPage />
                </AnimatedRoute>
              </ProtectedRoute>
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
                  <PersonalizedReportsPage />
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
          <AppContent />
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
