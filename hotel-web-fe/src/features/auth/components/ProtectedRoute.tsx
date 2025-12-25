import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthContext';
import { CircularProgress, Box } from '@mui/material';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredPermission?: string;
  requiredRole?: string;
  requiredRoles?: string[]; // Array of roles - user needs ANY of these
  excludeRole?: string;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  requiredPermission,
  requiredRole,
  requiredRoles,
  excludeRole,
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
    return <Navigate to="/login" replace />;
  }

  if (requiredPermission && !hasPermission(requiredPermission)) {
    return <Navigate to="/" replace />;
  }

  // Helper function for case-insensitive role checking
  const hasRoleCaseInsensitive = (role: string): boolean => {
    return hasRole(role) ||
           hasRole(role.toLowerCase()) ||
           hasRole(role.charAt(0).toUpperCase() + role.slice(1).toLowerCase());
  };

  if (requiredRole && !hasRoleCaseInsensitive(requiredRole)) {
    return <Navigate to="/" replace />;
  }

  // Check if user has ANY of the required roles (case-insensitive)
  if (requiredRoles && requiredRoles.length > 0) {
    const hasAnyRole = requiredRoles.some(role => hasRoleCaseInsensitive(role));
    if (!hasAnyRole) {
      return <Navigate to="/" replace />;
    }
  }

  // Exclude specific roles from accessing this route (case-insensitive)
  if (excludeRole && hasRoleCaseInsensitive(excludeRole)) {
    return <Navigate to="/timeline" replace />;
  }

  return <>{children}</>;
};

