import { createFileRoute } from '@tanstack/react-router';
import { StatusPage } from '../components';

export const Route = createFileRoute('/423')({
  component: () => <StatusPage statusCode={423} />,
});
