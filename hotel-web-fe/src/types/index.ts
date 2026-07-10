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
export type {
  Guest,
  GuestCreateRequest,
  GuestDuplicateCandidate,
  GuestProfile,
  GuestProfileBooking,
  GuestSummary,
  GuestTourismConversionResponse,
  GuestTourismConversionSource,
  GuestUpdateRequest,
  GuestType,
  TourismType,
} from './guest.types';
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
  BookingVoidResponse,
  BookingTimelineEntry,
  CheckInRequest,
  CheckInAdvisory,
  PreCheckInUpdateRequest,
  RateCodesResponse,
  MarketCodesResponse,
} from './booking.types';

// Company types
export type { Company, CompanyCreateRequest, CompanyUpdateRequest } from './company.types';

// Data transfer types
export type { BookingDataExport, ExportPreview, ImportMode, ImportResult } from './dataTransfer.types';

// Housekeeping types
export type {
  CreateHousekeepingTaskRequest,
  HousekeepingBoardResponse,
  HousekeepingBoardRoom,
  HousekeepingPriority,
  HousekeepingTask,
  HousekeepingTaskListResponse,
  HousekeepingTaskStatus,
  ListHousekeepingTasksQuery,
  UpdateHousekeepingTaskRequest,
} from './housekeeping.types';

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
  AccessSnapshot,
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
  RolePermissionIdsInput,
  UserRoleIdsInput,
  RolePermissionAssignment,
  UserRoleAssignment,
  RbacSnapshot,
  RoleWithPermissions,
  UserWithRolesAndPermissions,
  RouteAccessPolicy,
  RouteAccessPolicyInput,
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

// Loyalty admin types (live `modules::loyalty` backend contract)
export type {
  LoyaltyMemberStatus,
  LoyaltyRedemptionStatus,
  TierQualificationMetric,
  LoyaltyTier,
  LoyaltyProgramRules,
  LoyaltyRulesInput,
  LoyaltyMemberSummary,
  TierProgress,
  LoyaltyTransaction,
  AdminLoyaltyReward,
  LoyaltyRedemption,
  LoyaltyMemberDetail,
  ManualAdjustmentInput,
  AdminRewardInput,
  AdminRewardUpdateInput,
  RejectRedemptionInput,
  LoyaltyMemberQueryParams,
  LoyaltyRewardQueryParams,
  LoyaltyRedemptionQueryParams,
} from './loyaltyAdmin.types';

// Payment types
export * from './payment.types';

// Guest portal (customer self-service) types
export type {
  GuestPortalGuest,
  GuestPortalLoginRequest,
  GuestPortalLoginResponse,
  GuestPortalMeResponse,
  GuestPortalBookingSummary,
  GuestPortalPagedResponse,
  GuestPortalTransactionKind,
  GuestPortalTransaction,
  GuestPortalMembership,
  GuestPortalMembershipActivity,
  GuestPortalMembershipResponse,
  GuestPortalTierBenefit,
  GuestPortalReward,
  GuestPortalBenefitsResponse,
} from './guestPortal.types';

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
