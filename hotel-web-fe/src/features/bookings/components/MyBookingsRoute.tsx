import { useAuth } from '../../../auth/AuthContext';
import { Navigate } from '../../../router';
import { RouteById } from '../../../router/renderRouteFromRegistry';

export function MyBookingsRoute() {
  const { user } = useAuth();
  if (user?.user_type === 'guest') {
    return <Navigate to="/guest-portal" replace />;
  }

  return <RouteById id="my-bookings" />;
}
