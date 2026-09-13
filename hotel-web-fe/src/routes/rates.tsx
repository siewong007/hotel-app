import { createFileRoute } from '@tanstack/react-router';

import RatesPage from '../features/rates/pages/RatesPage';

export const Route = createFileRoute('/rates')({
  component: RatesPage,
});
