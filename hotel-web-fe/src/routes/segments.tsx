import { createFileRoute } from '@tanstack/react-router';

import SegmentsPage from '../features/segments/pages/SegmentsPage';

export const Route = createFileRoute('/segments')({
  component: SegmentsPage,
});
