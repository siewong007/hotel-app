import { useAuth } from '../../auth/AuthContext';
import { useDataChangeSocket } from '../../hooks/useDataChangeSocket';

/**
 * Mounts the staff data-change socket while a user is signed in. Rendered once
 * inside the app providers; renders nothing itself.
 */
export function RealtimeInvalidator() {
  const { isAuthenticated } = useAuth();
  useDataChangeSocket(isAuthenticated);
  return null;
}
