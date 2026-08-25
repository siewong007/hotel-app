import React from 'react';
import { Navigate } from '@tanstack/react-router';
import { useAuth } from '../auth/AuthContext';
import { LoadingFallback } from './RouteFallbacks';

export const UnauthOnlyRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading, user } = useAuth();
  if (isLoading) {
    return <LoadingFallback />;
  }
  if (isAuthenticated) {
    const destination = user?.user_type === 'guest' ? '/guest-portal' : '/admin-portal';
    // Same typed-route shim contract as router/compat.tsx: dynamic role-based
    // paths are not expressible in TanStack's route literals.
    return <Navigate to={destination as any} replace />;
  }
  return <>{children}</>;
};
