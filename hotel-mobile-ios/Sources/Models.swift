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

// MARK: - API Error

struct APIError: Error, Codable {
    let error: String
}
