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
export type { Guest, GuestCreateRequest, GuestUpdateRequest, GuestType } from './guest.types';
export { GUEST_TYPE_CONFIG } from './guest.types';

// Booking types - Note: BookingStatus is an enum, not just a type
export { BookingStatus } from './booking.types';
export type {
  Booking,
  BookingWithDetails,
  BookingCreateRequest,
  BookingUpdateRequest,
  BookingCancellationRequest,
  CheckInRequest,
  PreCheckInUpdateRequest,
  RateCodesResponse,
  MarketCodesResponse,
} from './booking.types';

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

// Ledger types (including PAT-style)
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
  PatTransactionCode,
  PatDepartmentCode,
  LedgerVoidRequest,
  LedgerReversalRequest,
} from './ledger.types';
