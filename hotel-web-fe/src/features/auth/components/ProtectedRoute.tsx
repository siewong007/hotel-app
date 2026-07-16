import React from 'react';
import { Navigate } from '@tanstack/react-router';
import { useAuth } from '../../../auth/AuthContext';
import { CircularProgress, Box } from '@mui/material';

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

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <CircularProgress />
      </Box>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const policy = routeId ? getRoutePolicy(routeId) : undefined;
  if (requiresPolicy && !policy) {
    if (routeId === 'online-inventory' && (hasPermission('rooms:update') || hasPermission('rooms:manage'))) {
      return <>{children}</>;
    }
    return <Navigate to="/" replace />;
  }

  const requiredPermissions = policy?.required_permissions ?? [];
  const requiredRoles = policy?.required_roles ?? [];
  const excludeRoles = policy?.excluded_roles ?? [];

  if (requiredPermissions.length > 0) {
    const hasAnyPermission = requiredPermissions.some(permission => hasPermission(permission));
    const hasAnyRole = requiredRoles.some(role => hasRole(role));
    if (!hasAnyPermission && !hasAnyRole) {
      return <Navigate to="/" replace />;
    }
  }

  if (requiredPermissions.length === 0 && requiredRoles.length > 0) {
    const hasAnyRole = requiredRoles.some(role => hasRole(role));
    if (!hasAnyRole) {
      return <Navigate to="/" replace />;
    }
  }

  if (excludeRoles.some((role) => hasRole(role))) {
    return <Navigate to="/timeline" replace />;
  }

  return <>{children}</>;
};
