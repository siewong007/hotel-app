// Permission category configuration with display metadata. Labels live in the
// admin bundle (`rbac.categories.<key>`); resolve them via
// `getCategoryDisplayName` so the UI follows the active locale.
export const PERMISSION_CATEGORIES: Record<string, { icon: string; color: string }> = {
  rooms: { icon: 'Hotel', color: 'var(--hotel-info)' },
  bookings: { icon: 'EventNote', color: 'var(--hotel-success)' },
  guests: { icon: 'People', color: 'var(--hotel-warning)' },
  users: { icon: 'PersonAdd', color: 'var(--hotel-chart-4)' },
  roles: { icon: 'Security', color: 'var(--hotel-danger)' },
  permissions: { icon: 'VpnKey', color: 'var(--hotel-chart-4)' },
  navigation: { icon: 'Navigation', color: 'var(--hotel-chart-4)' },
  settings: { icon: 'Settings', color: 'var(--hotel-neutral)' },
  ekyc: { icon: 'VerifiedUser', color: 'var(--hotel-info)' },
  rbac: { icon: 'Security', color: 'var(--hotel-danger)' },
  loyalty: { icon: 'CardGiftcard', color: 'var(--hotel-primary)' },
  rewards: { icon: 'Star', color: 'var(--hotel-warning)' },
  ledgers: { icon: 'AccountBalance', color: 'var(--hotel-neutral)' },
  analytics: { icon: 'Assessment', color: 'var(--hotel-info)' },
};

/**
 * Localized label for a permission category. Unknown categories (custom
 * resources) fall back to the humanized raw key, matching the pre-i18n
 * behaviour.
 */
export const getCategoryDisplayName = (
  t: (key: string) => string,
  category: string,
): string =>
  PERMISSION_CATEGORIES[category]
    ? t(`rbac.categories.${category}`)
    : category.charAt(0).toUpperCase() + category.slice(1);

/**
 * Localized verb label for a permission action (`read` → "Read"). The
 * translation engine renders the last key segment on a miss, so an unmapped
 * action still shows its raw code rather than a broken key.
 */
export const verbLabel = (t: (key: string) => string, action: string): string =>
  t(`rbac.verb.${action}`);

// Role colors for visual distinction
export const ROLE_COLORS: Record<string, string> = {
  super_admin: 'var(--hotel-chart-4)',
  admin: 'var(--hotel-danger)',
  manager: 'var(--hotel-info)',
  receptionist: 'var(--hotel-success)',
  guest: 'var(--hotel-neutral)',
  default: 'var(--hotel-neutral)',
};

// Get category color with fallback
export const getCategoryColor = (category: string): string => {
  return PERMISSION_CATEGORIES[category]?.color || 'var(--hotel-neutral)';
};

// Get role color with fallback
export const getRoleColor = (roleName: string): string => {
  return ROLE_COLORS[roleName.toLowerCase()] || ROLE_COLORS.default;
};
