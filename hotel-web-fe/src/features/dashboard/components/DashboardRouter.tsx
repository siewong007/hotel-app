import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthContext';
import AnalyticsDashboard from './AnalyticsDashboard';
import UserProfilePage from '../../user/components/UserProfilePage';

const DashboardRouter: React.FC = () => {
  const { hasRole } = useAuth();
  const navigate = useNavigate();

  // Define role groups based on user instructions
  const isAdminOrSuper = hasRole('admin') || hasRole('superadmin');
  const isExec = hasRole('manager');
  const isEmployee = hasRole('receptionist') || hasRole('employee');

  useEffect(() => {
    // Redirect guests (who have none of the expected roles) to their bookings page
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
    return <AnalyticsDashboard />;
  }

  // Fallback (e.g., during redirection)
  return null;
};

export default DashboardRouter;
