import { createFileRoute } from '@tanstack/react-router';
import { StatusPage } from '../components';

function NotFoundComponent() {
  return <StatusPage statusCode={404} />;
}

export const Route = createFileRoute('/$')({
  component: NotFoundComponent,
});
