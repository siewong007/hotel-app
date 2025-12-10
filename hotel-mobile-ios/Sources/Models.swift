import Foundation

// MARK: - User & Authentication Models

struct User: Codable, Identifiable {
    let id: String // UUID
    let username: String
    let email: String
    let full_name: String?
    let is_active: Bool
}

struct AuthResponse: Codable {
    let access_token: String
    let refresh_token: String
    let user: User
    let roles: [String]
    let permissions: [String]
    let is_first_login: Bool
}

struct LoginRequest: Codable {
    let username: String
    let password: String
}

// MARK: - Room Models

struct Room: Codable, Identifiable {
    let id: String // UUID
    let room_number: String
    let room_type: String
    let price_per_night: String // Decimal from backend
    let available: Bool
    let description: String?
    let max_occupancy: Int

    var displayPrice: String {
        if let price = Double(price_per_night) {
            return String(format: "$%.0f/night", price)
        }
        return "$\(price_per_night)/night"
    }

    var availabilityText: String {
        return available ? "Available" : "Booked"
    }
    
    var priceAsDouble: Double {
        return Double(price_per_night) ?? 0.0
    }
}

// MARK: - Guest Models

struct Guest: Codable, Identifiable {
    let id: String // UUID
    let name: String
    let email: String
    let phone: String?
    let address: String?
}

struct GuestRequest: Codable {
    let name: String
    let email: String
    let phone: String?
    let address: String?
}

// MARK: - Booking Models

struct Booking: Codable, Identifiable {
    let id: String // UUID
    let guest_id: String
    let room_id: String
    let check_in: String // Date string
    let check_out: String // Date string
    let total_price: String // Decimal
    let status: String

    var checkInDate: String {
        return String(check_in.prefix(10))
    }

    var checkOutDate: String {
        return String(check_out.prefix(10))
    }
}

struct BookingWithDetails: Codable, Identifiable {
    let id: String
    let guest_id: String
    let guest_name: String
    let guest_email: String
    let room_id: String
    let room_number: String
    let room_type: String
    let check_in: String
    let check_out: String
    let total_price: String
    let status: String
    
    var checkInDate: String {
        return String(check_in.prefix(10))
    }

    var checkOutDate: String {
        return String(check_out.prefix(10))
    }
}

struct BookingRequest: Codable {
    let guest_id: String // UUID
    let room_id: String // UUID
    let check_in: String
    let check_out: String
}

// MARK: - Search Query

struct SearchQuery: Codable {
    let room_type: String?
    let max_price: Double?
}

// MARK: - Personalized Report Models

struct PersonalizedReport: Codable {
    let reportScope: String
    let userRoles: [String]
    let period: String
    let summary: ReportSummary
    let recentBookings: [ReportBooking]
    let insights: [String]
    let generatedAt: String
}

struct ReportSummary: Codable {
    let totalRooms: Int
    let occupiedRooms: Int
    let occupancyRate: Double
    let totalBookings: Int
    let totalRevenue: Double
    let averageBookingValue: Double
}

struct ReportBooking: Codable, Identifiable {
    let id: Int
    let guest_name: String
    let room_number: String
    let room_type: String
    let check_in: String
    let check_out: String
    let total_price: String
    let status: String
}

// MARK: - Loyalty Models

struct LoyaltyProgram: Codable, Identifiable {
    let id: Int
    let name: String
    let description: String?
    let tier_level: Int
    let points_multiplier: Double
    let minimum_points_required: Int
    let is_active: Bool
}

struct LoyaltyMembership: Codable, Identifiable {
    let id: Int
    let guest_id: Int
    let program_id: Int
    let membership_number: String
    let points_balance: Int
    let lifetime_points: Int
    let tier_level: Int
    let status: String
    let enrolled_date: String
}

struct LoyaltyMembershipWithDetails: Codable, Identifiable {
    let id: Int
    let guest_id: Int
    let guest_name: String
    let guest_email: String
    let program_id: Int
    let program_name: String
    let program_description: String?
    let points_multiplier: Double
    let membership_number: String
    let points_balance: Int
    let lifetime_points: Int
    let tier_level: Int
    let status: String
    let enrolled_date: String
}

struct PointsTransaction: Codable, Identifiable {
    let id: String
    let membership_id: Int
    let transaction_type: String
    let points_amount: Int
    let balance_after: Int
    let description: String?
    let created_at: String
}

struct TierStatistics: Codable {
    let tier_level: Int
    let tier_name: String
    let count: Int
    let percentage: Double
}

struct TopMember: Codable {
    let guest_name: String
    let guest_email: String
    let points_balance: Int
    let lifetime_points: Int
    let tier_level: Int
    let membership_number: String
}

struct RecentTransaction: Codable, Identifiable {
    let id: String
    let guest_name: String
    let transaction_type: String
    let points_amount: Int
    let description: String?
    let created_at: String
}

struct MembershipGrowth: Codable {
    let date: String
    let new_members: Int
    let total_members: Int
}

struct PointsActivity: Codable {
    let date: String
    let points_earned: Int
    let points_redeemed: Int
}

struct LoyaltyStatistics: Codable {
    let total_members: Int
    let active_members: Int
    let members_by_tier: [TierStatistics]
    let total_points_issued: Int
    let total_points_redeemed: Int
    let total_points_active: Int
    let average_points_per_member: Double
    let top_members: [TopMember]
    let recent_transactions: [RecentTransaction]
    let membership_growth: [MembershipGrowth]
    let points_activity: [PointsActivity]
}

// MARK: - User Profile Models

struct UserProfile: Codable, Identifiable {
    let id: Int
    let username: String
    let email: String
    let full_name: String?
    let phone: String?
    let avatar_url: String?
    let created_at: String
    let updated_at: String
    let last_login_at: String?
}

struct UserProfileUpdate: Codable {
    let full_name: String?
    let email: String?
    let phone: String?
    let avatar_url: String?
}

struct PasswordUpdate: Codable {
    let current_password: String
    let new_password: String
}

struct PasskeyInfo: Codable, Identifiable {
    let id: Int
    let credential_id: String
    let device_name: String?
    let created_at: String
    let last_used_at: String?
}

struct PasskeyUpdateInput: Codable {
    let device_name: String
}

// MARK: - API Error

struct APIError: Error, Codable {
    let error: String
}
