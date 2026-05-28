import { createFileRoute, Navigate } from '@tanstack/react-router';

function NotFoundComponent() {
  return <Navigate to="/" replace />;
}

export const Route = createFileRoute('/$')({
  component: NotFoundComponent,
});
