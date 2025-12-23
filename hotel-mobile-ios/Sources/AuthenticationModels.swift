import Foundation

// MARK: - Extended Authentication Models for Passkey and eKYC

// MARK: - Enhanced Guest Model Extensions
extension Guest {
    var isVerified: Bool {
        // Determine verification status based on available data
        return email.contains("@") && phone != nil
    }
    
    var eKYCStatus: EKYCStatus {
        // This would be determined by backend - default implementation
        return .notStarted
    }
}

// MARK: - eKYC Status
enum EKYCStatus: String, Codable {
    case notStarted = "not_started"
    case pending = "pending"
    case verified = "verified"
    case rejected = "rejected"
    case expired = "expired"
}

// MARK: - eKYC Document
struct EKYCDocument: Codable, Identifiable {
    let id: String
    let guestId: Int
    let documentType: DocumentType
    var frontImageURL: String?
    var backImageURL: String?
    var selfieImageURL: String?
    var status: EKYCStatus
    var verifiedAt: Date?
    var expiryDate: Date?
    var rejectionReason: String?
    
    enum CodingKeys: String, CodingKey {
        case id
        case guestId = "guest_id"
        case documentType = "document_type"
        case frontImageURL = "front_image_url"
        case backImageURL = "back_image_url"
        case selfieImageURL = "selfie_image_url"
        case status
        case verifiedAt = "verified_at"
        case expiryDate = "expiry_date"
        case rejectionReason = "rejection_reason"
    }
}

enum DocumentType: String, Codable {
    case passport = "passport"
    case nationalId = "national_id"
    case driverLicense = "driver_license"
}

// MARK: - Passkey Models
struct PasskeyChallenge: Codable {
    let challenge: String
    let userId: String
    let timeout: Int
}

struct PasskeyCredential: Codable {
    let credentialId: String
    let publicKey: String
    let userId: String
    
    enum CodingKeys: String, CodingKey {
        case credentialId = "credential_id"
        case publicKey = "public_key"
        case userId = "user_id"
    }
}

// MARK: - Two-Factor Verification
struct TwoFactorVerification: Codable {
    let code: String
}

// MARK: - Enhanced User with Authentication Features
struct AuthenticatedUser: Codable {
    let user: User
    let hasPasskey: Bool
    let twoFactorEnabled: Bool
    let guest: Guest?
    
    enum CodingKeys: String, CodingKey {
        case user
        case hasPasskey = "has_passkey"
        case twoFactorEnabled = "two_factor_enabled"
        case guest
    }
}

// MARK: - Enhanced Login Response with Auth Features
struct EnhancedAuthResponse: Codable {
    let accessToken: String
    let refreshToken: String
    let user: User
    let guest: Guest?
    let hasPasskey: Bool
    let twoFactorEnabled: Bool
    let roles: [String]
    let permissions: [String]
    
    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case user, guest
        case hasPasskey = "has_passkey"
        case twoFactorEnabled = "two_factor_enabled"
        case roles, permissions
    }
}

// MARK: - Booking Extensions for New Features
extension BookingWithDetails {
    enum BookingStatus: String {
        case pending = "pending"
        case confirmed = "confirmed"
        case checkedIn = "checked_in"
        case checkedOut = "checked_out"
        case cancelled = "cancelled"
    }
    
    var bookingStatus: BookingStatus {
        return BookingStatus(rawValue: status.lowercased()) ?? .pending
    }
    
    enum PaymentStatus: String {
        case pending = "pending"
        case paid = "paid"
        case refunded = "refunded"
        case failed = "failed"
    }
    
    var paymentStatus: PaymentStatus {
        // This would come from backend - default implementation
        return .pending
    }
}

// MARK: - Room Extensions
extension Room {
    enum RoomType: String {
        case standard = "standard"
        case deluxe = "deluxe"
        case suite = "suite"
        case presidential = "presidential"
        case familyRoom = "family_room"
    }
    
    enum BedType: String {
        case single = "single"
        case double = "double"
        case queen = "queen"
        case king = "king"
        case twin = "twin"
    }
    
    var roomTypeEnum: RoomType {
        return RoomType(rawValue: roomType.lowercased()) ?? .standard
    }
    
    var amenities: [String] {
        // Parse from description or return default amenities
        return ["WiFi", "TV", "Air Conditioning", "Mini Bar"]
    }
    
    var images: [String] {
        // Return placeholder or actual image URLs
        return []
    }
    
    var bedType: BedType {
        // This would come from backend
        return .queen
    }
    
    var squareMeters: Double {
        // This would come from backend
        return 35.0
    }
    
    var floor: Int {
        // Parse from room number or return from backend
        if let firstDigit = roomNumber.first, let digit = Int(String(firstDigit)) {
            return digit
        }
        return 1
    }
    
    var hotelId: String {
        // This would come from backend
        return "hotel-1"
    }
}

// MARK: - Available Rooms Response
struct AvailableRoomsResponse: Codable {
    let rooms: [Room]
    let checkInDate: Date
    let checkOutDate: Date
    let totalCount: Int
    
    enum CodingKeys: String, CodingKey {
        case rooms
        case checkInDate = "check_in_date"
        case checkOutDate = "check_out_date"
        case totalCount = "total_count"
    }
}

// MARK: - Booking Response with Details
struct BookingResponse: Codable {
    let booking: BookingWithDetails
    let room: Room
    let guest: Guest
}

// MARK: - Error Response
struct ErrorResponse: Codable {
    let error: String
    let message: String
    let code: Int
}
