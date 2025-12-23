//
//  ConsolidatedModels.swift
//  HotelMobileIOS
//
//  Consolidated model definitions that work with existing DataModels.swift
//  This file resolves all ambiguous type lookups
//

import Foundation

// MARK: - Type Aliases to Resolve Ambiguity
// Use existing models from DataModels.swift as primary types

// These ensure we use the DataModels.swift versions
typealias AppUser = User
typealias AppGuest = Guest
typealias AppRoom = Room
typealias AppBooking = BookingWithDetails
typealias AppLoginResponse = LoginResponse

// MARK: - Additional Helper Extensions

extension User {
    var hasPasskey: Bool {
        // This would come from backend or user defaults
        get {
            return UserDefaults.standard.bool(forKey: "user_\(id)_hasPasskey")
        }
    }
    
    var twoFactorEnabled: Bool {
        get {
            return UserDefaults.standard.bool(forKey: "user_\(id)_2fa_enabled")
        }
    }
}

extension Guest {
    var fullAddress: String {
        var components: [String] = []
        if let address = addressLine1 { components.append(address) }
        if let city = city { components.append(city) }
        if let state = stateProvince { components.append(state) }
        if let postal = postalCode { components.append(postal) }
        if let country = country { components.append(country) }
        return components.joined(separator: ", ")
    }
}

extension Room {
    var formattedPrice: String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        return formatter.string(from: NSDecimalNumber(decimal: pricePerNight)) ?? "$\(pricePerNight)"
    }
    
    var isAvailable: Bool {
        return available
    }
}

extension BookingWithDetails {
    var numberOfNights: Int {
        return Calendar.current.dateComponents([.day], from: checkInDate, to: checkOutDate).day ?? 0
    }
    
    var isPending: Bool {
        return status.lowercased() == "pending"
    }
    
    var isConfirmed: Bool {
        return status.lowercased() == "confirmed"
    }
    
    var isCancelled: Bool {
        return status.lowercased() == "cancelled"
    }
}

// MARK: - Network Response Wrappers

struct RoomsListResponse: Codable {
    let rooms: [Room]
    let total: Int
    
    enum CodingKeys: String, CodingKey {
        case rooms
        case total
    }
}

struct BookingsListResponse: Codable {
    let bookings: [BookingWithDetails]
    let total: Int
    
    enum CodingKeys: String, CodingKey {
        case bookings
        case total
    }
}

struct GuestResponse: Codable {
    let guest: Guest
}

struct MessageResponse: Codable {
    let message: String
    let success: Bool
}

// MARK: - Error Extensions

extension APIError {
    var userFriendlyMessage: String {
        switch self {
        case .invalidResponse:
            return "We're having trouble connecting to the server. Please try again."
        case .unauthorized:
            return "Your session has expired. Please log in again."
        case .forbidden:
            return "You don't have permission to perform this action."
        case .notFound:
            return "The requested information could not be found."
        case .serverError(_, let message):
            return message.isEmpty ? "A server error occurred. Please try again later." : message
        case .decodingError(let details):
            return "We're having trouble processing the server response: \(details)"
        case .networkError(let details):
            return "Network connection issue: \(details)"
        }
    }
}

// MARK: - Date Formatting Helpers

extension Date {
    var shortDateString: String {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .none
        return formatter.string(from: self)
    }
    
    var mediumDateString: String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: self)
    }
    
    var dateTimeString: String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: self)
    }
}

// MARK: - Decimal Formatting Helpers

extension Decimal {
    var currencyString: String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        return formatter.string(from: NSDecimalNumber(decimal: self)) ?? "$\(self)"
    }
}
