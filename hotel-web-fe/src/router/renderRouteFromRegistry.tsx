import React from 'react';
import {
  authRouteDefinitions,
  unauthRouteDefinitions,
  type AppRouteDefinition,
} from '../navigation/routeRegistry';
import { ProtectedRoute } from '../features/auth';
import { AnimatedRoute, ComponentErrorBoundary } from '../components';
import { UnauthOnlyRoute } from './RouteGuards';

const byId: Map<string, AppRouteDefinition> = new Map();
[...authRouteDefinitions, ...unauthRouteDefinitions].forEach((r) => {
  if (!byId.has(r.id)) byId.set(r.id, r);
});

export function renderRouteContent(route: AppRouteDefinition) {
  const PageComponent = route.component;
  const content = (
    <AnimatedRoute animationType={route.animationType}>
      <ComponentErrorBoundary>
        <PageComponent />
      </ComponentErrorBoundary>
    </AnimatedRoute>
  );

  if (route.visibility === 'unauth') {
    return <UnauthOnlyRoute>{content}</UnauthOnlyRoute>;
  }

  if (route.accessControlled) {
    return (
      <ProtectedRoute
        routeId={route.id}
        requiresPolicy
      >
        {content}
      </ProtectedRoute>
    );
  }

  return <ProtectedRoute routeId={route.id}>{content}</ProtectedRoute>;
}

/** Render a route entry by its `id` from `routeRegistry`. */
export function RouteById({ id }: { id: string }) {
  const def = byId.get(id);
  if (!def) {
    if (import.meta.env.DEV) {
      console.warn(`[router] RouteById: no route definition for "${id}"`);
    }
    return null;
  }
  return renderRouteContent(def);
}
