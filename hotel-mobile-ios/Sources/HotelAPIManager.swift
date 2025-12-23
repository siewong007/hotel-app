import Foundation

/// Enhanced API Manager for Hotel Booking with Auth Features
/// Works with existing DataModels.swift and adds new authentication endpoints
class HotelAPIManager {
    static let shared = HotelAPIManager()
    
    private let baseURL = "https://api.hotelapp.com/v1"
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder
    
    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 300
        self.session = URLSession(configuration: config)
        
        self.decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        
        self.encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.keyEncodingStrategy = .convertToSnakeCase
    }
    
    // MARK: - Authentication APIs
    func login(request: LoginRequest) async throws -> LoginResponse {
        let endpoint = "/auth/login"
        return try await post(endpoint: endpoint, body: request)
    }
    
    func refreshToken(refreshToken: String) async throws -> RefreshResponse {
        let endpoint = "/auth/refresh"
        let body = ["refresh_token": refreshToken]
        return try await post(endpoint: endpoint, body: body)
    }
    
    // MARK: - Passkey APIs
    func getPasskeyChallenge(userId: String) async throws -> PasskeyChallenge {
        let endpoint = "/auth/passkey/challenge"
        let body = ["user_id": userId]
        return try await post(endpoint: endpoint, body: body)
    }
    
    func registerPasskeyCredential(credential: PasskeyCredential) async throws -> Bool {
        let endpoint = "/auth/passkey/register"
        let response: [String: Bool] = try await post(endpoint: endpoint, body: credential)
        return response["success"] ?? false
    }
    
    // MARK: - Two-Factor Authentication APIs
    func enable2FA(userId: Int) async throws -> TwoFactorSetup {
        let endpoint = "/auth/2fa/enable"
        let body = ["user_id": userId]
        return try await post(endpoint: endpoint, body: body)
    }
    
    func verify2FA(verification: TwoFactorVerification) async throws -> Bool {
        let endpoint = "/auth/2fa/verify"
        let response: [String: Bool] = try await post(endpoint: endpoint, body: verification)
        return response["verified"] ?? false
    }
    
    func disable2FA(verification: TwoFactorVerification) async throws -> Bool {
        let endpoint = "/auth/2fa/disable"
        let response: [String: Bool] = try await post(endpoint: endpoint, body: verification)
        return response["success"] ?? false
    }
    
    func get2FAStatus() async throws -> TwoFactorStatus {
        let endpoint = "/auth/2fa/status"
        return try await get(endpoint: endpoint)
    }
    
    // MARK: - eKYC APIs
    func submitEKYC(guestId: Int,
                    documentType: DocumentType,
                    frontImage: Data,
                    backImage: Data?,
                    selfieImage: Data) async throws -> EKYCDocument {
        let endpoint = "/ekyc/submit"
        
        // Create multipart form data
        let boundary = UUID().uuidString
        var body = Data()
        
        // Add guest ID
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"guest_id\"\r\n\r\n")
        body.append("\(guestId)\r\n")
        
        // Add document type
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"document_type\"\r\n\r\n")
        body.append("\(documentType.rawValue)\r\n")
        
        // Add front image
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"front_image\"; filename=\"front.jpg\"\r\n")
        body.append("Content-Type: image/jpeg\r\n\r\n")
        body.append(frontImage)
        body.append("\r\n")
        
        // Add back image if provided
        if let backImage = backImage {
            body.append("--\(boundary)\r\n")
            body.append("Content-Disposition: form-data; name=\"back_image\"; filename=\"back.jpg\"\r\n")
            body.append("Content-Type: image/jpeg\r\n\r\n")
            body.append(backImage)
            body.append("\r\n")
        }
        
        // Add selfie
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"selfie_image\"; filename=\"selfie.jpg\"\r\n")
        body.append("Content-Type: image/jpeg\r\n\r\n")
        body.append(selfieImage)
        body.append("\r\n")
        
        body.append("--\(boundary)--\r\n")
        
        var request = try createRequest(endpoint: endpoint, method: "POST")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        
        let (data, response) = try await session.data(for: request)
        try validateResponse(response, data: data)
        
        return try decoder.decode(EKYCDocument.self, from: data)
    }
    
    func getEKYCStatus(guestId: Int) async throws -> EKYCStatus {
        let endpoint = "/ekyc/status/\(guestId)"
        let response: [String: String] = try await get(endpoint: endpoint)
        
        guard let statusString = response["status"],
              let status = EKYCStatus(rawValue: statusString) else {
            throw APIError.invalidResponse
        }
        
        return status
    }
    
    // MARK: - Guest APIs
    func createGuest(_ guest: GuestRequest) async throws -> Guest {
        let endpoint = "/guests"
        return try await post(endpoint: endpoint, body: guest)
    }
    
    func getGuest(guestId: Int) async throws -> Guest {
        let endpoint = "/guests/\(guestId)"
        return try await get(endpoint: endpoint)
    }
    
    func updateGuest(guestId: Int, guest: GuestRequest) async throws -> Guest {
        let endpoint = "/guests/\(guestId)"
        return try await put(endpoint: endpoint, body: guest)
    }
    
    // MARK: - Room APIs
    func getAvailableRooms(checkIn: Date, checkOut: Date, guests: Int) async throws -> [Room] {
        let endpoint = "/rooms/available"
        let dateFormatter = ISO8601DateFormatter()
        
        let params: [String: String] = [
            "check_in": dateFormatter.string(from: checkIn),
            "check_out": dateFormatter.string(from: checkOut),
            "guests": String(guests)
        ]
        
        return try await get(endpoint: endpoint, queryParams: params)
    }
    
    func getRoomDetails(roomId: Int) async throws -> Room {
        let endpoint = "/rooms/\(roomId)"
        return try await get(endpoint: endpoint)
    }
    
    // MARK: - Booking APIs
    func createBooking(guestId: Int,
                      roomId: Int,
                      checkIn: Date,
                      checkOut: Date,
                      numberOfGuests: Int,
                      postType: String? = nil,
                      rateCode: String? = nil) async throws -> BookingWithDetails {
        let endpoint = "/bookings"
        let dateFormatter = ISO8601DateFormatter()
        
        let request = BookingRequest(
            guestId: guestId,
            roomId: roomId,
            checkInDate: dateFormatter.string(from: checkIn),
            checkOutDate: dateFormatter.string(from: checkOut),
            postType: postType,
            rateCode: rateCode
        )
        
        return try await post(endpoint: endpoint, body: request)
    }
    
    func getMyBookings(guestId: Int) async throws -> [BookingWithDetails] {
        let endpoint = "/bookings/guest/\(guestId)"
        return try await get(endpoint: endpoint)
    }
    
    func getBookingDetails(bookingId: Int) async throws -> BookingWithDetails {
        let endpoint = "/bookings/\(bookingId)"
        return try await get(endpoint: endpoint)
    }
    
    func cancelBooking(bookingId: Int) async throws -> BookingWithDetails {
        let endpoint = "/bookings/\(bookingId)/cancel"
        return try await post(endpoint: endpoint, body: EmptyRequest())
    }
    
    // MARK: - Generic Request Methods
    private func get<T: Decodable>(endpoint: String, queryParams: [String: String]? = nil) async throws -> T {
        var request = try createRequest(endpoint: endpoint, method: "GET")
        
        if let params = queryParams {
            var components = URLComponents(string: baseURL + endpoint)
            components?.queryItems = params.map { URLQueryItem(name: $0.key, value: $0.value) }
            if let url = components?.url {
                request = URLRequest(url: url)
                addAuthHeader(to: &request)
                request.httpMethod = "GET"
            }
        }
        
        let (data, response) = try await session.data(for: request)
        try validateResponse(response, data: data)
        
        return try decoder.decode(T.self, from: data)
    }
    
    private func post<T: Decodable, U: Encodable>(endpoint: String, body: U) async throws -> T {
        var request = try createRequest(endpoint: endpoint, method: "POST")
        request.httpBody = try encoder.encode(body)
        
        let (data, response) = try await session.data(for: request)
        try validateResponse(response, data: data)
        
        return try decoder.decode(T.self, from: data)
    }
    
    private func put<T: Decodable, U: Encodable>(endpoint: String, body: U) async throws -> T {
        var request = try createRequest(endpoint: endpoint, method: "PUT")
        request.httpBody = try encoder.encode(body)
        
        let (data, response) = try await session.data(for: request)
        try validateResponse(response, data: data)
        
        return try decoder.decode(T.self, from: data)
    }
    
    private func createRequest(endpoint: String, method: String) throws -> URLRequest {
        guard let url = URL(string: baseURL + endpoint) else {
            throw APIError.invalidResponse
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        addAuthHeader(to: &request)
        
        return request
    }
    
    private func addAuthHeader(to request: inout URLRequest) {
        if let token = HotelAuthManager.shared.authToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
    }
    
    private func validateResponse(_ response: URLResponse, data: Data) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        
        guard (200...299).contains(httpResponse.statusCode) else {
            if let errorResponse = try? decoder.decode(APIErrorResponse.self, from: data) {
                throw APIError.serverError(errorResponse.error, errorResponse.message)
            }
            
            switch httpResponse.statusCode {
            case 401:
                throw APIError.unauthorized
            case 403:
                throw APIError.forbidden
            case 404:
                throw APIError.notFound
            default:
                throw APIError.networkError("HTTP \(httpResponse.statusCode)")
            }
        }
    }
}

// MARK: - Helper Extensions
extension Data {
    mutating func append(_ string: String) {
        if let data = string.data(using: .utf8) {
            append(data)
        }
    }
}

// MARK: - Empty Request for POST endpoints without body
struct EmptyRequest: Codable {}
