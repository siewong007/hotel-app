import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthContext';
import AnalyticsDashboard from './AnalyticsDashboard';

const DashboardRouter: React.FC = () => {
  const { hasRole } = useAuth();
  const navigate = useNavigate();

  // Check role hierarchy
  const isAdmin = hasRole('admin');
  const isReceptionist = hasRole('receptionist') || hasRole('manager');

  useEffect(() => {
    // Redirect guests to their bookings page
    if (!isAdmin && !isReceptionist) {
      navigate('/my-bookings', { replace: true });
    }
  }, [isAdmin, isReceptionist, navigate]);

  // Admin and receptionist see the analytics dashboard
  if (isAdmin || isReceptionist) {
    return <AnalyticsDashboard />;
  }

  // Guests will be redirected, return null as fallback
  return null;
};

export default DashboardRouter;
