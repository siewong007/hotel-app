import { createFileRoute } from '@tanstack/react-router';
import { MyBookingsRoute } from '../features/bookings/components/MyBookingsRoute';

export const Route = createFileRoute('/my-bookings')({
  component: MyBookingsRoute,
});
