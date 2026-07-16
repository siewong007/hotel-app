import React, { useEffect } from 'react';
import { useNavigate } from '../../../router';
import { useAuth } from '../../../auth/AuthContext';
import ReportsAnalytics from './reports/ReportsAnalytics';
import UserProfilePage from '../../user/components/UserProfilePage';

const DashboardRouter: React.FC = () => {
  const { hasRole } = useAuth();
  const navigate = useNavigate();

  // Define role groups based on user instructions
  const isAdminOrSuper = hasRole('admin') || hasRole('super_admin');
  const isExec = hasRole('manager');
  const isEmployee = hasRole('receptionist') || hasRole('employee');

  useEffect(() => {
    // A pre-existing guest account session does not include the separate
    // short-lived portal token, so keep this fallback on My Bookings. The
    // Guest login flow creates that token before opening the portal.
    if (!isAdminOrSuper && !isExec && !isEmployee) {
      navigate('/my-bookings', { replace: true });
    }
  }, [isAdminOrSuper, isExec, isEmployee, navigate]);

  // Employee (Receptionist) sees their profile page by default
  if (isEmployee && !isAdminOrSuper && !isExec) {
    return <UserProfilePage />;
  }

  // Admin, Super User, and Exec User (Manager) see the analytics dashboard
  if (isAdminOrSuper || isExec) {
    return <ReportsAnalytics />;
  }

  // Fallback (e.g., during redirection)
  return null;
};

export default DashboardRouter;
