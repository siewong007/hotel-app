import React from 'react';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import AssessmentIcon from '@mui/icons-material/Assessment';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import CardGiftcardIcon from '@mui/icons-material/CardGiftcard';
import EventNoteIcon from '@mui/icons-material/EventNote';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import HistoryIcon from '@mui/icons-material/History';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import MeetingRoomIcon from '@mui/icons-material/MeetingRoom';
import NightsStayIcon from '@mui/icons-material/NightsStay';
import PeopleIcon from '@mui/icons-material/People';
import PersonIcon from '@mui/icons-material/Person';
import SecurityIcon from '@mui/icons-material/Security';
import SettingsIcon from '@mui/icons-material/Settings';
import SyncAltIcon from '@mui/icons-material/SyncAlt';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import { lazyRoute, type PreloadableRouteComponent } from './lazyRoute';

export type RouteAnimation = 'fade' | 'slide' | 'grow';
export type NavGroup = 'main' | 'operations' | 'admin' | 'config';

interface AccessChecker {
  hasPermission: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
}

export interface AppRouteDefinition {
  id: string;
  path: string;
  component: PreloadableRouteComponent;
  animationType: RouteAnimation;
  visibility: 'auth' | 'unauth';
  icon?: React.ElementType;
  breadcrumbLabel?: string;
  navLabel?: string;
  navGroup?: NavGroup;
  requiredPermissions?: string[];
  requiredRoles?: string[];
  excludeRoles?: string[];
  navPermissions?: string[];
  navRoles?: string[];
  navExcludeRoles?: string[];
}

const LandingPage = lazyRoute(() => import('../components/layout/LandingPage'));
const DashboardRouter = lazyRoute(() => import('../features/dashboard/components/DashboardRouter'));
const BookingsPage = lazyRoute(() => import('../features/bookings/components/Bookings'));
const MyBookingsPage = lazyRoute(() => import('../features/bookings/components/MyBookingsPage'));
const ModernReportsPage = lazyRoute(() => import('../features/reports/components/ModernReportsPage'));
const LoyaltyPortal = lazyRoute(() => import('../features/loyalty/components/LoyaltyPortal'));
const LoyaltyDashboard = lazyRoute(() => import('../features/loyalty/components/LoyaltyDashboard'));
const UserProfilePage = lazyRoute(() => import('../features/user/components/UserProfilePage'));
const SettingsPage = lazyRoute(() => import('../features/user/components/SettingsPage'));
const HelpSupportPage = lazyRoute(() => import('../features/user/components/HelpSupportPage'));
const RBACManagementPage = lazyRoute(() => import('../features/admin/components/rbac/RBACManagementPage'));
const EkycRegistrationPage = lazyRoute(() => import('../features/ekyc/components/EkycRegistrationPage'));
const EkycManagementPage = lazyRoute(() => import('../features/ekyc/components/EkycManagementPage'));
const LoginPage = lazyRoute(() => import('../features/auth/components/LoginPage'));
const RegisterPage = lazyRoute(() => import('../features/auth/components/RegisterPage'));
const EmailVerificationPage = lazyRoute(() => import('../features/auth/components/EmailVerificationPage'));
const FirstLoginPasskeyPrompt = lazyRoute(() => import('../features/auth/components/FirstLoginPasskeyPrompt'));
const RoomReservationTimeline = lazyRoute(() => import('../features/rooms/components/RoomReservationTimeline'));
const RoomConfigurationPage = lazyRoute(() => import('../features/rooms/components/RoomConfigurationPage'));
const RoomManagementPage = lazyRoute(() => import('../features/rooms/components/RoomManagement'));
const GuestConfigurationPage = lazyRoute(() => import('../features/guests/components/GuestConfigurationPage'));
const GuestCheckInLanding = lazyRoute(() => import('../features/bookings/components/GuestCheckInLanding'));
const GuestCheckInVerify = lazyRoute(() => import('../features/bookings/components/GuestCheckInVerify'));
const GuestCheckInForm = lazyRoute(() => import('../features/bookings/components/GuestCheckInForm'));
const GuestCheckInConfirmation = lazyRoute(() => import('../features/bookings/components/GuestCheckInConfirmation'));
const CustomerLedgerPage = lazyRoute(() => import('../features/admin/components/CustomerLedger'));
const ComplimentaryManagementPage = lazyRoute(() => import('../features/admin/components/ComplimentaryManagementPage'));
const AuditLogPage = lazyRoute(() => import('../features/admin/components/AuditLogPage'));
const NightAuditPage = lazyRoute(() => import('../features/admin/components/NightAuditPage'));
const DataTransferPage = lazyRoute(() => import('../features/admin/components/DataTransferPage'));

const routeDefinitions: AppRouteDefinition[] = [
  { id: 'landing', path: '/', component: LandingPage, animationType: 'fade', visibility: 'unauth' },
  { id: 'login', path: '/login', component: LoginPage, animationType: 'fade', visibility: 'unauth' },
  { id: 'register', path: '/register', component: RegisterPage, animationType: 'fade', visibility: 'unauth' },
  { id: 'verify-email', path: '/verify-email', component: EmailVerificationPage, animationType: 'fade', visibility: 'unauth' },
  { id: 'guest-checkin', path: '/guest-checkin', component: GuestCheckInLanding, animationType: 'fade', visibility: 'unauth' },
  { id: 'guest-checkin-verify', path: '/guest-checkin/verify', component: GuestCheckInVerify, animationType: 'fade', visibility: 'unauth' },
  { id: 'guest-checkin-form', path: '/guest-checkin/form', component: GuestCheckInForm, animationType: 'fade', visibility: 'unauth' },
  { id: 'guest-checkin-confirm', path: '/guest-checkin/confirm', component: GuestCheckInConfirmation, animationType: 'fade', visibility: 'unauth' },
  { id: 'dashboard', path: '/', component: DashboardRouter, animationType: 'fade', visibility: 'auth' },
  {
    id: 'timeline',
    path: '/timeline',
    component: RoomReservationTimeline,
    animationType: 'slide',
    visibility: 'auth',
    icon: CalendarMonthIcon,
    breadcrumbLabel: 'Reservation Timeline',
    navLabel: 'Timeline',
    navGroup: 'main',
    requiredPermissions: ['rooms:read'],
    navPermissions: ['navigation_timeline:read', 'bookings:read'],
  },
  {
    id: 'guest-config',
    path: '/guest-config',
    component: GuestConfigurationPage,
    animationType: 'slide',
    visibility: 'auth',
    icon: PeopleIcon,
    breadcrumbLabel: 'Guest Management',
    navLabel: 'Guests',
    navGroup: 'main',
    requiredPermissions: ['guests:read', 'guests:manage'],
    navPermissions: ['navigation_guest_config:read', 'guests:read', 'guests:manage'],
  },
  {
    id: 'bookings',
    path: '/bookings',
    component: BookingsPage,
    animationType: 'slide',
    visibility: 'auth',
    icon: EventNoteIcon,
    breadcrumbLabel: 'Bookings',
    navLabel: 'Bookings',
    navGroup: 'main',
    requiredPermissions: ['bookings:read', 'bookings:manage'],
    navPermissions: ['navigation_bookings:read', 'bookings:read', 'bookings:manage'],
  },
  {
    id: 'my-bookings',
    path: '/my-bookings',
    component: MyBookingsPage,
    animationType: 'slide',
    visibility: 'auth',
    icon: EventNoteIcon,
    breadcrumbLabel: 'My Bookings',
    navLabel: 'My Bookings',
    navGroup: 'main',
    navPermissions: ['navigation_my_bookings:read'],
    navExcludeRoles: ['admin', 'receptionist', 'manager'],
  },
  {
    id: 'room-management',
    path: '/room-management',
    component: RoomManagementPage,
    animationType: 'slide',
    visibility: 'auth',
    icon: HomeWorkIcon,
    breadcrumbLabel: 'Room Management',
    navLabel: 'Rooms',
    navGroup: 'main',
    requiredPermissions: ['rooms:read', 'rooms:manage'],
    navPermissions: ['navigation_room_management:read', 'rooms:read', 'rooms:manage'],
  },
  {
    id: 'reports',
    path: '/reports',
    component: ModernReportsPage,
    animationType: 'grow',
    visibility: 'auth',
    icon: AssessmentIcon,
    breadcrumbLabel: 'Reports',
    navLabel: 'Reports',
    navGroup: 'operations',
    requiredPermissions: ['analytics:read', 'reports:execute'],
    navPermissions: ['analytics:read', 'reports:execute'],
  },
  {
    id: 'loyalty',
    path: '/loyalty',
    component: LoyaltyPortal,
    animationType: 'grow',
    visibility: 'auth',
    requiredPermissions: ['loyalty:read', 'loyalty:manage', 'analytics:read'],
  },
  {
    id: 'my-rewards',
    path: '/my-rewards',
    component: LoyaltyDashboard,
    animationType: 'grow',
    visibility: 'auth',
  },
  {
    id: 'profile',
    path: '/profile',
    component: UserProfilePage,
    animationType: 'fade',
    visibility: 'auth',
    icon: PersonIcon,
    breadcrumbLabel: 'My Profile',
  },
  {
    id: 'help',
    path: '/help',
    component: HelpSupportPage,
    animationType: 'fade',
    visibility: 'auth',
    icon: HelpOutlineIcon,
    breadcrumbLabel: 'Help & Support',
  },
  {
    id: 'ekyc',
    path: '/ekyc',
    component: EkycRegistrationPage,
    animationType: 'slide',
    visibility: 'auth',
  },
  {
    id: 'ekyc-admin',
    path: '/ekyc-admin',
    component: EkycManagementPage,
    animationType: 'slide',
    visibility: 'auth',
    icon: VerifiedUserIcon,
    breadcrumbLabel: 'eKYC Admin',
    navLabel: 'eKYC Admin',
    navGroup: 'admin',
    requiredPermissions: ['ekyc:manage'],
    navPermissions: ['ekyc:manage'],
  },
  {
    id: 'room-config',
    path: '/room-config',
    component: RoomConfigurationPage,
    animationType: 'fade',
    visibility: 'auth',
    icon: MeetingRoomIcon,
    breadcrumbLabel: 'Room Configuration',
    navLabel: 'Room Configuration',
    navGroup: 'config',
    requiredPermissions: ['rooms:update', 'rooms:write', 'rooms:manage'],
    navPermissions: ['navigation_room_config:read', 'rooms:update', 'rooms:write', 'rooms:manage'],
  },
  {
    id: 'settings',
    path: '/settings',
    component: SettingsPage,
    animationType: 'fade',
    visibility: 'auth',
    icon: SettingsIcon,
    breadcrumbLabel: 'Settings',
    navLabel: 'Settings',
    navGroup: 'config',
    requiredPermissions: ['settings:read'],
    navPermissions: ['navigation_settings:read', 'settings:read', 'settings:manage'],
  },
  {
    id: 'rbac',
    path: '/rbac',
    component: RBACManagementPage,
    animationType: 'fade',
    visibility: 'auth',
    icon: SecurityIcon,
    breadcrumbLabel: 'Access Control',
    navLabel: 'Access Control',
    navGroup: 'config',
    requiredPermissions: ['roles:read', 'roles:manage', 'permissions:read', 'permissions:manage', 'users:read', 'users:manage'],
    navPermissions: ['roles:read', 'roles:manage', 'permissions:read', 'permissions:manage', 'users:read', 'users:manage'],
  },
  {
    id: 'company-ledger',
    path: '/company-ledger',
    component: CustomerLedgerPage,
    animationType: 'slide',
    visibility: 'auth',
    icon: AccountBalanceIcon,
    breadcrumbLabel: 'Company Ledger',
    navLabel: 'Ledger',
    navGroup: 'operations',
    requiredPermissions: ['ledgers:read', 'ledgers:create', 'ledgers:update', 'ledgers:void', 'ledgers:manage'],
    navPermissions: ['ledgers:read', 'ledgers:create', 'ledgers:update', 'ledgers:void', 'ledgers:manage'],
  },
  {
    id: 'night-audit',
    path: '/night-audit',
    component: NightAuditPage,
    animationType: 'fade',
    visibility: 'auth',
    icon: NightsStayIcon,
    breadcrumbLabel: 'Night Audit',
    navLabel: 'Night Audit',
    navGroup: 'admin',
    requiredPermissions: ['night_audit:read', 'night_audit:execute'],
    navPermissions: ['night_audit:read', 'night_audit:execute'],
  },
  {
    id: 'audit-log',
    path: '/audit-log',
    component: AuditLogPage,
    animationType: 'fade',
    visibility: 'auth',
    icon: HistoryIcon,
    breadcrumbLabel: 'Audit Log',
    navLabel: 'Audit Log',
    navGroup: 'admin',
    requiredPermissions: ['audit:read'],
    navPermissions: ['audit:read'],
  },
  {
    id: 'complimentary',
    path: '/complimentary',
    component: ComplimentaryManagementPage,
    animationType: 'slide',
    visibility: 'auth',
    icon: CardGiftcardIcon,
    breadcrumbLabel: 'Complimentary Nights',
    navLabel: 'Complimentary Nights',
    navGroup: 'admin',
    navPermissions: ['bookings:read', 'bookings:update'],
    requiredPermissions: ['bookings:read', 'bookings:update'],
  },
  {
    id: 'data-transfer',
    path: '/data-transfer',
    component: DataTransferPage,
    animationType: 'fade',
    visibility: 'auth',
    icon: SyncAltIcon,
    breadcrumbLabel: 'Data Transfer',
    navLabel: 'Data Transfer',
    navGroup: 'admin',
    requiredPermissions: ['settings:manage'],
    navPermissions: ['settings:manage'],
  },
];

export const unauthRouteDefinitions = routeDefinitions.filter((route) => route.visibility === 'unauth');
export const authRouteDefinitions = routeDefinitions.filter((route) => route.visibility === 'auth');
export const navigationRouteDefinitions = authRouteDefinitions.filter((route) => route.navGroup);
export { FirstLoginPasskeyPrompt };

export function findRouteDefinition(pathname: string) {
  return routeDefinitions.find((route) => route.path === pathname);
}

export function preloadRoute(pathname: string) {
  findRouteDefinition(pathname)?.component.preload();
}

export function canAccessNavigationRoute(route: AppRouteDefinition, access: AccessChecker) {
  const isExcluded = route.navExcludeRoles?.some((role) => access.hasRole(role)) ?? false;
  if (isExcluded) {
    return false;
  }

  const permissions = route.navPermissions ?? [];
  const roles = route.navRoles ?? [];

  if (permissions.length === 0 && roles.length === 0) {
    return true;
  }

  return permissions.some((permission) => access.hasPermission(permission)) || roles.some((role) => access.hasRole(role));
}
