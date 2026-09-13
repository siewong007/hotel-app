import type { ElementType } from 'react';
import type { Theme } from '@mui/material/styles';
import { alpha } from '@mui/material/styles';
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined';
import BuildOutlinedIcon from '@mui/icons-material/BuildOutlined';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import EventNoteOutlinedIcon from '@mui/icons-material/EventNoteOutlined';
import HomeWorkOutlinedIcon from '@mui/icons-material/HomeWorkOutlined';
import HowToRegOutlinedIcon from '@mui/icons-material/HowToRegOutlined';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import NightsStayOutlinedIcon from '@mui/icons-material/NightsStayOutlined';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import PeopleOutlinedIcon from '@mui/icons-material/PeopleOutlined';
import PersonAddOutlinedIcon from '@mui/icons-material/PersonAddOutlined';
import RocketLaunchOutlinedIcon from '@mui/icons-material/RocketLaunchOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import SecurityOutlinedIcon from '@mui/icons-material/SecurityOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import type { HelpCategoryId } from './types';

export interface HelpCategoryDef {
  id: HelpCategoryId;
  icon: ElementType;
  /** Main admin surface covered — used for the "Open module" affordance. */
  routePath?: string;
}

/** Display order on the hub. Labels/descriptions live in i18n `help.json`
 * under `categories.<id>.{name,desc}` so they translate like other chrome. */
export const HELP_CATEGORIES: HelpCategoryDef[] = [
  { id: 'getting-started', icon: RocketLaunchOutlinedIcon },
  { id: 'bookings', icon: EventNoteOutlinedIcon, routePath: '/bookings' },
  { id: 'guests', icon: PeopleOutlinedIcon, routePath: '/guest-config' },
  { id: 'rooms-inventory', icon: HomeWorkOutlinedIcon, routePath: '/room-management' },
  { id: 'payments-ledgers', icon: PaymentsOutlinedIcon, routePath: '/company-ledger' },
  { id: 'rates-promotions', icon: LocalOfferOutlinedIcon, routePath: '/campaigns' },
  { id: 'reports-night-audit', icon: AssessmentOutlinedIcon, routePath: '/reports' },
  { id: 'communications', icon: EmailOutlinedIcon, routePath: '/communications' },
  { id: 'staff-access', icon: SecurityOutlinedIcon, routePath: '/rbac' },
  { id: 'settings-data', icon: SettingsOutlinedIcon, routePath: '/settings' },
  { id: 'troubleshooting', icon: BuildOutlinedIcon },
];

export const HELP_CATEGORY_IDS = HELP_CATEGORIES.map((c) => c.id);

/** Curated hub sections. Slugs are also the i18n keys under
 * `quickTasks.<slug>` / `troubleshootingLinks.<slug>` — rename an article slug
 * and the matching key in help.json must move with it. */
export const HELP_QUICK_TASKS: { slug: string; icon: ElementType }[] = [
  { slug: 'create-a-booking', icon: EventNoteOutlinedIcon },
  { slug: 'check-in-a-guest', icon: HowToRegOutlinedIcon },
  { slug: 'find-a-reservation', icon: SearchOutlinedIcon },
  { slug: 'refund-a-deposit', icon: PaymentsOutlinedIcon },
  { slug: 'add-manage-staff', icon: PersonAddOutlinedIcon },
  { slug: 'run-night-audit', icon: NightsStayOutlinedIcon },
];

export const HELP_TROUBLESHOOTING_SLUGS = [
  'cant-find-a-booking',
  'payment-problems',
  'email-not-sending',
  'page-missing-or-access-denied',
  'session-and-stale-data',
] as const;

/** Shared interactive-card treatment: quiet at rest, a 1px lift, a hairline
 * brand border and a single-level shadow on hover/focus-within. One definition
 * so every clickable surface in the Help Centre moves the same way; the global
 * prefers-reduced-motion reset still applies. */
export const helpInteractiveCardSx = (theme: Theme) => ({
  transition: theme.transitions.create(['transform', 'border-color', 'box-shadow'], {
    duration: theme.transitions.duration.shortest,
  }),
  '&:hover, &:focus-within': {
    transform: 'translateY(-1px)',
    borderColor: alpha(theme.palette.primary.main, 0.45),
    boxShadow: theme.shadows[1],
  },
});

/** Icon well used by category cards — hairline border over a whisper of brand
 * tint rather than a filled square. */
export const helpIconWellSx = (theme: Theme) => ({
  width: 40,
  height: 40,
  borderRadius: 1.5,
  display: 'grid',
  placeItems: 'center',
  bgcolor: alpha(theme.palette.primary.main, 0.07),
  border: '1px solid',
  borderColor: alpha(theme.palette.primary.main, 0.14),
  color: 'primary.main',
  flexShrink: 0,
});

/** localStorage keys (storage util namespaces them under the app prefix). */
export const HELP_RECENT_SEARCHES_KEY = 'helpRecentSearches';
export const HELP_FEEDBACK_KEY = 'helpArticleFeedback';

export const HELP_SEARCH_DEBOUNCE_MS = 180;
export const HELP_SEARCH_MIN_CHARS = 2;
export const HELP_SEARCH_MAX_RESULTS = 8;
export const HELP_MAX_RECENT_SEARCHES = 6;
export const HELP_RELATED_COUNT = 3;
export const HELP_WORDS_PER_MINUTE = 200;
