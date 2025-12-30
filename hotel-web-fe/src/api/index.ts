// API Module - Barrel Export
// Re-exports all services and utilities for clean imports

// Import all services (required for HotelAPIService backward compatibility layer)
import { RoomsService } from './rooms.service';
import { GuestsService } from './guests.service';
import { BookingsService } from './bookings.service';
import { RatesService } from './rates.service';
import { InvoicesService } from './invoices.service';
import { AdminService } from './admin.service';
import { AuthService } from './auth.service';
import { AnalyticsService } from './analytics.service';
import { LoyaltyService } from './loyalty.service';
import { EkycService } from './ekyc.service';
import { LedgerService } from './ledger.service';
import { GuestPortalService } from './guestPortal.service';
import { ReportsService } from './reports.service';
import { CompaniesService } from './companies.service';

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
export { CompaniesService, type Company, type CompanyCreateRequest, type CompanyUpdateRequest } from './companies.service';

// Backward Compatibility Layer - HotelAPIService
// This class provides backward compatibility for existing code that imports HotelAPIService
// New code should import individual services directly

export class HotelAPIService {
  // Room operations
  static getAllRooms = RoomsService.getAllRooms;
  static searchRooms = RoomsService.searchRooms;
  static getAvailableRoomsForDates = RoomsService.getAvailableRoomsForDates;
  static updateRoom = RoomsService.updateRoom;
  static updateRoomStatus = RoomsService.updateRoomStatus;
  static endMaintenance = RoomsService.endMaintenance;
  static executeRoomChange = RoomsService.executeRoomChange;
  static createRoomEvent = RoomsService.createRoomEvent;
  static getRoomDetailedStatus = RoomsService.getRoomDetailedStatus;
  static getRoomHistory = RoomsService.getRoomHistory;
  static createRoom = RoomsService.createRoom;
  static deleteRoom = RoomsService.deleteRoom;
  static getRoomTypes = RoomsService.getRoomTypes;
  static getRoomReviews = RoomsService.getRoomReviews;
  static formatRoomForDisplay = RoomsService.formatRoomForDisplay;
  // Occupancy operations (automatic - derived from bookings)
  static getAllRoomOccupancy = RoomsService.getAllRoomOccupancy;
  static getRoomOccupancy = RoomsService.getRoomOccupancy;
  static getHotelOccupancySummary = RoomsService.getHotelOccupancySummary;
  static getOccupancyByRoomType = RoomsService.getOccupancyByRoomType;
  static getRoomsWithOccupancy = RoomsService.getRoomsWithOccupancy;

  // Guest operations
  static getAllGuests = GuestsService.getAllGuests;
  static getGuest = GuestsService.getGuest;
  static createGuest = GuestsService.createGuest;
  static updateGuest = GuestsService.updateGuest;
  static deleteGuest = GuestsService.deleteGuest;
  static getGuestBookings = GuestsService.getGuestBookings;
  static getMyGuests = GuestsService.getMyGuests;
  static getGuestCredits = GuestsService.getGuestCredits;
  static getMyGuestsWithCredits = GuestsService.getMyGuestsWithCredits;

  // Booking operations
  static getAllBookings = BookingsService.getAllBookings;
  static getMyBookings = BookingsService.getMyBookings;
  static createBooking = BookingsService.createBooking;
  static updateBooking = BookingsService.updateBooking;
  static checkInGuest = BookingsService.checkInGuest;
  static preCheckInUpdate = BookingsService.preCheckInUpdate;
  static cancelBooking = BookingsService.cancelBooking;
  static getBookingById = BookingsService.getBookingById;
  static getBookingsWithDetails = BookingsService.getBookingsWithDetails;
  static markBookingComplimentary = BookingsService.markBookingComplimentary;
  static convertComplimentaryToCredits = BookingsService.convertComplimentaryToCredits;
  static bookWithCredits = BookingsService.bookWithCredits;
  static getComplimentaryBookings = BookingsService.getComplimentaryBookings;
  static getComplimentarySummary = BookingsService.getComplimentarySummary;
  static updateComplimentary = BookingsService.updateComplimentary;
  static removeComplimentary = BookingsService.removeComplimentary;
  static getGuestsWithCredits = BookingsService.getGuestsWithCredits;

  // Rate operations
  static getRateCodes = RatesService.getRateCodes;
  static getMarketCodes = RatesService.getMarketCodes;

  // Invoice operations
  static getInvoicePreview = InvoicesService.getInvoicePreview;
  static generateInvoice = InvoicesService.generateInvoice;
  static getUserInvoices = InvoicesService.getUserInvoices;

  // RBAC operations
  static getAllRoles = AdminService.getAllRoles;
  static createRole = AdminService.createRole;
  static updateRole = AdminService.updateRole;
  static deleteRole = AdminService.deleteRole;
  static getAllPermissions = AdminService.getAllPermissions;
  static createPermission = AdminService.createPermission;
  static updatePermission = AdminService.updatePermission;
  static deletePermission = AdminService.deletePermission;
  static assignRoleToUser = AdminService.assignRoleToUser;
  static removeRoleFromUser = AdminService.removeRoleFromUser;
  static assignPermissionToRole = AdminService.assignPermissionToRole;
  static removePermissionFromRole = AdminService.removePermissionFromRole;
  static getRolePermissions = AdminService.getRolePermissions;
  static getAllUsers = AdminService.getAllUsers;
  static createUser = AdminService.createUser;
  static getUserRolesAndPermissions = AdminService.getUserRolesAndPermissions;

  // System settings
  static getSystemSettings = AdminService.getSystemSettings;
  static updateSystemSetting = AdminService.updateSystemSetting;

  // Auth operations
  static register = AuthService.register;
  static verifyEmail = AuthService.verifyEmail;
  static getHealth = AuthService.getHealth;
  static getWebSocketStatus = AuthService.getWebSocketStatus;
  static getUserProfile = AuthService.getUserProfile;
  static updateUserProfile = AuthService.updateUserProfile;
  static updatePassword = AuthService.updatePassword;
  static listPasskeys = AuthService.listPasskeys;
  static updatePasskey = AuthService.updatePasskey;
  static deletePasskey = AuthService.deletePasskey;
  static setupTwoFactor = AuthService.setupTwoFactor;
  static enableTwoFactor = AuthService.enableTwoFactor;
  static disableTwoFactor = AuthService.disableTwoFactor;
  static getTwoFactorStatus = AuthService.getTwoFactorStatus;
  static regenerateBackupCodes = AuthService.regenerateBackupCodes;

  // Analytics operations
  static getOccupancyReport = AnalyticsService.getOccupancyReport;
  static getBookingAnalytics = AnalyticsService.getBookingAnalytics;
  static getBenchmarkReport = AnalyticsService.getBenchmarkReport;
  static getPersonalizedReport = AnalyticsService.getPersonalizedReport;

  // Loyalty operations
  static getAllLoyaltyPrograms = LoyaltyService.getAllLoyaltyPrograms;
  static getAllLoyaltyMemberships = LoyaltyService.getAllLoyaltyMemberships;
  static getLoyaltyMembershipsByGuest = LoyaltyService.getLoyaltyMembershipsByGuest;
  static getPointsTransactions = LoyaltyService.getPointsTransactions;
  static getLoyaltyStatistics = LoyaltyService.getLoyaltyStatistics;
  static addPointsToMembership = LoyaltyService.addPointsToMembership;
  static redeemPoints = LoyaltyService.redeemPoints;
  static getUserLoyaltyMembership = LoyaltyService.getUserLoyaltyMembership;
  static getLoyaltyRewards = LoyaltyService.getLoyaltyRewards;
  static redeemReward = LoyaltyService.redeemReward;
  static getRewards = LoyaltyService.getRewards;
  static getReward = LoyaltyService.getReward;
  static createReward = LoyaltyService.createReward;
  static updateReward = LoyaltyService.updateReward;
  static deleteReward = LoyaltyService.deleteReward;
  static getRewardRedemptions = LoyaltyService.getRewardRedemptions;

  // eKYC operations
  static getEkycStatus = EkycService.getEkycStatus;
  static submitEkycVerification = EkycService.submitEkycVerification;
  static getEkycVerificationDetails = EkycService.getEkycVerificationDetails;
  static getAllEkycVerifications = EkycService.getAllEkycVerifications;
  static updateEkycVerification = EkycService.updateEkycVerification;
  static approveEkycVerification = EkycService.approveEkycVerification;
  static rejectEkycVerification = EkycService.rejectEkycVerification;
  static uploadEkycDocument = EkycService.uploadEkycDocument;

  // Ledger operations (including PAT-style)
  static getCustomerLedgers = LedgerService.getCustomerLedgers;
  static getCustomerLedger = LedgerService.getCustomerLedger;
  static getCustomerLedgerWithPayments = LedgerService.getCustomerLedgerWithPayments;
  static createCustomerLedger = LedgerService.createCustomerLedger;
  static updateCustomerLedger = LedgerService.updateCustomerLedger;
  static deleteCustomerLedger = LedgerService.deleteCustomerLedger;
  static getCustomerLedgerSummary = LedgerService.getCustomerLedgerSummary;
  static getLedgerPayments = LedgerService.getLedgerPayments;
  static createLedgerPayment = LedgerService.createLedgerPayment;
  static getTransactionCodes = LedgerService.getTransactionCodes;
  static getDepartmentCodes = LedgerService.getDepartmentCodes;
  static voidLedger = LedgerService.voidLedger;
  static reverseLedger = LedgerService.reverseLedger;

  // Guest Portal operations
  static guestPortalVerify = GuestPortalService.verify;
  static guestPortalGetBooking = GuestPortalService.getBooking;
  static guestPortalSubmitPreCheckin = GuestPortalService.submitPreCheckin;

  // Reports operations
  static generateReport = ReportsService.generateReport;
  static downloadReportPDF = ReportsService.downloadReportPDF;

  // Company operations
  static getCompanies = CompaniesService.getCompanies;
  static getCompany = CompaniesService.getCompany;
  static createCompany = CompaniesService.createCompany;
  static updateCompany = CompaniesService.updateCompany;
  static deleteCompany = CompaniesService.deleteCompany;
}

// Default export for backward compatibility
export default HotelAPIService;
