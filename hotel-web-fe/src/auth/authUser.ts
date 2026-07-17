export type AccountUserType = 'admin' | 'guest';

export interface AuthUserShape {
  id: string | number;
  username: string;
  email: string;
  full_name?: string;
  user_type: AccountUserType;
  guest_id?: number;
  is_active: boolean;
}

type UserLike = Partial<Omit<AuthUserShape, 'user_type'>> & {
  user_type?: string | null;
};

export function normalizeUserType(
  userType: string | null | undefined,
  roles: string[] = [],
): AccountUserType {
  if (userType?.toLowerCase() === 'guest') return 'guest';
  return roles.some((role) => role.trim().toLowerCase() === 'guest') ? 'guest' : 'admin';
}

export function normalizeAuthUser(user: UserLike, roles: string[] = []): AuthUserShape {
  return {
    id: user.id ?? '',
    username: user.username ?? '',
    email: user.email ?? '',
    full_name: user.full_name,
    user_type: normalizeUserType(user.user_type, roles),
    guest_id: user.guest_id,
    is_active: user.is_active ?? true,
  };
}
