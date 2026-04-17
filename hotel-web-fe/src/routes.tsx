import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './features/auth';
import { AnimatedRoute, ErrorBoundary, PageErrorBoundary, ComponentErrorBoundary, HotelSpinner } from './components';
import { Box } from '@mui/material';

// Lazy-loaded page components
const LandingPage = lazy(() => import('./components/layout/LandingPage'));
const DashboardRouter = lazy(() => import('./features/dashboard/components/DashboardRouter'));
const BookingsPage = lazy(() => import('./features/bookings/components/BookingsPage'));
const MyBookingsPage = lazy(() => import('./features/bookings/components/MyBookingsPage'));
const ModernReportsPage = lazy(() => import('./features/reports/components/ModernReportsPage'));
const LoyaltyPortal = lazy(() => import('./features/loyalty/components/LoyaltyPortal'));
const LoyaltyDashboard = lazy(() => import('./features/loyalty/components/LoyaltyDashboard'));
const UserProfilePage = lazy(() => import('./features/user/components/UserProfilePage'));
const SettingsPage = lazy(() => import('./features/user/components/SettingsPage'));
const RBACManagementPage = lazy(() => import('./features/admin/components/rbac/RBACManagementPage'));
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
const DataTransferPage = lazy(() => import('./features/admin/components/DataTransferPage'));

export { FirstLoginPasskeyPrompt };

const LoadingFallback = () => (
  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100vh - 200px)', opacity: 0.8 }}>
    <HotelSpinner size={80} />
  </Box>
);

const MinimalLoadingFallback = () => (
  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100px' }}>
    <HotelSpinner size={40} />
  </Box>
);

export { MinimalLoadingFallback, LoadingFallback };

export function UnauthRoutes() {
  return (
    <ErrorBoundary title="Authentication Error">
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route path="/" element={<AnimatedRoute animationType="fade"><LandingPage /></AnimatedRoute>} />
          <Route path="/login" element={<AnimatedRoute animationType="fade"><LoginPage /></AnimatedRoute>} />
          <Route path="/register" element={<AnimatedRoute animationType="fade"><RegisterPage /></AnimatedRoute>} />
          <Route path="/verify-email" element={<AnimatedRoute animationType="fade"><EmailVerificationPage /></AnimatedRoute>} />
          <Route path="/guest-checkin" element={<AnimatedRoute animationType="fade"><GuestCheckInLanding /></AnimatedRoute>} />
          <Route path="/guest-checkin/verify" element={<AnimatedRoute animationType="fade"><GuestCheckInVerify /></AnimatedRoute>} />
          <Route path="/guest-checkin/form" element={<AnimatedRoute animationType="fade"><GuestCheckInForm /></AnimatedRoute>} />
          <Route path="/guest-checkin/confirm" element={<AnimatedRoute animationType="fade"><GuestCheckInConfirmation /></AnimatedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

export function AuthRoutes() {
  return (
    <PageErrorBoundary>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route path="/" element={<ProtectedRoute><AnimatedRoute animationType="fade"><ComponentErrorBoundary><DashboardRouter /></ComponentErrorBoundary></AnimatedRoute></ProtectedRoute>} />
          <Route path="/timeline" element={<ProtectedRoute requiredPermission="rooms:read"><AnimatedRoute animationType="slide"><ComponentErrorBoundary><RoomReservationTimeline /></ComponentErrorBoundary></AnimatedRoute></ProtectedRoute>} />
          <Route path="/guest-config" element={<ProtectedRoute><AnimatedRoute animationType="slide"><ComponentErrorBoundary><GuestConfigurationPage /></ComponentErrorBoundary></AnimatedRoute></ProtectedRoute>} />
          <Route path="/bookings" element={<ProtectedRoute requiredRoles={['admin', 'receptionist', 'manager']}><AnimatedRoute animationType="slide"><ComponentErrorBoundary><BookingsPage /></ComponentErrorBoundary></AnimatedRoute></ProtectedRoute>} />
          <Route path="/my-bookings" element={<AnimatedRoute animationType="slide"><ComponentErrorBoundary><MyBookingsPage /></ComponentErrorBoundary></AnimatedRoute>} />
          <Route path="/room-management" element={<ProtectedRoute requiredRoles={['admin', 'receptionist', 'manager']}><AnimatedRoute animationType="slide"><ComponentErrorBoundary><RoomManagementPage /></ComponentErrorBoundary></AnimatedRoute></ProtectedRoute>} />
          <Route path="/reports" element={<ProtectedRoute><AnimatedRoute animationType="grow"><ComponentErrorBoundary><ModernReportsPage /></ComponentErrorBoundary></AnimatedRoute></ProtectedRoute>} />
          <Route path="/loyalty" element={<ProtectedRoute requiredPermission="analytics:read"><AnimatedRoute animationType="grow"><ComponentErrorBoundary><LoyaltyPortal /></ComponentErrorBoundary></AnimatedRoute></ProtectedRoute>} />
          <Route path="/my-rewards" element={<ProtectedRoute><AnimatedRoute animationType="grow"><ComponentErrorBoundary><LoyaltyDashboard /></ComponentErrorBoundary></AnimatedRoute></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><AnimatedRoute animationType="fade"><ComponentErrorBoundary><UserProfilePage /></ComponentErrorBoundary></AnimatedRoute></ProtectedRoute>} />
          <Route path="/ekyc" element={<ProtectedRoute><AnimatedRoute animationType="slide"><ComponentErrorBoundary><EkycRegistrationPage /></ComponentErrorBoundary></AnimatedRoute></ProtectedRoute>} />
          <Route path="/rbac" element={<ProtectedRoute requiredRoles={['admin', 'superadmin']}><AnimatedRoute animationType="fade"><ComponentErrorBoundary><RBACManagementPage /></ComponentErrorBoundary></AnimatedRoute></ProtectedRoute>} />
          <Route path="/ekyc-admin" element={<ProtectedRoute requiredPermission="ekyc:manage"><AnimatedRoute animationType="slide"><ComponentErrorBoundary><EkycManagementPage /></ComponentErrorBoundary></AnimatedRoute></ProtectedRoute>} />
          <Route path="/room-config" element={<ProtectedRoute requiredRoles={['admin', 'receptionist', 'manager']}><AnimatedRoute animationType="fade"><ComponentErrorBoundary><RoomConfigurationPage /></ComponentErrorBoundary></AnimatedRoute></ProtectedRoute>} />
          <Route path="/room-type-config" element={<ProtectedRoute requiredRoles={['admin', 'manager']}><AnimatedRoute animationType="fade"><ComponentErrorBoundary><RoomTypeConfigurationPage /></ComponentErrorBoundary></AnimatedRoute></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute requiredPermission="settings:read"><AnimatedRoute animationType="fade"><ComponentErrorBoundary><SettingsPage /></ComponentErrorBoundary></AnimatedRoute></ProtectedRoute>} />
          <Route path="/company-ledger" element={<ProtectedRoute requiredRoles={['admin', 'receptionist', 'manager']}><AnimatedRoute animationType="slide"><ComponentErrorBoundary><CustomerLedgerPage /></ComponentErrorBoundary></AnimatedRoute></ProtectedRoute>} />
          <Route path="/complimentary" element={<ProtectedRoute requiredRoles={['admin', 'manager', 'receptionist']}><AnimatedRoute animationType="slide"><ComponentErrorBoundary><ComplimentaryManagementPage /></ComponentErrorBoundary></AnimatedRoute></ProtectedRoute>} />
          <Route path="/audit-log" element={<ProtectedRoute requiredPermission="audit:read"><AnimatedRoute animationType="fade"><ComponentErrorBoundary><AuditLogPage /></ComponentErrorBoundary></AnimatedRoute></ProtectedRoute>} />
          <Route path="/night-audit" element={<ProtectedRoute requiredRoles={['admin', 'manager', 'receptionist']}><AnimatedRoute animationType="fade"><ComponentErrorBoundary><NightAuditPage /></ComponentErrorBoundary></AnimatedRoute></ProtectedRoute>} />
          <Route path="/data-transfer" element={<ProtectedRoute requiredRoles={['admin']}><AnimatedRoute animationType="fade"><ComponentErrorBoundary><DataTransferPage /></ComponentErrorBoundary></AnimatedRoute></ProtectedRoute>} />
          <Route path="/login" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </PageErrorBoundary>
  );
}
