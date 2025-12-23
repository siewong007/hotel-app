//
//  DataModels.swift
//  HotelMobileIOS
//
//  Created by Cline on 2025
//
//  Updated integration models to match API documentation
//  All models now use exact field names and types from the backend API specification
//

import Foundation

// MARK: - Core Data Models (Exact match to API documentation)

// User Authentication Models
struct User: Codable, Identifiable {
    let id: Int
    let username: String
    let email: String
    let fullName: String?
    let isActive: Bool
    let isVerified: Bool
    let createdAt: Date
    let updatedAt: Date
    let lastLoginAt: Date?

    var displayName: String {
        return fullName ?? username
    }

    enum CodingKeys: String, CodingKey {
        case id, username, email
        case fullName = "full_name"
        case isActive = "is_active"
        case isVerified = "is_verified"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case lastLoginAt = "last_login_at"
    }
}

struct LoginResponse: Codable {
    let accessToken: String
    let refreshToken: String
    let user: User
    let roles: [String]
    let permissions: [String]
    let isFirstLogin: Bool

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case user, roles, permissions
        case isFirstLogin = "is_first_login"
    }
}

struct RefreshResponse: Codable {
    let accessToken: String
    let refreshToken: String

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
    }
}

struct LoginRequest: Codable {
    let username: String
    let password: String
    let totpCode: String?

    enum CodingKeys: String, CodingKey {
        case username, password
        case totpCode = "totp_code"
    }
}

// Room Models
struct Room: Codable, Identifiable {
    let id: Int
    let roomNumber: String
    let roomType: String
    let pricePerNight: Decimal
    let available: Bool
    let description: String?
    let maxOccupancy: Int
    let createdAt: Date?
    let updatedAt: Date?
    let averageRating: Double?
    let reviewCount: Int?

    var displayPrice: String {
        return "$\(pricePerNight)/night"
    }

    var availabilityText: String {
        return available ? "Available" : "Booked"
    }

    enum CodingKeys: String, CodingKey {
        case id
        case roomNumber = "room_number"
        case roomType = "room_type"
        case pricePerNight = "price_per_night"
        case available, description
        case maxOccupancy = "max_occupancy"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case averageRating = "average_rating"
        case reviewCount = "review_count"
    }
}

// Guest Models
struct Guest: Codable, Identifiable {
    let id: Int
    let firstName: String?
    let lastName: String?
    let fullName: String? // Some responses may include this
    let email: String
    let phone: String?
    let altPhone: String?
    let title: String?
    let nationality: String?
    let icNumber: String?
    let addressLine1: String?
    let city: String?
    let stateProvince: String?
    let postalCode: String?
    let country: String?
    let createdAt: String?
    let updatedAt: String?

    var displayName: String {
        if let fullName = fullName {
            return fullName
        }
        if let firstName = firstName, let lastName = lastName {
            return "\(firstName) \(lastName)"
        }
        return email
    }

    enum CodingKeys: String, CodingKey {
        case id, email, phone, city, country
        case firstName = "first_name"
        case lastName = "last_name"
        case fullName = "full_name"
        case altPhone = "alt_phone"
        case title
        case nationality
        case icNumber = "ic_number"
        case addressLine1 = "address_line1"
        case stateProvince = "state_province"
        case postalCode = "postal_code"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

struct GuestRequest: Codable {
    let firstName: String
    let lastName: String
    let email: String
    let phone: String?
    let addressLine1: String?
    let city: String?
    let stateProvince: String?
    let postalCode: String?
    let country: String?

    enum CodingKeys: String, CodingKey {
        case email, phone, city, country
        case firstName = "first_name"
        case lastName = "last_name"
        case addressLine1 = "address_line1"
        case stateProvince = "state_province"
        case postalCode = "postal_code"
    }
}

// Booking Models
struct BookingWithDetails: Codable, Identifiable {
    let id: Int
    let guestId: Int
    let guestName: String
    let guestEmail: String
    let roomId: Int
    let roomNumber: String
    let roomType: String
    let checkInDate: Date
    let checkOutDate: Date
    let totalAmount: Decimal
    let status: String
    let folioNumber: String?
    let postType: String?
    let rateCode: String?
    let marketCode: String?
    let discountPercentage: Decimal?
    let rateOverrideWeekday: Decimal?
    let rateOverrideWeekend: Decimal?
    let checkInTime: String?
    let checkOutTime: String?
    let numberOfGuests: Int?
    let specialRequests: String?
    let preCheckinCompleted: Bool?
    let preCheckinCompletedAt: Date?
    let createdAt: Date

    var dateRange: String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        return "\(formatter.string(from: checkInDate)) - \(formatter.string(from: checkOutDate))"
    }

    var totalAmountString: String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        return formatter.string(from: NSDecimalNumber(decimal: totalAmount)) ?? "$\(totalAmount)"
    }

    enum CodingKeys: String, CodingKey {
        case id
        case guestId = "guest_id"
        case guestName = "guest_name"
        case guestEmail = "guest_email"
        case roomId = "room_id"
        case roomNumber = "room_number"
        case roomType = "room_type"
        case checkInDate = "check_in_date"
        case checkOutDate = "check_out_date"
        case totalAmount = "total_amount"
        case status
        case folioNumber = "folio_number"
        case postType = "post_type"
        case rateCode = "rate_code"
        case marketCode = "market_code"
        case discountPercentage = "discount_percentage"
        case rateOverrideWeekday = "rate_override_weekday"
        case rateOverrideWeekend = "rate_override_weekend"
        case checkInTime = "check_in_time"
        case checkOutTime = "check_out_time"
        case numberOfGuests = "number_of_guests"
        case specialRequests = "special_requests"
        case preCheckinCompleted = "pre_checkin_completed"
        case preCheckinCompletedAt = "pre_checkin_completed_at"
        case createdAt = "created_at"
    }
}

struct BookingRequest: Codable {
    let guestId: Int
    let roomId: Int
    let checkInDate: String
    let checkOutDate: String
    let postType: String?
    let rateCode: String?

    enum CodingKeys: String, CodingKey {
        case guestId = "guest_id"
        case roomId = "room_id"
        case checkInDate = "check_in_date"
        case checkOutDate = "check_out_date"
        case postType = "post_type"
        case rateCode = "rate_code"
    }
}

// User Profile Models
struct UserProfile: Codable, Identifiable {
    let id: Int
    let username: String
    let email: String
    let fullName: String?
    let phone: String?
    let avatarUrl: String?
    let createdAt: Date
    let updatedAt: Date
    let lastLoginAt: Date?

    var displayName: String {
        return fullName ?? username
    }

    enum CodingKeys: String, CodingKey {
        case id, username, email
        case fullName = "full_name"
        case phone
        case avatarUrl = "avatar_url"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case lastLoginAt = "last_login_at"
    }
}

struct UserProfileUpdate: Codable {
    let fullName: String?
    let email: String?
    let phone: String?
    let avatarUrl: String?

    enum CodingKeys: String, CodingKey {
        case fullName = "full_name"
        case email, phone
        case avatarUrl = "avatar_url"
    }
}

struct PasswordUpdate: Codable {
    let currentPassword: String
    let newPassword: String

    enum CodingKeys: String, CodingKey {
        case currentPassword = "current_password"
        case newPassword = "new_password"
    }
}

// Loyalty Program Models
struct LoyaltyMembership: Codable, Identifiable {
    let id: Int
    let membershipNumber: String
    let pointsBalance: Int
    let lifetimePoints: Int
    let tierLevel: Int
    let tierName: String
    let status: String
    let enrolledDate: Date?
    let expiryDate: Date?
    let nextTier: LoyaltyTierInfo?
    let currentTierBenefits: [String]
    let pointsToNextTier: Int?

    var pointsToNextTierDisplay: String {
        if let points = pointsToNextTier, points > 0 {
            return "\(points) points to next tier"
        }
        return "Max tier reached"
    }

    enum CodingKeys: String, CodingKey {
        case id
        case membershipNumber = "membership_number"
        case pointsBalance = "points_balance"
        case lifetimePoints = "lifetime_points"
        case tierLevel = "tier_level"
        case tierName = "tier_name"
        case status
        case enrolledDate = "enrolled_date"
        case expiryDate = "expiry_date"
        case nextTier = "next_tier"
        case currentTierBenefits = "current_tier_benefits"
        case pointsToNextTier = "points_to_next_tier"
    }
}

struct LoyaltyTierInfo: Codable {
    let tierLevel: Int
    let tierName: String
    let minimumPoints: Int
    let benefits: [String]
    let monetaryValue: Decimal?
    let pointsMultiplier: Double?

    enum CodingKeys: String, CodingKey {
        case tierLevel = "tier_level"
        case tierName = "tier_name"
        case minimumPoints = "minimum_points"
        case benefits
        case monetaryValue = "monetary_value"
        case pointsMultiplier = "points_multiplier"
    }
}

struct LoyaltyReward: Codable, Identifiable {
    let id: Int
    let name: String
    let description: String
    let category: String
    let pointsCost: Int
    let monetaryValue: Decimal
    let minimumTierLevel: Int
    let isActive: Bool
    let stockQuantity: Int?
    let imageUrl: String?
    let termsConditions: String?
    let createdAt: Date
    let updatedAt: Date

    var canRedeem: Bool {
        return isActive && (stockQuantity ?? 1) > 0
    }

    enum CodingKeys: String, CodingKey {
        case id, name, description, category
        case pointsCost = "points_cost"
        case monetaryValue = "monetary_value"
        case minimumTierLevel = "minimum_tier_level"
        case isActive = "is_active"
        case stockQuantity = "stock_quantity"
        case imageUrl = "image_url"
        case termsConditions = "terms_conditions"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

struct PointsTransaction: Codable, Identifiable {
    let id: String
    let membershipId: Int
    let transactionType: String
    let pointsAmount: Int
    let balanceAfter: Int
    let referenceType: String?
    let referenceId: String?
    let description: String?
    let createdAt: Date

    var isEarned: Bool {
        return transactionType == "earn"
    }

    var isRedeemed: Bool {
        return transactionType == "redeem"
    }

    enum CodingKeys: String, CodingKey {
        case id
        case membershipId = "membership_id"
        case transactionType = "transaction_type"
        case pointsAmount = "points_amount"
        case balanceAfter = "balance_after"
        case referenceType = "reference_type"
        case referenceId = "reference_id"
        case description
        case createdAt = "created_at"
    }
}

struct RewardRedemption: Codable {
    let rewardId: Int
    let bookingId: Int?
    let notes: String?

    enum CodingKeys: String, CodingKey {
        case rewardId = "reward_id"
        case bookingId = "booking_id"
        case notes
    }
}

// Passkey Models
struct PasskeyInfo: Codable, Identifiable {
    let id: String
    let credentialId: String
    let deviceName: String?
    let createdAt: Date
    let lastUsedAt: Date?

    var timeSinceLastUsed: String? {
        guard let lastUsed = lastUsedAt else { return nil }
        let formatter = RelativeDateTimeFormatter()
        return formatter.localizedString(for: lastUsed, relativeTo: Date())
    }

    enum CodingKeys: String, CodingKey {
        case id
        case credentialId = "credential_id"
        case deviceName = "device_name"
        case createdAt = "created_at"
        case lastUsedAt = "last_used_at"
    }
}

struct PasskeyRegistrationStart: Codable {
    let challenge: String
    let rp: RelyingParty
    let user: WebAuthnUser

    struct RelyingParty: Codable {
        let name: String
        let id: String
    }

    struct WebAuthnUser: Codable {
        let id: String
        let name: String
        let displayName: String

        enum CodingKeys: String, CodingKey {
            case id, name
            case displayName = "displayName"
        }
    }
}

struct PasskeyRegistrationComplete: Codable {
    let id: String
    let rawId: String
    let type: String
    let response: AuthenticatorResponse

    struct AuthenticatorResponse: Codable {
        let clientDataJSON: String
        let attestationObject: String

        enum CodingKeys: String, CodingKey {
            case clientDataJSON = "clientDataJSON"
            case attestationObject = "attestationObject"
        }
    }
}

// Analytics Models
struct OccupancyReport: Codable {
    let totalRooms: Int
    let occupiedRooms: Int
    let occupancyRate: Double
    let availableRooms: Int
    let utilization: Double
    let revenue: Decimal

    enum CodingKeys: String, CodingKey {
        case totalRooms, occupiedRooms, occupancyRate, availableRooms, utilization, revenue
    }
}

struct BookingAnalytics: Codable {
    let totalBookings: Int
    let averageBookingValue: Decimal
    let totalRevenue: Decimal
    let bookingsByRoomType: [String: Int]
    let peakBookingHours: [Int]
    let monthlyTrends: [MonthlyBookingTrend]

    enum CodingKeys: String, CodingKey {
        case totalBookings, averageBookingValue, totalRevenue, bookingsByRoomType, peakBookingHours, monthlyTrends
    }
}

struct MonthlyBookingTrend: Codable {
    let month: String
    let bookings: Int
    let revenue: Decimal
}

// Two-Factor Authentication Models
struct TwoFactorSetup: Codable {
    let secret: String
    let qrCodeUrl: String
    let backupCodes: [String]
    let challengeCode: String

    enum CodingKeys: String, CodingKey {
        case secret
        case qrCodeUrl = "qr_code_url"
        case backupCodes = "backup_codes"
        case challengeCode = "challenge_code"
    }
}

struct TwoFactorStatus: Codable {
    let enabled: Bool
    let backupCodesRemaining: Int

    enum CodingKeys: String, CodingKey {
        case enabled
        case backupCodesRemaining = "backup_codes_remaining"
    }
}

// API Error Models
struct APIErrorResponse: Codable {
    let error: String
    let message: String
}

enum APIError: Error {
    case invalidResponse
    case unauthorized
    case forbidden
    case notFound
    case serverError(String, String)
    case decodingError(String)
    case networkError(String)

    var localizedDescription: String {
        switch self {
        case .invalidResponse:
            return "Invalid response from server"
        case .unauthorized:
            return "Authentication required. Please log in again."
        case .forbidden:
            return "You don't have permission to perform this action"
        case .notFound:
            return "The requested resource was not found"
        case .serverError(let error, let message):
            return message.isEmpty ? error : message
        case .decodingError(let message):
            return "Data parsing error: \(message)"
        case .networkError(let message):
            return "Network error: \(message)"
        }
    }
}

// Request/Response convenience types
typealias EmptyResponse = [String: String]
typealias AuthResponse = LoginResponse // Alias for compatibility
typealias Booking = BookingWithDetails // Alias for compatibility

// Missing Loyalty types
struct LoyaltyProgram: Codable, Identifiable {
    let id: Int
    let name: String
    let description: String?
}

struct LoyaltyMembershipWithDetails: Codable, Identifiable {
    let id: Int
    let userId: Int
    let programId: Int
    let points: Int
    let tier: String
}

struct LoyaltyStatistics: Codable {
    let totalMembers: Int
    let activeMembers: Int
    let totalPointsIssued: Int
    let totalPointsRedeemed: Int
    let membersByTier: [TierStatistics]
    let topMembers: [TopMember]
    let recentTransactions: [RecentTransaction]

    enum CodingKeys: String, CodingKey {
        case totalMembers = "total_members"
        case activeMembers = "active_members"
        case totalPointsIssued = "total_points_issued"
        case totalPointsRedeemed = "total_points_redeemed"
        case membersByTier = "members_by_tier"
        case topMembers = "top_members"
        case recentTransactions = "recent_transactions"
    }
}

struct TierStatistics: Codable {
    let tierName: String
    let tierLevel: Int
    let count: Int
    let percentage: Double

    enum CodingKeys: String, CodingKey {
        case tierName = "tier_name"
        case tierLevel = "tier_level"
        case count
        case percentage
    }
}

struct TopMember: Codable {
    let userId: Int
    let guestName: String
    let guestEmail: String
    let lifetimePoints: Int
    let tier: String

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case guestName = "guest_name"
        case guestEmail = "guest_email"
        case lifetimePoints = "lifetime_points"
        case tier
    }
}

struct RecentTransaction: Codable, Identifiable {
    let id: Int
    let userId: Int
    let guestName: String
    let transactionType: String
    let pointsAmount: Int
    let description: String?
    let timestamp: String

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case guestName = "guest_name"
        case transactionType = "transaction_type"
        case pointsAmount = "points_amount"
        case description
        case timestamp
    }
}

struct PersonalizedReport: Codable, Identifiable {
    let id: Int
    let userId: Int
    let title: String
    let description: String
    let reportScope: String
    let userRoles: [String]
    let summary: ReportSummary
    let insights: [String]
    let bookings: [ReportBooking]
    let recentBookings: [ReportBooking]
    let generatedAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case title
        case description
        case reportScope = "report_scope"
        case userRoles = "user_roles"
        case summary
        case insights
        case bookings
        case recentBookings = "recent_bookings"
        case generatedAt = "generated_at"
    }
}

struct ReportSummary: Codable {
    let totalBookings: Int
    let totalRevenue: Double
    let averageValue: Double
    let averageBookingValue: Double
    let occupancyRate: Double
    let topRoomType: String?

    enum CodingKeys: String, CodingKey {
        case totalBookings = "total_bookings"
        case totalRevenue = "total_revenue"
        case averageValue = "average_value"
        case averageBookingValue = "average_booking_value"
        case occupancyRate = "occupancy_rate"
        case topRoomType = "top_room_type"
    }
}

struct ReportBooking: Codable, Identifiable {
    let id: Int
    let guestName: String
    let roomNumber: String
    let roomType: String
    let checkIn: String
    let checkOut: String
    let totalCost: Double

    enum CodingKeys: String, CodingKey {
        case id
        case guestName = "guest_name"
        case roomNumber = "room_number"
        case roomType = "room_type"
        case checkIn = "check_in"
        case checkOut = "check_out"
        case totalCost = "total_cost"
    }
}
