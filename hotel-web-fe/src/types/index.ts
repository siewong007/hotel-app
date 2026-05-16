// Types Barrel Export
// Re-exports all types for clean imports

// Common types
export type { SearchQuery, BookingValidation } from './common.types';

// Room types
export type {
  Room,
  RoomType,
  RoomTypeCreateInput,
  RoomTypeUpdateInput,
  RoomWithDisplay,
  RoomEvent,
  RoomEventInput,
  RoomStatusUpdateInput,
  RoomDetailedStatus,
  RoomHistory,
  RoomCurrentOccupancy,
  HotelOccupancySummary,
  OccupancyByRoomType,
  RoomWithOccupancy,
} from './room.types';

// Guest types
export type { Guest, GuestCreateRequest, GuestUpdateRequest, GuestType, TourismType } from './guest.types';
export { GUEST_TYPE_CONFIG, TOURISM_TYPE_CONFIG } from '../constants/guest.constants';

// Booking runtime constants and types
export { BookingStatus } from '../constants/booking.constants';
export type { BookingStatus as BookingStatusType } from '../constants/booking.constants';
export type {
  Booking,
  BookingWithDetails,
  BookingCreateRequest,
  BookingUpdateRequest,
  BookingCancellationRequest,
  BookingTimelineEntry,
  CheckInRequest,
  PreCheckInUpdateRequest,
  RateCodesResponse,
  MarketCodesResponse,
} from './booking.types';

// Company types
export type { Company, CompanyCreateRequest, CompanyUpdateRequest } from './company.types';

// Data transfer types
export type { BookingDataExport, ImportMode, ImportResult } from './dataTransfer.types';

// Night audit types
export type {
  RoomSnapshot,
  RevenueBreakdownItem,
  UnpostedBooking,
  JournalEntry,
  JournalSection,
  NightAuditPreview,
  NightAuditRun,
  NightAuditResponse,
  RunNightAuditRequest,
  BookingPostedStatus,
  PostedBookingDetail,
  AuditDetailsResponse,
} from './nightAudit.types';

// Auth types
export type {
  User,
  AuthResponse,
  UserProfile,
  UserProfileUpdate,
  PasswordUpdate,
  PasskeyInfo,
  PasskeyUpdateInput,
  TwoFactorSetupRequest,
  TwoFactorSetupResponse,
  TwoFactorEnableRequest,
  TwoFactorDisableRequest,
  TwoFactorVerifyRequest,
  TwoFactorStatusResponse,
  LoginWithTwoFactorRequest,
  RegenerateBackupCodesRequest,
} from './auth.types';

// RBAC types
export type {
  Role,
  Permission,
  RoleInput,
  PermissionInput,
  AssignRoleInput,
  AssignPermissionInput,
  RoleWithPermissions,
  UserWithRolesAndPermissions,
} from './rbac.types';

// Loyalty types
export type {
  LoyaltyProgram,
  LoyaltyMembership,
  PointsTransaction,
  LoyaltyMembershipWithDetails,
  LoyaltyStatistics,
  TierInfo,
  UserLoyaltyMembership,
  LoyaltyReward,
  RedeemRewardInput,
  RewardInput,
  RewardUpdateInput,
  RewardRedemption,
} from './loyalty.types';

// Payment types
export * from './payment.types';

// Ledger types
export type {
  FolioType,
  TransactionType,
  PostType,
  CustomerLedger,
  CustomerLedgerCreateRequest,
  CustomerLedgerUpdateRequest,
  CustomerLedgerPayment,
  CustomerLedgerPaymentRequest,
  CustomerLedgerWithPayments,
  CustomerLedgerSummary,
  LedgerVoidRequest,
  LedgerReversalRequest,
} from './ledger.types';
