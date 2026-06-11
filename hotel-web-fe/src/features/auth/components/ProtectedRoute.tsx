import React from 'react';
import { Navigate } from '@tanstack/react-router';
import { useAuth } from '../../../auth/AuthContext';
import { CircularProgress, Box } from '@mui/material';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredPermissions?: string[];
  requiredRoles?: string[]; // Array of roles - user needs ANY of these
  excludeRoles?: string[];
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  requiredPermissions,
  requiredRoles,
  excludeRoles,
}) => {
  const { isAuthenticated, isLoading, hasPermission, hasRole } = useAuth();

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

  if (requiredPermissions && requiredPermissions.length > 0) {
    const hasAnyPermission = requiredPermissions.some(permission => hasPermission(permission));
    if (!hasAnyPermission) {
      return <Navigate to="/" replace />;
    }
  }

  if (requiredRoles && requiredRoles.length > 0) {
    const hasAnyRole = requiredRoles.some(role => hasRole(role));
    if (!hasAnyRole) {
      return <Navigate to="/" replace />;
    }
  }

  if (excludeRoles?.some((role) => hasRole(role))) {
    return <Navigate to="/timeline" replace />;
  }

  return <>{children}</>;
};
