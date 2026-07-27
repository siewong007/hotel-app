export type AccountUserType = 'admin' | 'guest';

export interface AuthUserShape {
  id: string | number;
  username: string;
  email: string;
  full_name?: string;
  user_type: AccountUserType;
  guest_id?: number;
  is_active: boolean;
  // Whether the account has satisfied all required profile fields. Defaults
  // to `true` when the backend omits it (see normalizeAuthUser) so that
  // admin accounts and any older response shape are never mistaken for an
  // incomplete guest and pushed into a profile-completion flow they have no
  // business seeing.
  profile_complete: boolean;
  missing_profile_fields: Array<'first_name' | 'last_name' | 'phone'>;
}

type UserLike = Partial<Omit<AuthUserShape, 'user_type' | 'missing_profile_fields'>> & {
  user_type?: string | null;
  // Widened from the AuthUserShape literal union: the wire payload (backend
  // JSON) carries plain strings, not the narrowed field-name literals.
  missing_profile_fields?: string[];
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
    // Default to COMPLETE when the backend omits these fields: admin accounts
    // and any older response shape must never be treated as an incomplete
    // guest and routed into a profile-completion flow.
    profile_complete: user.profile_complete ?? true,
    missing_profile_fields: (user.missing_profile_fields ?? []) as Array<
      'first_name' | 'last_name' | 'phone'
    >,
  };
}
