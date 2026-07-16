export type IndexExperience = 'salim-inn-model' | 'staff-dashboard';

/**
 * The public model is the home experience for signed-out visitors and guests.
 * Only authenticated staff accounts enter the operational dashboard at `/`.
 */
export function resolveIndexExperience(
  isAuthenticated: boolean,
  userType: 'admin' | 'guest' | undefined,
): IndexExperience {
  return isAuthenticated && userType !== 'guest'
    ? 'staff-dashboard'
    : 'salim-inn-model';
}
