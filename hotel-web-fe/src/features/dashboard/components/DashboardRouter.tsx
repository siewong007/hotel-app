import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthContext';
import AdminOverviewDashboard from './AdminOverviewDashboard';

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

    // Redirect admin to room management tab
    if (isAdmin) {
      navigate('/room-config', { replace: true });
    }
  }, [isAdmin, isReceptionist, navigate]);

  // Receptionist sees admin overview dashboard
  if (isReceptionist) {
    return <AdminOverviewDashboard />;
  }

  // Admin will be redirected to room-config by useEffect, but return null as fallback
  return null;
};

export default DashboardRouter;
