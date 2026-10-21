import React from 'react';
import { Navigate, useLocation } from '../../../router';
import { useAuth } from '../../../auth/AuthContext';
import { LogoLoader } from '../../../components';
import { policyAdmits } from '../../../navigation/routeAccess';

interface ProtectedRouteProps {
  children: React.ReactNode;
  routeId?: string;
  requiresPolicy?: boolean;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  routeId,
  requiresPolicy = false,
}) => {
  const { isAuthenticated, isLoading, hasPermission, hasRole, getRoutePolicy } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <LogoLoader variant="page" minHeight="100vh" />;
  }

  if (!isAuthenticated) {
    // Carry the attempted URL so sign-in can restore it — a bounced session
    // should return the user to the screen they asked for, not the dashboard.
    const attempted = `${location.pathname}${location.search || ''}`;
    const target =
      attempted && attempted !== '/'
        ? `/login?redirect=${encodeURIComponent(attempted)}`
        : '/login';
    return <Navigate to={target} replace />;
  }

  const policy = routeId ? getRoutePolicy(routeId) : undefined;
  if (requiresPolicy && !policy) {
    if (routeId === 'online-inventory' && (hasPermission('rooms:update') || hasPermission('rooms:manage'))) {
      return <>{children}</>;
    }
    return <Navigate to="/403" replace />;
  }

  if (policy && !policyAdmits(policy, { hasPermission, hasRole })) {
    return <Navigate to="/403" replace />;
  }

  return <>{children}</>;
};
