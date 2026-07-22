import { createFileRoute } from '@tanstack/react-router';
import { StatusPage } from '../components';

export const Route = createFileRoute('/403')({
  component: () => <StatusPage statusCode={403} />,
});
