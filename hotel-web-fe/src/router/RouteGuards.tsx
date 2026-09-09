import React from 'react';
import { Navigate } from '@tanstack/react-router';
import { useAuth } from '../auth/AuthContext';
import { hrefFromAppPath, shouldUseDocumentNavigation } from '../guest/guestDocumentPaths';

export const UnauthOnlyRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading, user } = useAuth();
  // Public guest screens (Gmail pay, login, pre-check-in) must paint before
  // `/api/auth/refresh` returns. Waiting here is what made email links feel stuck.
  if (isLoading) {
    return <>{children}</>;
  }
  if (isAuthenticated) {
    const destination = user?.user_type === 'guest' ? '/guest-portal' : '/admin-portal';
    if (shouldUseDocumentNavigation(destination, window.location.pathname)) {
      window.location.replace(hrefFromAppPath(destination));
      return null;
    }
    // Same typed-route shim contract as router/compat.tsx: dynamic role-based
    // paths are not expressible in TanStack's route literals.
    return <Navigate to={destination as any} replace />;
  }
  return <>{children}</>;
};
