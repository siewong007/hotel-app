import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './features/auth';
import { AnimatedRoute, ErrorBoundary, PageErrorBoundary, ComponentErrorBoundary, HotelSpinner } from './components';
import { Box } from '@mui/material';
import {
  authRouteDefinitions,
  FirstLoginPasskeyPrompt,
  type AppRouteDefinition,
  unauthRouteDefinitions,
} from './navigation/routeRegistry';

const LoadingFallback = () => (
  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 'calc(100vh - 200px)', opacity: 0.8 }}>
    <HotelSpinner size={80} />
  </Box>
);

const MinimalLoadingFallback = () => (
  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100px' }}>
    <HotelSpinner size={40} />
  </Box>
);

export { MinimalLoadingFallback, LoadingFallback };
export { FirstLoginPasskeyPrompt };

function renderRouteElement(route: AppRouteDefinition) {
  const PageComponent = route.component;
  const content = (
    <AnimatedRoute animationType={route.animationType}>
      <ComponentErrorBoundary>
        <PageComponent />
      </ComponentErrorBoundary>
    </AnimatedRoute>
  );

  if (route.requiredPermission || route.requiredRoles || route.excludeRoles?.length) {
    return (
      <ProtectedRoute
        requiredPermission={route.requiredPermission}
        requiredRoles={route.requiredRoles}
        excludeRoles={route.excludeRoles}
      >
        {content}
      </ProtectedRoute>
    );
  }

  return content;
}

export function UnauthRoutes() {
  return (
    <ErrorBoundary title="Authentication Error">
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          {unauthRouteDefinitions.map((route) => (
            <Route key={route.id} path={route.path} element={renderRouteElement(route)} />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

export function AuthRoutes() {
  return (
    <PageErrorBoundary>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          {authRouteDefinitions.map((route) => (
            <Route key={route.id} path={route.path} element={renderRouteElement(route)} />
          ))}
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </PageErrorBoundary>
  );
}
