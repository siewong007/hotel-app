// API Module - Barrel Export
// Re-exports all services and utilities for clean imports

// Core
export { api, APIError, API_BASE_URL, parseAPIError } from './client';

// Domain Services - re-export for direct imports
export { RoomsService } from './rooms.service';
export { GuestsService } from './guests.service';
export { BookingsService } from './bookings.service';
export { RatesService } from './rates.service';
export { InvoicesService } from './invoices.service';
export { AdminService } from './admin.service';
export { AuthService } from './auth.service';
export { AnalyticsService } from './analytics.service';
export { LoyaltyService } from './loyalty.service';
export { EkycService } from './ekyc.service';
export { LedgerService } from './ledger.service';
export { GuestPortalService } from './guestPortal.service';
export { ReportsService } from './reports.service';
export { CompaniesService } from './companies.service';
export { AuditService } from './audit.service';
export { NightAuditService } from './nightAudit.service';
export { DataTransferService } from './dataTransfer.service';
export { HousekeepingService } from './housekeeping.service';
export { MaintenanceService } from './maintenance.service';
export { PaymentApprovalsService } from './paymentApprovals.service';
export { UsersService } from './users.service';
export type { Company, CompanyCreateRequest, CompanyUpdateRequest } from '../types';
export type { BookingDataExport, ExportPreview, ImportResult } from '../types';
export type {
  NightAuditPreview,
  NightAuditRun,
  NightAuditListResponse,
  NightAuditResponse,
  UnpostedBooking,
  RoomSnapshot,
  BookingPostedStatus,
  PostedBookingDetail,
  AuditDetailsResponse,
  RevenueBreakdownItem,
  JournalEntry,
  JournalSection
} from '../types';
export type {
  GuestPaymentBankDetails,
  GuestPaymentConfig,
  PaymentActionResponse,
  PaypalCreateOrderResponse,
  PendingPaymentEntry,
  PendingPaymentPage,
} from '../types';
