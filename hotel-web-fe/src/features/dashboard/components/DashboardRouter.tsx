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
    // The portal establishes its own short-lived session from the authenticated
    // guest account before rendering guest-only features.
    if (!isAdminOrSuper && !isExec && !isEmployee) {
      navigate('/guest-portal', { replace: true });
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
