import Foundation

// MARK: - Guest Model
struct Guest: Codable, Identifiable {
    let id: String
    var firstName: String
    var lastName: String
    var email: String
    var phoneNumber: String
    var dateOfBirth: Date?
    var nationality: String?
    var passportNumber: String?
    var idCardNumber: String?
    var isVerified: Bool
    var eKYCStatus: EKYCStatus
    var createdAt: Date
    var updatedAt: Date
    
    var fullName: String {
        "\(firstName) \(lastName)"
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

// MARK: - Room Model
struct Room: Codable, Identifiable {
    let id: String
    let hotelId: String
    var roomNumber: String
    var roomType: RoomType
    var description: String
    var amenities: [String]
    var pricePerNight: Decimal
    var maxOccupancy: Int
    var bedType: BedType
    var squareMeters: Double
    var images: [String] // URLs
    var isAvailable: Bool
    var floor: Int
}

enum RoomType: String, Codable {
    case standard = "standard"
    case deluxe = "deluxe"
    case suite = "suite"
    case presidential = "presidential"
    case familyRoom = "family_room"
}

enum BedType: String, Codable {
    case single = "single"
    case double = "double"
    case queen = "queen"
    case king = "king"
    case twin = "twin"
}

// MARK: - Booking Model
struct Booking: Codable, Identifiable {
    let id: String
    let guestId: String
    let roomId: String
    var checkInDate: Date
    var checkOutDate: Date
    var numberOfGuests: Int
    var totalAmount: Decimal
    var status: BookingStatus
    var specialRequests: String?
    var paymentStatus: PaymentStatus
    var createdAt: Date
    var updatedAt: Date
    
    // Computed properties
    var numberOfNights: Int {
        Calendar.current.dateComponents([.day], from: checkInDate, to: checkOutDate).day ?? 0
    }
}

enum BookingStatus: String, Codable {
    case pending = "pending"
    case confirmed = "confirmed"
    case checkedIn = "checked_in"
    case checkedOut = "checked_out"
    case cancelled = "cancelled"
}

enum PaymentStatus: String, Codable {
    case pending = "pending"
    case paid = "paid"
    case refunded = "refunded"
    case failed = "failed"
}

// MARK: - User Authentication Model
struct User: Codable {
    let id: String
    var email: String
    var hasPasskey: Bool
    var twoFactorEnabled: Bool
    var phoneNumber: String?
    var guest: Guest?
    var registeredAt: Date
}

// MARK: - Two-Factor Authentication
struct TwoFactorSetup: Codable {
    let secret: String
    let qrCodeURL: String
    let backupCodes: [String]
}

struct TwoFactorVerification: Codable {
    let code: String
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
}

// MARK: - eKYC Document
struct EKYCDocument: Codable {
    let id: String
    let guestId: String
    let documentType: DocumentType
    var frontImageURL: String?
    var backImageURL: String?
    var selfieImageURL: String?
    var status: EKYCStatus
    var verifiedAt: Date?
    var expiryDate: Date?
    var rejectionReason: String?
}

enum DocumentType: String, Codable {
    case passport = "passport"
    case nationalId = "national_id"
    case driverLicense = "driver_license"
}

// MARK: - API Response Models
struct AuthResponse: Codable {
    let token: String
    let refreshToken: String
    let user: User
    let expiresIn: Int
}

struct BookingResponse: Codable {
    let booking: Booking
    let room: Room
    let guest: Guest
}

struct AvailableRoomsResponse: Codable {
    let rooms: [Room]
    let checkInDate: Date
    let checkOutDate: Date
    let totalCount: Int
}

struct ErrorResponse: Codable {
    let error: String
    let message: String
    let code: Int
}
