import React from 'react';
import { Navigate } from '@tanstack/react-router';
import { useAuth } from '../auth/AuthContext';
import { LoadingFallback } from './RouteFallbacks';

export const UnauthOnlyRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) {
    return <LoadingFallback />;
  }
  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
};
