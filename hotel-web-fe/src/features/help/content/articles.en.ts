import type { HelpArticle } from '../types';

/**
 * English Help Centre articles (source of truth — articles.ms.ts mirrors the
 * same slugs and block shapes; content.test.ts enforces parity).
 *
 * Every procedure below was verified against the admin portal: page names
 * match the navigation registry, button labels match the rendered UI, and
 * permission chips match seed.sql. When a screen changes, update the matching
 * article and bump `lastReviewed`.
 */
export const ARTICLES_EN: HelpArticle[] = [
  // ---------------------------------------------------------- getting started
  {
    slug: 'sign-in-and-security',
    title: 'Sign in and secure your account',
    summary: 'Log in, add a passkey or two-factor authentication, and sign out safely on shared workstations.',
    category: 'getting-started',
    keywords: ['login', 'password', 'passkey', '2fa', 'two factor', 'logout', 'shared computer'],
    routePath: '/profile',
    lastReviewed: '2026-09-13',
    relatedSlugs: ['getting-around-admin-portal', 'page-missing-or-access-denied'],
    blocks: [
      { type: 'paragraph', text: 'Staff accounts are created by an administrator. Once you have credentials, sign in from the login page — the portal restores the page you originally tried to open.' },
      {
        type: 'steps',
        steps: [
          { title: 'Open the login page', body: 'Enter your username and password. If your session expired, you are returned here first and then sent back to the page you wanted.' },
          { title: 'Add a passkey when prompted', body: 'On first sign-in you may be asked to register a passkey (fingerprint, face, or device PIN). Passkeys are the fastest and safest way back in — you can dismiss the prompt and set one later from your profile.' },
          { title: 'Enrol in two-factor authentication', body: 'If your role requires it, you will be guided through 2FA enrolment. Keep your authenticator app ready.' },
          { title: 'Sign out at the end of a shift', body: 'Open your account menu (top right) and choose Sign Out. On shared front-desk workstations this is not optional — the next person inherits whatever session is left open.' },
        ],
      },
      { type: 'callout', tone: 'warning', title: 'Shared workstations', body: 'Never leave a signed-in session unattended at the front desk. Signing out clears the access token held in memory.' },
      { type: 'callout', tone: 'tip', body: 'If a page shows Access denied, your role simply does not include it — see “Why can’t I see a page?” before assuming something is broken.' },
    ],
  },
  {
    slug: 'getting-around-admin-portal',
    title: 'Get around the admin portal',
    summary: 'Navigation groups, the command palette, notifications, language and theme — the five controls you will use every shift.',
    category: 'getting-started',
    keywords: ['navigation', 'menu', 'command palette', 'search', 'theme', 'language', 'dark mode', 'bahasa'],
    lastReviewed: '2026-09-13',
    featured: true,
    relatedSlugs: ['sign-in-and-security', 'cant-find-a-booking'],
    blocks: [
      { type: 'paragraph', text: 'The top bar carries everything you need. Row one holds the hotel name, the search bar, the New booking shortcut, language, notifications, and your account menu. Row two holds the module navigation, grouped as Main, Operations, Administration, and Configuration.' },
      {
        type: 'list',
        items: [
          'Main and Operations modules (Timeline, Guests, Bookings, Rooms, Online Inventory, Reports, Housekeeping, Support) appear as one-click pills.',
          'Administration and Configuration collapse into dropdown menus so the bar fits any screen.',
          'On a phone or narrow window, all groups move into the side drawer opened by the menu button.',
        ],
      },
      { type: 'heading', text: 'Find anything with ⌘K' },
      { type: 'paragraph', text: 'Press ⌘K (Ctrl+K on Windows) or click the search bar to open the command palette. It searches bookings, guests, ledger entries, rooms, pages — and help articles. Arrow keys move through results, Enter opens the selection, Esc closes. Type / to run quick actions such as New booking.' },
      { type: 'heading', text: 'Language and theme' },
      { type: 'paragraph', text: 'The globe icon switches between English and Bahasa Melayu instantly — no reload. Light, dark, and night themes are set from Hotel Settings; the choice is remembered per workstation.' },
      { type: 'callout', tone: 'tip', body: 'The palette remembers your six most recent destinations, so repeat journeys take two keystrokes.' },
    ],
  },
  {
    slug: 'page-missing-or-access-denied',
    title: 'Why can’t I see a page?',
    summary: 'Pages appear based on your role and permissions — a missing menu item or an Access denied screen is almost always an access decision, not a fault.',
    category: 'getting-started',
    keywords: ['access denied', '403', 'permission', 'hidden menu', 'role', 'cant see', 'missing page'],
    lastReviewed: '2026-09-13',
    relatedSlugs: ['roles-and-permissions', 'sign-in-and-security'],
    blocks: [
      { type: 'paragraph', text: 'Every module in the admin portal is guarded by route access policies. Your navigation only shows destinations your roles and permissions allow — two staff members can see very different menus on the same screen.' },
      {
        type: 'list',
        items: [
          'A menu item is missing → the route policy excludes your role or you lack its permissions.',
          'You opened a link and see Access denied (403) → you can see the portal but not that module.',
          'Something worked yesterday and not today → your role or the route policy changed. Check the Audit Log or ask an administrator.',
        ],
      },
      {
        type: 'steps',
        steps: [
          { title: 'Confirm the module exists', body: 'Check with a colleague whether they can see the page. If nobody can, it may be a configuration issue rather than access.' },
          { title: 'Ask your administrator', body: 'Access is granted in Access Control → Users (assign a role) or Roles (edit what a role allows). Only administrators can change it.' },
        ],
      },
      { type: 'callout', tone: 'info', body: 'The *:manage permission implies every other action on that resource — for example, bookings:manage covers create, read, update and delete.' },
    ],
  },

  // ------------------------------------------------------------------ bookings
  {
    slug: 'create-a-booking',
    title: 'Create a booking',
    summary: 'Make a reservation from the New booking button — pick dates, rooms, rate and payment in one screen.',
    category: 'bookings',
    keywords: ['reservation', 'new booking', 'walk in', 'phone booking', 'manual booking'],
    routePath: '/bookings',
    requiredPermissions: ['bookings:create'],
    lastReviewed: '2026-09-13',
    featured: true,
    relatedSlugs: ['check-in-a-guest', 'find-a-reservation', 'void-reactivate-release'],
    blocks: [
      { type: 'paragraph', text: 'Walk-in, phone and returning-guest reservations are all created through the same New booking screen. It combines stay dates, room selection, guest details and rate/payment into a single flow.' },
      {
        type: 'steps',
        steps: [
          { title: 'Open New booking', body: 'Use the white New booking button in the top bar, or open Bookings and start there.' },
          { title: 'Choose stay dates and mode', body: 'Select check-in and check-out dates. The booking mode selector adapts the flow for the kind of reservation you are making.' },
          { title: 'Select the room', body: 'Pick a room type, then a specific room. Only rooms free for the whole period are offered.' },
          { title: 'Enter guest details', body: 'Search for an existing guest or enter a new one — name, contact details and nationality fields drive taxes and identity checks.' },
          { title: 'Set rate and payment', body: 'Review the price per night and total, choose the payment and deposit method, then confirm.' },
        ],
      },
      { type: 'callout', tone: 'tip', body: 'Local vs Foreign guest nationality controls whether tourism tax applies — it is selected on the guest section, not at payment time.' },
      { type: 'callout', tone: 'important', title: 'Unpaid online holds', body: 'Bookings left in pending_payment are holds. They auto-release after the window set in Hotel Settings (unpaid hold release hours) and can be released manually sooner.' },
    ],
  },
  {
    slug: 'find-a-reservation',
    title: 'Find a reservation',
    summary: 'Locate any booking by code, guest name, or room — from the Bookings list or the ⌘K palette.',
    category: 'bookings',
    keywords: ['search booking', 'reservation', 'lost booking', 'booking code', 'bk-', 'lookup'],
    routePath: '/bookings',
    requiredPermissions: ['bookings:read'],
    lastReviewed: '2026-09-13',
    featured: true,
    relatedSlugs: ['cant-find-a-booking', 'check-in-a-guest', 'create-a-booking'],
    blocks: [
      { type: 'paragraph', text: 'There are two fast paths depending on what you know: the Bookings list when you want to browse and filter, or the ⌘K palette when you know the booking code or guest.' },
      {
        type: 'steps',
        steps: [
          { title: 'Open the ⌘K palette', body: 'Press ⌘K or click the search bar. Choose the Bookings scope chip to restrict results.' },
          { title: 'Search by code or guest', body: 'Type a booking code (for example BK-…) or a guest name. Selecting a result opens Bookings already filtered to that reservation.' },
          { title: 'Or filter the Bookings list', body: 'On the Bookings page, use the filters bar — status, dates and room number narrow the list without leaving the page.' },
        ],
      },
      { type: 'callout', tone: 'tip', body: 'Pasting a booking code into the palette is the single fastest lookup — the result deep-links into the filtered list.' },
      { type: 'callout', tone: 'info', title: 'If it still does not appear', body: 'Voided bookings and released unpaid holds are excluded from everyday views. See “Can’t find a booking?” for the full checklist.' },
    ],
  },
  {
    slug: 'check-in-a-guest',
    title: 'Check a guest in',
    summary: 'Mark arrival on the day of check-in — confirmed and pending bookings qualify; early check-in is flagged, not blocked.',
    category: 'bookings',
    keywords: ['arrival', 'checkin', 'front desk', 'early check in', 'guest arrives'],
    routePath: '/bookings',
    requiredPermissions: ['bookings:update'],
    lastReviewed: '2026-09-13',
    relatedSlugs: ['check-out-a-guest', 'find-a-reservation', 'housekeeping-maintenance'],
    blocks: [
      { type: 'paragraph', text: 'A booking can be checked in once its status is confirmed or pending and the arrival date has been reached. The Check in action lives on the booking itself.' },
      {
        type: 'steps',
        steps: [
          { title: 'Open the booking', body: 'Find it via ⌘K or the Bookings list and open its details.' },
          { title: 'Choose Check in', body: 'The action only appears when the booking qualifies — status confirmed or pending and today is on or after the check-in date.' },
          { title: 'Review the check-in advisory', body: 'Guests who normally bill to a company can trigger an advisory before you proceed — read it, then confirm.' },
          { title: 'Confirm', body: 'The booking moves to checked_in and the room shows as occupied on Rooms and the Timeline.' },
        ],
      },
      { type: 'callout', tone: 'info', title: 'Early check-in', body: 'Arriving before the configured check-in time (Hotel Settings → check-in time, default 15:00) surfaces an early check-in prompt rather than a hard stop.' },
      { type: 'callout', tone: 'warning', body: 'The Check in button will not appear before the arrival date — this is deliberate. If a guest arrives a day early, edit the booking dates first.' },
    ],
  },
  {
    slug: 'check-out-a-guest',
    title: 'Check a guest out',
    summary: 'Close the stay from the booking or the Rooms board — only checked-in bookings can check out.',
    category: 'bookings',
    keywords: ['departure', 'checkout', 'leave', 'settle', 'overdue checkout'],
    routePath: '/room-management',
    requiredPermissions: ['bookings:update'],
    lastReviewed: '2026-09-13',
    relatedSlugs: ['check-in-a-guest', 'refund-a-deposit', 'housekeeping-maintenance'],
    blocks: [
      {
        type: 'steps',
        steps: [
          { title: 'Open the booking or the Rooms board', body: 'Check out is available from the booking’s actions, and the Rooms board surfaces Overdue Checkouts so nothing is forgotten.' },
          { title: 'Choose Check out', body: 'The action appears only while the booking status is checked_in.' },
          { title: 'Settle the stay', body: 'Bookings past their check-out date with an outstanding balance — including company-billed stays past payment terms — are surfaced so you can collect or arrange payment before or at departure.' },
          { title: 'Hand the room to housekeeping', body: 'After check-out the room returns to the housekeeping/maintenance workflow for cleaning before the next arrival.' },
        ],
      },
      { type: 'callout', tone: 'tip', body: 'If a deposit was collected, refund it at check-out — see “Refund a deposit”.' },
      { type: 'callout', tone: 'warning', body: 'A booking cannot be checked out unless it is checked_in. If the status looks wrong, check the booking timeline to see what happened.' },
    ],
  },
  {
    slug: 'void-reactivate-release',
    title: 'Void, reactivate, or release a booking',
    summary: 'Void cancels a booking, reactivate restores a voided one, and release frees an unpaid online hold — three different actions with different rules.',
    category: 'bookings',
    keywords: ['cancel', 'void', 'reactivate', 'release', 'unpaid hold', 'no payment', 'noshow'],
    routePath: '/bookings',
    requiredPermissions: ['bookings:update'],
    lastReviewed: '2026-09-13',
    relatedSlugs: ['create-a-booking', 'refund-a-deposit', 'find-a-reservation'],
    blocks: [
      { type: 'paragraph', text: 'Each action exists for a different situation, and each is only offered when the booking qualifies — if a button is missing, the booking’s status is the reason.' },
      {
        type: 'list',
        items: [
          'Void — cancels the booking. Available on any booking that is not already voided. Use it for cancellations.',
          'Reactivate — restores a voided booking back to life. Only offered on voided bookings.',
          'Release — frees a room held by an unpaid online booking. Only offered while status is pending_payment and no payment has been collected.',
        ],
      },
      { type: 'heading', text: 'Unpaid holds release themselves' },
      { type: 'paragraph', text: 'A background job automatically releases unpaid holds after the window configured in Hotel Settings (unpaid hold release hours — 24 by default, 0 disables). Manual release is for clearing the room sooner.' },
      { type: 'callout', tone: 'important', title: 'Money collected?', body: 'Release is deliberately unavailable once any payment exists — the backend enforces it too. Void the booking and refund the guest instead.' },
      { type: 'callout', tone: 'tip', body: 'Every one of these transitions is written to the booking timeline and the Audit Log — you can always see who did what.' },
    ],
  },
  {
    slug: 'read-the-timeline',
    title: 'Read the reservation timeline',
    summary: 'A room-by-day view of who is arriving, in-house, or leaving — the fastest way to see occupancy at a glance.',
    category: 'bookings',
    keywords: ['timeline', 'calendar', 'occupancy view', 'room movement', 'arrivals departures'],
    routePath: '/timeline',
    requiredPermissions: ['bookings:read'],
    lastReviewed: '2026-09-13',
    relatedSlugs: ['daily-room-operations', 'check-in-a-guest', 'reports-and-metrics'],
    blocks: [
      { type: 'paragraph', text: 'The Timeline lays bookings across rooms and days so you can see arrivals, in-house stays and departures as a map instead of a list. It is the right screen for room-move planning and spotting gaps.' },
      {
        type: 'list',
        items: [
          'Scan a week of occupancy in seconds — useful before accepting a walk-in.',
          'Plan room moves around back-to-back reservations on the same room.',
          'Spot free rooms for early check-ins without opening each booking.',
        ],
      },
      { type: 'callout', tone: 'tip', body: 'Pair it with the Rooms board: Timeline for “who goes where when”, Rooms for “what state is each room in now”.' },
    ],
  },

  // -------------------------------------------------------------------- guests
  {
    slug: 'manage-guest-profiles',
    title: 'Manage guest profiles',
    summary: 'Search, edit, and maintain guest records — including profile completeness and portal account transfers.',
    category: 'guests',
    keywords: ['guest', 'profile', 'edit guest', 'guest history', 'ic number', 'portal account'],
    routePath: '/guest-config',
    requiredPermissions: ['guests:read', 'guests:update'],
    lastReviewed: '2026-09-13',
    relatedSlugs: ['create-a-booking', 'notifications-guest-support', 'import-export-data'],
    blocks: [
      {
        type: 'steps',
        steps: [
          { title: 'Open Guests', body: 'Guest Management lists every guest profile. Search narrows by name or contact details.' },
          { title: 'Open a profile', body: 'See contact details, identity fields, booking history and profile completeness at a glance.' },
          { title: 'Edit what changed', body: 'Keep phone and email current — they drive receipts, campaigns and the pre-check-in flow.' },
          { title: 'Handle portal accounts carefully', body: 'Transfer Guest Portal Account moves a portal login to a different profile — use it only when you are certain the accounts belong to the same person.' },
        ],
      },
      { type: 'callout', tone: 'warning', title: 'Deleting guests', body: 'Delete Guest removes the profile. Prefer editing over deleting when bookings exist — the history matters for ledgers and reports.' },
      { type: 'callout', tone: 'tip', body: 'Profile completeness flags missing fields (like phone) that block flows such as notifications — it is the first place to look when a guest “can’t be contacted”.' },
    ],
  },

  // ----------------------------------------------------------- rooms & inventory
  {
    slug: 'room-types-and-rooms',
    title: 'Set up room types and rooms',
    summary: 'Room types define what a room is and costs; rooms are the physical units guests sleep in — both are managed in Room Configuration.',
    category: 'rooms-inventory',
    keywords: ['room type', 'add room', 'new room', 'bed setup', 'capacity', 'pricing', 'delete room'],
    routePath: '/room-config',
    requiredPermissions: ['rooms:create', 'rooms:update'],
    lastReviewed: '2026-09-13',
    featured: true,
    relatedSlugs: ['daily-room-operations', 'online-inventory-grid', 'promotions-vouchers'],
    blocks: [
      { type: 'paragraph', text: 'Room Configuration is where the property model lives. A room type carries the shared definition — name, bed setup, capacity, pricing and status — and each room is a numbered unit of a type.' },
      {
        type: 'steps',
        steps: [
          { title: 'Open Room Configuration', body: 'Find it under the Configuration menu.' },
          { title: 'Create or edit a room type', body: 'Work through the sections — Basics (name, description), Bed Setup, Capacity (max occupancy), Pricing (price per night) and Status.' },
          { title: 'Add rooms to the type', body: 'Each room gets a number and belongs to a type. Rooms inherit the type’s pricing and capacity.' },
          { title: 'Review before deleting', body: 'Delete Room removes a unit; Delete Room Type removes the definition — only when nothing depends on it.' },
        ],
      },
      { type: 'callout', tone: 'important', title: 'Pricing lives here', body: 'The rate guests see starts at the room type’s Pricing section. Online overrides are handled separately in Online Inventory.' },
      { type: 'callout', tone: 'tip', body: 'Max Occupancy drives both booking validation and housekeeping planning — keep it honest.' },
    ],
  },
  {
    slug: 'daily-room-operations',
    title: 'Run daily room operations',
    summary: 'The Rooms board: live room status, check-ins and check-outs, room moves, maintenance blocks and overdue departures.',
    category: 'rooms-inventory',
    keywords: ['room status', 'occupied', 'maintenance', 'blocked room', 'room move', 'overdue checkout', 'dirty room'],
    routePath: '/room-management',
    requiredPermissions: ['rooms:read', 'rooms:update'],
    lastReviewed: '2026-09-13',
    relatedSlugs: ['check-out-a-guest', 'housekeeping-maintenance', 'read-the-timeline'],
    blocks: [
      { type: 'paragraph', text: 'Rooms is the operational board for the physical property — which rooms are occupied, which are free, which are blocked, and which departures are overdue.' },
      {
        type: 'list',
        items: [
          'Check-in / Check-out columns show today’s movement at a glance.',
          'Overdue Checkouts surfaces guests who should have left — work it first thing each shift.',
          'Maintenance / Blocked marks a room unsellable until the block lifts.',
          'Select New Room moves a guest between rooms without voiding the booking.',
        ],
      },
      {
        type: 'steps',
        steps: [
          { title: 'Start from the Rooms board', body: 'Open Rooms for the property overview.' },
          { title: 'Handle overdue checkouts first', body: 'Follow up or check out each overdue stay so the room can be cleaned and resold.' },
          { title: 'Block rooms honestly', body: 'A room under maintenance must be marked Maintenance / Blocked — otherwise online inventory keeps selling it.' },
          { title: 'Move guests with Select New Room', body: 'For a room change, pick the new room — the booking follows the guest.' },
        ],
      },
      { type: 'callout', tone: 'warning', body: 'A blocked room still needs a maintenance ticket for tracking — see “Housekeeping and maintenance tickets”.' },
    ],
  },
  {
    slug: 'online-inventory-grid',
    title: 'Control online inventory',
    summary: 'Override availability and price per room type per date on the Online Inventory grid — bulk edits included.',
    category: 'rooms-inventory',
    keywords: ['online inventory', 'availability', 'sell online', 'rate override', 'close dates', 'stop sell'],
    routePath: '/online-inventory',
    requiredPermissions: ['rooms:update'],
    lastReviewed: '2026-09-13',
    relatedSlugs: ['room-types-and-rooms', 'daily-room-operations', 'reports-and-metrics'],
    blocks: [
      { type: 'paragraph', text: 'Online Inventory is a date-by-room-type grid controlling what guests can book online. Each cell can hold an override — the base value comes from the room type.' },
      {
        type: 'steps',
        steps: [
          { title: 'Open Online Inventory', body: 'The grid shows room types as rows and upcoming dates as columns.' },
          { title: 'Edit a single cell', body: 'Click a cell to open the editor popover and set that date’s values.' },
          { title: 'Or bulk-edit a range', body: 'Select multiple cells, then use the Bulk Edit panel to apply one change across the selection.' },
          { title: 'Review before saving', body: 'Changes collect in Review Changes — confirm there, and use the “overrides only” filter to audit what differs from the base setup.' },
        ],
      },
      { type: 'callout', tone: 'tip', body: 'Changed and overridden cells are flagged, so you can always tell base configuration from one-off decisions.' },
      { type: 'callout', tone: 'important', body: 'To stop online sales for a date, override the cell — do not block the room physically unless it is genuinely out of service.' },
    ],
  },
  {
    slug: 'housekeeping-maintenance',
    title: 'Housekeeping and maintenance tickets',
    summary: 'Track room condition and maintenance work — create tickets, assign them, and move rooms back into service.',
    category: 'rooms-inventory',
    keywords: ['housekeeping', 'cleaning', 'maintenance ticket', 'repair', 'dirty', 'assigned to'],
    routePath: '/housekeeping',
    requiredPermissions: ['housekeeping:read', 'housekeeping:create'],
    lastReviewed: '2026-09-13',
    relatedSlugs: ['daily-room-operations', 'check-out-a-guest', 'room-types-and-rooms'],
    blocks: [
      { type: 'paragraph', text: 'Housekeeping coordinates cleaning and maintenance work per room. Maintenance issues are tracked as tickets with a room, category, priority, assignee and status.' },
      {
        type: 'steps',
        steps: [
          { title: 'Open Housekeeping', body: 'Filter the board by floor, priority or status to focus the shift.' },
          { title: 'Create a maintenance ticket', body: 'New maintenance ticket captures the room, category, priority, title and who it is assigned to.' },
          { title: 'Work the queue', body: 'Update ticket status as work progresses; blocked rooms stay unsellable until resolved.' },
          { title: 'Return the room to service', body: 'Once resolved and cleaned, clear any Maintenance / Blocked status on the Rooms board.' },
        ],
      },
      { type: 'callout', tone: 'tip', body: 'Filter by priority first — a leaking air-conditioner outranks a scuffed wall when rooms are selling.' },
    ],
  },

  // ----------------------------------------------------------- payments & ledgers
  {
    slug: 'refund-a-deposit',
    title: 'Refund a deposit',
    summary: 'Return a guest’s deposit from the booking — refunds are a normal checkout task; undoing one is deliberately restricted.',
    category: 'payments-ledgers',
    keywords: ['refund', 'deposit', 'money back', 'return deposit', 'revert refund'],
    routePath: '/bookings',
    requiredPermissions: ['payments:refund'],
    lastReviewed: '2026-09-13',
    featured: true,
    relatedSlugs: ['check-out-a-guest', 'review-payment-approvals', 'payment-problems'],
    blocks: [
      { type: 'paragraph', text: 'Deposit refunds are routine front-desk work at checkout. The refund action lives on the booking’s payment actions and requires the payments:refund permission, which receptionists and managers hold.' },
      {
        type: 'steps',
        steps: [
          { title: 'Open the booking', body: 'Find the stay and open its payment details.' },
          { title: 'Choose the deposit refund action', body: 'Confirm the amount being returned to the guest.' },
          { title: 'Record the method', body: 'Refund the same way the deposit was collected unless there is a reason not to — the record is what the ledger and audit trail show.' },
        ],
      },
      { type: 'callout', tone: 'important', title: 'Undoing a refund is restricted', body: 'Reverting a deposit refund re-opens the deposit for refunding and requires payments:manage — receptionists cannot cycle refund/revert on their own. Double-check before confirming.' },
      { type: 'callout', tone: 'tip', body: 'If the refund button is missing, you lack payments:refund — ask a manager rather than working around it with a manual adjustment.' },
    ],
  },
  {
    slug: 'review-payment-approvals',
    title: 'Review payment approvals',
    summary: 'Payment proofs wait in a review queue — check the receipt against the booking, then approve or reject.',
    category: 'payments-ledgers',
    keywords: ['payment approval', 'receipt', 'proof of payment', 'approve payment', 'reject payment', 'bank transfer'],
    routePath: '/payment-approvals',
    requiredPermissions: ['payments:approve'],
    lastReviewed: '2026-09-13',
    relatedSlugs: ['refund-a-deposit', 'company-ledgers', 'payment-problems'],
    blocks: [
      { type: 'paragraph', text: 'Payment Approvals lists submitted payment proofs with the booking, guest, amount, method and receipt. Each item moves from Submitted to Reviewed once you act on it.' },
      {
        type: 'steps',
        steps: [
          { title: 'Open Payment Approvals', body: 'Find it under the Administration menu.' },
          { title: 'Inspect the proof', body: 'Open the item and download the receipt — check the amount and reference against the booking.' },
          { title: 'Approve or reject', body: 'Approve when the proof matches; reject with a reason when it does not. The decision is recorded against your account.' },
        ],
      },
      { type: 'callout', tone: 'warning', body: 'Rejected online payments trigger the payment-recovery email flow to the guest — reject only when the proof is genuinely wrong.' },
      { type: 'callout', tone: 'tip', body: 'Work the queue oldest-first: a guest’s check-in can be waiting on your review.' },
    ],
  },
  {
    slug: 'company-ledgers',
    title: 'Work with company ledgers',
    summary: 'Corporate accounts accumulate billed stays in a ledger — review balances, payment terms and overdue accounts.',
    category: 'payments-ledgers',
    keywords: ['ledger', 'company', 'corporate', 'invoice', 'billed', 'payment terms', 'city ledger'],
    routePath: '/company-ledger',
    requiredPermissions: ['ledgers:read'],
    lastReviewed: '2026-09-13',
    relatedSlugs: ['review-payment-approvals', 'reports-and-metrics', 'manage-guest-profiles'],
    blocks: [
      { type: 'paragraph', text: 'Company Ledger tracks stays billed to corporate accounts instead of paid at checkout. Each ledger shows the company, its bookings and the running balance.' },
      {
        type: 'list',
        items: [
          'Guests on company-billed bookings can trigger an advisory at check-in — the bill goes to the company, not the guest.',
          'Payment terms define how long a company has to settle; accounts past terms with a balance are surfaced automatically.',
          'The Bookings list can filter to company-billed stays only.',
        ],
      },
      { type: 'callout', tone: 'tip', body: 'A company past its terms is a conversation for the manager — the system flags it, people resolve it.' },
    ],
  },
  {
    slug: 'complimentary-nights-credits',
    title: 'Complimentary nights and guest credits',
    summary: 'Mark stays as complimentary, convert them to credits, and manage free-night balances per guest and room type.',
    category: 'payments-ledgers',
    keywords: ['complimentary', 'free night', 'credits', 'free room credits', 'gift credits', 'comp stay'],
    routePath: '/complimentary',
    requiredPermissions: ['bookings:update'],
    lastReviewed: '2026-09-13',
    relatedSlugs: ['create-a-booking', 'company-ledgers', 'loyalty-program'],
    blocks: [
      { type: 'paragraph', text: 'Complimentary management covers free stays: marking a booking complimentary, converting complimentary stays into guest credits, and booking with those credits — all tracked per guest and room type.' },
      {
        type: 'list',
        items: [
          'Mark a booking complimentary from the booking actions.',
          'Convert a complimentary stay to credits — the balance sits with the guest, scoped by room type.',
          'Book with credits to spend a guest’s free-night balance on a new stay.',
          'The summary view shows outstanding complimentary and credit totals.',
        ],
      },
      { type: 'callout', tone: 'important', body: 'Removing complimentary status or deleting credits changes what a guest is owed — treat both as manager-level decisions even where the permission allows them.' },
    ],
  },

  // ---------------------------------------------------------- rates & promotions
  {
    slug: 'promotions-vouchers',
    title: 'Manage promotions and vouchers',
    summary: 'Create the offers guests see on the public Offers page and the vouchers that discount a booking.',
    category: 'rates-promotions',
    keywords: ['promotion', 'voucher', 'discount', 'promo code', 'offer', 'deal'],
    routePath: '/promotions',
    requiredPermissions: ['promotions:manage', 'vouchers:manage'],
    lastReviewed: '2026-09-13',
    relatedSlugs: ['email-campaigns-templates', 'online-inventory-grid', 'room-types-and-rooms'],
    blocks: [
      { type: 'paragraph', text: 'Promotions & Vouchers manages the deals side of the property: public offers that guests can see on the Offers page, and vouchers applied to bookings.' },
      {
        type: 'list',
        items: [
          'Promotions define the deal — what it is called, when it runs and what it gives.',
          'Vouchers are the redeemable codes tied to those offers.',
          'Campaign emails can reference a promotion directly from Communications.',
        ],
      },
      { type: 'callout', tone: 'tip', body: 'Promotions sell what Online Inventory prices — keep the public offer, the voucher terms and the actual rates telling the same story.' },
    ],
  },
  {
    slug: 'loyalty-program',
    title: 'Understand the loyalty programme',
    summary: 'Loyalty tracks returning guests and their rewards — view it from the Loyalty section under Administration.',
    category: 'rates-promotions',
    keywords: ['loyalty', 'rewards', 'points', 'returning guest', 'member'],
    routePath: '/loyalty',
    requiredPermissions: ['loyalty:read'],
    lastReviewed: '2026-09-13',
    relatedSlugs: ['complimentary-nights-credits', 'manage-guest-profiles', 'promotions-vouchers'],
    blocks: [
      { type: 'paragraph', text: 'The Loyalty section shows the programme side of returning guests: membership state and rewards posture. Staff with loyalty:manage administer it; loyalty:read is enough to look.' },
      { type: 'callout', tone: 'tip', body: 'Loyalty, complimentary nights and guest credits are three different levers — check a guest’s profile before applying any of them so you do not double-compensate.' },
    ],
  },

  // ------------------------------------------------------ reports & night audit
  {
    slug: 'reports-and-metrics',
    title: 'Read reports and metrics',
    summary: 'Daily operations, occupancy (including ADR and RevPAR) and revenue reports — what each number means.',
    category: 'reports-night-audit',
    keywords: ['reports', 'occupancy', 'adr', 'revpar', 'revenue', 'arrivals', 'departures', 'analytics', 'metric'],
    routePath: '/reports',
    requiredPermissions: ['reports:read'],
    lastReviewed: '2026-09-13',
    featured: true,
    relatedSlugs: ['run-night-audit', 'audit-log', 'online-inventory-grid'],
    blocks: [
      { type: 'paragraph', text: 'Reports turns raw operations into summaries. Three families cover most needs: Daily Operations for today’s movement, Occupancy for how full the property is, and Revenue for the money.' },
      {
        type: 'list',
        items: [
          'Daily Operations — arrivals today, departures today, in-house guests and occupancy rate.',
          'Occupancy — rooms sold vs total rooms, plus ADR (average daily rate) and RevPAR (revenue per available room).',
          'Revenue — total revenue broken down by room type and by booking source.',
        ],
      },
      { type: 'heading', text: 'The two metrics people ask about' },
      {
        type: 'list',
        items: [
          'ADR — the average price paid per sold room: room revenue ÷ rooms sold. It answers “are we selling high?”',
          'RevPAR — revenue spread over every room you own, sold or not: room revenue ÷ total rooms. It answers “are we filling up at a good rate?”',
        ],
      },
      { type: 'callout', tone: 'tip', body: 'Occupancy rate without ADR hides discounting; ADR without occupancy hides empty rooms. Read them together.' },
    ],
  },
  {
    slug: 'run-night-audit',
    title: 'Run the night audit',
    summary: 'Close the business day: confirm the audit, which locks bookings from editing and snapshots room status.',
    category: 'reports-night-audit',
    keywords: ['night audit', 'end of day', 'close day', 'lock bookings', 'business date'],
    routePath: '/night-audit',
    requiredPermissions: ['night_audit:execute'],
    lastReviewed: '2026-09-13',
    relatedSlugs: ['reports-and-metrics', 'audit-log', 'hotel-settings'],
    blocks: [
      { type: 'paragraph', text: 'The night audit closes the hotel’s business day. Confirming it records who ran it and when, locks the day’s bookings from further editing, and can snapshot room status for reporting.' },
      {
        type: 'steps',
        steps: [
          { title: 'Open Night Audit', body: 'Find it under the Administration menu and check the audit date.' },
          { title: 'Review what the run will do', body: 'The confirmation lists the options — including locking bookings and recording the room status snapshot.' },
          { title: 'Confirm Night Audit', body: 'The run is recorded with your account and timestamp; the Audit Log reflects it.' },
        ],
      },
      { type: 'callout', tone: 'important', title: 'Locking is real', body: 'After the audit, the day’s bookings resist further edits — run it when the day is genuinely done, or use the auto-run setting in Hotel Settings.' },
      { type: 'callout', tone: 'tip', body: 'The business date follows the hotel timezone in Hotel Settings — the audit closes that day, not UTC midnight.' },
    ],
  },
  {
    slug: 'audit-log',
    title: 'Use the audit log',
    summary: 'A read-only record of who changed what — the first stop when something looks different than yesterday.',
    category: 'reports-night-audit',
    keywords: ['audit log', 'history', 'who changed', 'activity', 'trail'],
    routePath: '/audit-log',
    requiredPermissions: ['audit:read'],
    lastReviewed: '2026-09-13',
    relatedSlugs: ['page-missing-or-access-denied', 'run-night-audit', 'roles-and-permissions'],
    blocks: [
      { type: 'paragraph', text: 'The Audit Log records mutating actions across the system — booking changes, settings edits, role updates, night-audit runs. It is read-only by design.' },
      {
        type: 'list',
        items: [
          'Investigating a changed booking or setting → start here before asking around.',
          'Access reviews → the log shows who granted what and when.',
          'Every entry names the actor and the timestamp, so follow-ups go to a person, not a mystery.',
        ],
      },
      { type: 'callout', tone: 'tip', body: 'Pair it with the booking timeline: the log records the action, the timeline tells the stay’s story.' },
    ],
  },

  // ------------------------------------------------------------- communications
  {
    slug: 'email-campaigns-templates',
    title: 'Send email campaigns and manage templates',
    summary: 'Build reusable email templates, then send campaigns to selected guests — with a test email before anything real goes out.',
    category: 'communications',
    keywords: ['email', 'campaign', 'template', 'announcement', 'marketing', 'send test', 'variables'],
    routePath: '/communications',
    requiredPermissions: ['communications:compose', 'communications:send'],
    lastReviewed: '2026-09-13',
    relatedSlugs: ['email-not-sending', 'promotions-vouchers', 'notifications-guest-support'],
    blocks: [
      { type: 'paragraph', text: 'Communications has two halves: Email templates (reusable content with variables) and Campaigns (actual sends to recipients, such as announcements linked to a promotion).' },
      {
        type: 'steps',
        steps: [
          { title: 'Create or pick a template', body: 'Templates carry the subject and body with variables for guest-specific values.' },
          { title: 'Send a test email', body: 'Send test email proves formatting and delivery to your own address before any guest sees it.' },
          { title: 'Create the campaign', body: 'Choose type (for example Announcement), recipients, subject and body — optionally linking a promotion.' },
          { title: 'Watch the send', body: 'Campaigns move through draft → scheduled → running → completed; Sent / Failed counts and the Last error column expose problems.' },
        ],
      },
      { type: 'callout', tone: 'tip', body: 'Always send the test first — a broken variable is embarrassing at scale.' },
    ],
  },
  {
    slug: 'notifications-guest-support',
    title: 'Notifications and the guest support inbox',
    summary: 'Your notification feed is for you; the Support inbox is for guests — answer their messages there.',
    category: 'communications',
    keywords: ['notifications', 'bell', 'support inbox', 'guest messages', 'conversation', 'reply', 'assign'],
    routePath: '/support',
    requiredPermissions: ['support:read', 'support:write'],
    lastReviewed: '2026-09-13',
    relatedSlugs: ['email-not-sending', 'manage-guest-profiles', 'getting-around-admin-portal'],
    blocks: [
      { type: 'paragraph', text: 'Two different “support” surfaces exist. The bell in the top bar is your staff notification feed. Support under Operations is the inbox where guests’ messages from the portal arrive — those need staff replies.' },
      {
        type: 'steps',
        steps: [
          { title: 'Open Support', body: 'The conversation list shows open guest conversations.' },
          { title: 'Read and reply', body: 'Open a conversation to see the guest’s messages and reply inline.' },
          { title: 'Assign when needed', body: 'Conversations can be assigned to agents — take or hand off ownership rather than replying in parallel.' },
          { title: 'Update the status', body: 'Close or update the conversation state so the queue stays honest.' },
        ],
      },
      { type: 'callout', tone: 'info', title: 'Not staff IT support', body: 'This inbox is for guests asking the hotel for help. For help with the admin portal itself, use the Help Centre’s “Get more help” guidance.' },
      { type: 'callout', tone: 'tip', body: 'The support inbox can be switched off property-wide in Hotel Settings — if the whole module vanished, that toggle is the first suspect.' },
    ],
  },
  {
    slug: 'email-not-sending',
    title: 'Email is not sending',
    summary: 'Diagnose campaign and notification email failures — most causes are visible in the Last error column or a failed test send.',
    category: 'communications',
    keywords: ['email failed', 'smtp', 'not sending', 'email error', 'campaign failed', 'last error'],
    routePath: '/communications',
    requiredPermissions: ['communications:read'],
    lastReviewed: '2026-09-13',
    relatedSlugs: ['email-campaigns-templates', 'notifications-guest-support', 'escalation'],
    blocks: [
      { type: 'paragraph', text: 'Email runs through a background worker that needs SMTP credentials configured on the server. When mail stops, the evidence is almost always on the Communications page itself.' },
      {
        type: 'steps',
        steps: [
          { title: 'Send a test email', body: 'A failed test proves the problem is infrastructure, not your campaign content.' },
          { title: 'Read the Last error column', body: 'Campaign sends record the failure reason per recipient — authentication, connection and address errors each mean different fixes.' },
          { title: 'Check Sent / Failed counts', body: 'Partial failures point to recipient addresses; total failure points to the SMTP configuration.' },
          { title: 'Escalate SMTP problems', body: 'Server mail settings are environment configuration, not a screen in the portal — hand them to whoever manages the deployment.' },
        ],
      },
      { type: 'callout', tone: 'important', body: 'If no SMTP settings exist, the email worker is simply off — nothing is broken on your screen, the capability was never configured.' },
    ],
  },

  // -------------------------------------------------------------- staff & access
  {
    slug: 'add-manage-staff',
    title: 'Add and manage staff accounts',
    summary: 'Create a login for a colleague, assign their roles, and edit or remove accounts from Access Control.',
    category: 'staff-access',
    keywords: ['add user', 'new staff', 'employee account', 'create user', 'delete user', 'staff login'],
    routePath: '/rbac',
    requiredPermissions: ['users:create', 'users:update'],
    lastReviewed: '2026-09-13',
    featured: true,
    relatedSlugs: ['roles-and-permissions', 'sign-in-and-security', 'page-missing-or-access-denied'],
    blocks: [
      {
        type: 'steps',
        steps: [
          { title: 'Open Access Control', body: 'Find it under the Configuration menu, then open the Users tab.' },
          { title: 'Choose Add User', body: 'The Create New User dialog collects the account details for the new staff member.' },
          { title: 'Assign roles', body: 'Roles decide what the person can see and do — a receptionist and a manager get different portals. Assign them in the same flow or afterwards from the user’s row.' },
          { title: 'Edit or remove later', body: 'Edit User updates details; Delete User removes the account entirely when someone leaves.' },
        ],
      },
      { type: 'callout', tone: 'important', title: 'Role before first login', body: 'A user with no roles sees almost nothing — if a colleague reports an empty portal, check their role assignment first.' },
      { type: 'callout', tone: 'tip', body: 'Prefer editing roles over creating one-off accounts; the Audit Log tracks every change either way.' },
    ],
  },
  {
    slug: 'roles-and-permissions',
    title: 'Roles and permissions',
    summary: 'Roles bundle permissions; permissions gate pages and actions. The *:manage permission implies the rest of its domain.',
    category: 'staff-access',
    keywords: ['role', 'permission', 'rbac', 'access control', 'manage permission', 'receptionist manager'],
    routePath: '/rbac',
    requiredPermissions: ['roles:read', 'roles:manage'],
    lastReviewed: '2026-09-13',
    relatedSlugs: ['add-manage-staff', 'page-missing-or-access-denied', 'audit-log'],
    blocks: [
      { type: 'paragraph', text: 'Access Control has three tabs: Users (accounts), Roles (named bundles like Receptionist or Manager) and Permissions (the individual abilities grouped by domain).' },
      {
        type: 'list',
        items: [
          'A permission looks like resource:action — for example bookings:create or payments:refund.',
          'The resource:manage permission implies every action on that resource.',
          'Route policies map pages to permissions, which is why menus differ per user.',
          'System roles ship with sensible grants; custom roles can be created for unusual setups.',
        ],
      },
      { type: 'callout', tone: 'warning', body: 'Changing a system role changes it for everyone holding it — prefer a new role when one person needs something different.' },
      { type: 'callout', tone: 'tip', body: 'Permissions are grouped by category on the Permissions tab — expand a category to see exactly what a role can do.' },
    ],
  },
  {
    slug: 'ekyc-reviews',
    title: 'Review eKYC submissions',
    summary: 'Identity verification work happens in the eKYC Admin queue — assigned reviewers act on submissions by risk level.',
    category: 'staff-access',
    keywords: ['ekyc', 'identity', 'verification', 'kyc', 'reviewer', 'compliance'],
    routePath: '/ekyc-admin',
    requiredPermissions: ['ekyc:review'],
    lastReviewed: '2026-09-13',
    relatedSlugs: ['roles-and-permissions', 'audit-log', 'manage-guest-profiles'],
    blocks: [
      { type: 'paragraph', text: 'eKYC Admin is the review queue for electronic identity verification. Dedicated roles — eKYC Reviewer, Senior Reviewer and Compliance Administrator — handle submissions, with high-risk cases escalated to senior review.' },
      {
        type: 'list',
        items: [
          'Reviewers act on assigned applications; senior reviewers handle escalations and high-risk approvals.',
          'Sensitive actions (revealing documents, viewing provider data) have their own permissions and are logged.',
          'If you cannot see the module, you hold no eKYC role — that is by design, not a bug.',
        ],
      },
      { type: 'callout', tone: 'info', body: 'eKYC permissions are deliberately granular — request only the actions your review level needs.' },
    ],
  },

  // ------------------------------------------------------------- settings & data
  {
    slug: 'hotel-settings',
    title: 'Configure hotel settings',
    summary: 'Property profile, check-in/out times, timezone, taxes, deposits, report fonts and feature toggles — the defaults every other screen inherits.',
    category: 'settings-data',
    keywords: ['settings', 'hotel name', 'timezone', 'check in time', 'tax', 'deposit', 'tourism tax', 'service tax', 'configuration'],
    routePath: '/settings',
    requiredPermissions: ['settings:update'],
    lastReviewed: '2026-09-13',
    relatedSlugs: ['run-night-audit', 'room-types-and-rooms', 'notifications-guest-support'],
    blocks: [
      { type: 'paragraph', text: 'Hotel Settings holds the property-wide defaults other screens inherit: name and contact details, check-in/check-out times, timezone, deposit amount, service and tourism tax rates, payment terms, report typography and feature toggles.' },
      {
        type: 'list',
        items: [
          'Check-in and check-out times drive early check-in prompts and housekeeping targets.',
          'Timezone defines the business date — reports, night audit and “today” all follow it.',
          'Deposit amount, service tax and tourism tax feed booking totals; foreign guests carry tourism tax.',
          'Support and guest-cancellation toggles switch whole features on or off.',
          'Report font settings shape printed output.',
        ],
      },
      { type: 'callout', tone: 'important', title: 'The unpaid-hold window lives here too', body: 'Unpaid hold release hours controls how long a pending_payment booking holds a room before auto-release (24 by default; 0 disables).' },
      { type: 'callout', tone: 'warning', body: 'Settings save applies immediately — a wrong tax rate or timezone touches every new booking.' },
    ],
  },
  {
    slug: 'import-export-data',
    title: 'Import and export data',
    summary: 'Data Transfer moves backups in and out — previews first, with a hard warning before anything destructive.',
    category: 'settings-data',
    keywords: ['import', 'export', 'backup', 'restore', 'data transfer', 'migration', 'database'],
    routePath: '/data-transfer',
    requiredPermissions: ['settings:manage'],
    lastReviewed: '2026-09-13',
    relatedSlugs: ['hotel-settings', 'audit-log', 'escalation'],
    blocks: [
      { type: 'paragraph', text: 'Data Transfer handles moving hotel data in and out — for backups, restores and migrations. Transfers are previewed before applying and logged in Transfer History.' },
      {
        type: 'steps',
        steps: [
          { title: 'Open Data Transfer', body: 'Choose a backup file to import or start an export.' },
          { title: 'Review the import preview', body: 'The preview shows what the file contains and flags missing dependencies before anything is written.' },
          { title: 'Confirm import', body: 'A full database restore deletes all existing data first — the UI says so plainly. Only proceed on a file you trust.' },
          { title: 'Check Transfer History', body: 'Past imports and exports are listed with who ran them.' },
        ],
      },
      { type: 'callout', tone: 'important', title: 'Destructive by design', body: '“This deletes all existing data first” is literal — a full restore replaces the database. Confirm the file and the timing with your administrator.' },
    ],
  },

  // ------------------------------------------------------------- troubleshooting
  {
    slug: 'cant-find-a-booking',
    title: 'Can’t find a booking?',
    summary: 'Work the checklist: search terms, filters, and the two states (voided, released) that hide a booking from everyday views.',
    category: 'troubleshooting',
    keywords: ['lost booking', 'missing reservation', 'cant find', 'no results', 'disappeared'],
    routePath: '/bookings',
    lastReviewed: '2026-09-13',
    relatedSlugs: ['find-a-reservation', 'void-reactivate-release', 'page-missing-or-access-denied'],
    blocks: [
      {
        type: 'checklist',
        items: [
          'Try the booking code in ⌘K — BK- codes and guest names both search.',
          'Remove filters on the Bookings list — a leftover status or room filter is the usual culprit.',
          'Check the dates: the stay may sit outside the range you are viewing.',
          'Ask whether the booking was voided — voided stays leave everyday views.',
          'Check for a released unpaid hold — an online booking that never got paid releases back to inventory automatically.',
          'Confirm you can see Bookings at all — a missing module is a permissions question, not a search problem.',
        ],
      },
      { type: 'callout', tone: 'tip', body: 'The booking timeline and Audit Log both survive voiding — if the booking ever existed, its story is still there.' },
    ],
  },
  {
    slug: 'payment-problems',
    title: 'Payment problems',
    summary: 'Failed online payments, stuck approvals and refund errors — match the symptom to the right queue.',
    category: 'troubleshooting',
    keywords: ['payment failed', 'payment error', 'declined', 'recover payment', 'approval stuck', 'refund error'],
    routePath: '/payment-approvals',
    lastReviewed: '2026-09-13',
    relatedSlugs: ['refund-a-deposit', 'review-payment-approvals', 'email-not-sending'],
    blocks: [
      {
        type: 'list',
        items: [
          'Guest payment failed online → a payment-recovery email can let them retry through a secure link — check the booking state before assuming the money is lost.',
          'A payment proof is waiting → it sits in Payment Approvals until someone reviews it; the guest sees “submitted”, not “confirmed”.',
          'Refund button missing → you need payments:refund; reverting a refund needs payments:manage.',
          'Booking stuck in pending_payment → it is an unpaid hold; it auto-releases or can be released manually.',
        ],
      },
      { type: 'callout', tone: 'warning', body: 'Never “fix” a stuck payment by editing the booking — work the approvals queue or escalate; the ledgers and audit trail need a real reason.' },
    ],
  },
  {
    slug: 'session-and-stale-data',
    title: 'Session and stale-data issues',
    summary: 'When screens look outdated or a session misbehaves — refresh order, idle expiry and the business-date gotcha.',
    category: 'troubleshooting',
    keywords: ['stale data', 'refresh', 'session expired', 'logged out', 'wrong date', 'timezone'],
    lastReviewed: '2026-09-13',
    relatedSlugs: ['sign-in-and-security', 'hotel-settings', 'page-missing-or-access-denied'],
    blocks: [
      {
        type: 'checklist',
        items: [
          'Refresh the page — after a long idle period the session token renews automatically; a stale screen just needs a reload.',
          'Sign out and back in if the session state is inconsistent.',
          'Dates look wrong → the business date follows the hotel timezone in Hotel Settings, not your laptop clock.',
          'A setting changed but nothing moved → some changes apply to new activity only, not retroactively.',
          'Another device looks different → theme and language are per-workstation, permissions are per-account.',
        ],
      },
      { type: 'callout', tone: 'info', body: 'Repeated sign-outs are not a fault — access tokens are short-lived by design and refresh silently in the background.' },
    ],
  },
  {
    slug: 'escalation',
    title: 'Get more help',
    summary: 'What to do when the Help Centre does not solve it — who to ask and what to bring them.',
    category: 'troubleshooting',
    keywords: ['contact', 'escalate', 'manager', 'administrator', 'more help', 'support'],
    lastReviewed: '2026-09-13',
    relatedSlugs: ['page-missing-or-access-denied', 'payment-problems', 'audit-log'],
    blocks: [
      { type: 'paragraph', text: 'The Help Centre covers how the portal works. For account access, permission changes and anything that smells like a defect, escalate inside your property’s own chain.' },
      {
        type: 'steps',
        steps: [
          { title: 'Ask your administrator or manager', body: 'Access, role and settings changes are theirs — bring the page name and what you expected to see.' },
          { title: 'Bring evidence', body: 'The Audit Log entry, the booking code, the campaign’s Last error text — a specific record beats a description of a symptom.' },
          { title: 'For guest-facing issues', body: 'If a guest is reporting the problem, check the Support inbox for their existing conversation rather than starting a parallel thread.' },
        ],
      },
      { type: 'callout', tone: 'tip', body: 'Screenshots help, but the exact error text and the time it happened help more — both are in the app’s own records.' },
    ],
  },
];
