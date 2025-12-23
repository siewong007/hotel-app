import Foundation

class HotelAPIService {
    static let shared = HotelAPIService()
    private var baseURL: String {
        UserDefaults.standard.string(forKey: "serverURL") ?? "http://localhost:3030"
    }
    private let authManager = AuthManager.shared
    
    private init() {}
    
    // MARK: - Request Helpers
    
    private func createRequest(url: URL, method: String = "GET", body: Data? = nil) -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        // Add authentication token if available
        if let token = authManager.accessToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        
        if let body = body {
            request.httpBody = body
        }
        
        return request
    }
    
    private func performRequest<T: Decodable>(_ request: URLRequest, retryCount: Int = 0) async throws -> T {
        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        // Handle authentication errors with token refresh
        if httpResponse.statusCode == 401 {
            // Try to refresh token if we haven't retried yet
            if retryCount == 0, authManager.refreshToken != nil {
                do {
                    _ = try await refreshAccessToken()
                    // Retry the original request with new token
                    var newRequest = request
                    if let token = authManager.accessToken {
                        newRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                    }
                    return try await performRequest(newRequest, retryCount: retryCount + 1)
                } catch {
                    // Refresh failed, logout
                    authManager.logout()
                    throw APIError.unauthorized
                }
            } else {
                // Already retried or no refresh token
                authManager.logout()
                throw APIError.unauthorized
            }
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            // Try to decode error message
            if let errorResponse = try? JSONDecoder().decode(APIErrorResponse.self, from: data) {
                throw APIError.serverError(errorResponse.error, errorResponse.message)
            }
            throw APIError.networkError("Request failed with status code: \(httpResponse.statusCode)")
        }

        return try JSONDecoder().decode(T.self, from: data)
    }
    
    // MARK: - Authentication
    
    func login(username: String, password: String) async throws -> AuthResponse {
        let url = URL(string: "\(baseURL)/auth/login")!
        let loginRequest = LoginRequest(username: username, password: password, totpCode: nil)
        let body = try JSONEncoder().encode(loginRequest)

        var request = createRequest(url: url, method: "POST", body: body)
        // Don't include auth token for login
        request.setValue(nil as String?, forHTTPHeaderField: "Authorization")

        let authResponse: AuthResponse = try await performRequest(request)
        authManager.saveAuth(authResponse)
        return authResponse
    }

    func refreshAccessToken() async throws -> AuthResponse {
        guard let refreshToken = authManager.refreshToken else {
            throw APIError.unauthorized
        }
        
        let url = URL(string: "\(baseURL)/auth/refresh")!
        var request = createRequest(url: url, method: "POST")
        // Use refresh token for this request
        request.setValue("Bearer \(refreshToken)", forHTTPHeaderField: "Authorization")
        
        let authResponse: AuthResponse = try await performRequest(request)
        authManager.saveAuth(authResponse)
        return authResponse
    }
    
    // MARK: - Room Operations
    
    func getAllRooms() async throws -> [Room] {
        let url = URL(string: "\(baseURL)/rooms")!
        let request = createRequest(url: url)
        return try await performRequest(request)
    }
    
    func getRoom(id: String) async throws -> Room {
        let url = URL(string: "\(baseURL)/rooms/\(id)")!
        let request = createRequest(url: url)
        return try await performRequest(request)
    }
    
    func searchRooms(roomType: String? = nil, maxPrice: Double? = nil) async throws -> [Room] {
        var components = URLComponents(string: "\(baseURL)/rooms/available")!
        
        var queryItems: [URLQueryItem] = []
        if let roomType = roomType {
            queryItems.append(URLQueryItem(name: "room_type", value: roomType))
        }
        if let maxPrice = maxPrice {
            queryItems.append(URLQueryItem(name: "max_price", value: String(maxPrice)))
        }
        
        components.queryItems = queryItems.isEmpty ? nil : queryItems
        guard let url = components.url else {
            throw APIError.networkError("Invalid URL")
        }
        
        let request = createRequest(url: url)
        return try await performRequest(request)
    }
    
    func createRoom(roomNumber: String, roomType: String, pricePerNight: Double, maxOccupancy: Int, description: String? = nil) async throws -> Room {
        let url = URL(string: "\(baseURL)/rooms")!
        let roomData: [String: Any] = [
            "room_number": roomNumber,
            "room_type": roomType,
            "price_per_night": pricePerNight,
            "max_occupancy": maxOccupancy,
            "description": description as Any
        ]
        let body = try JSONSerialization.data(withJSONObject: roomData)
        let request = createRequest(url: url, method: "POST", body: body)
        
        return try await performRequest(request)
    }
    
    func updateRoom(id: String, roomNumber: String? = nil, roomType: String? = nil, pricePerNight: Double? = nil, available: Bool? = nil, maxOccupancy: Int? = nil, description: String? = nil) async throws -> Room {
        let url = URL(string: "\(baseURL)/rooms/\(id)")!
        var roomData: [String: Any] = [:]
        
        if let roomNumber = roomNumber { roomData["room_number"] = roomNumber }
        if let roomType = roomType { roomData["room_type"] = roomType }
        if let pricePerNight = pricePerNight { roomData["price_per_night"] = pricePerNight }
        if let available = available { roomData["available"] = available }
        if let maxOccupancy = maxOccupancy { roomData["max_occupancy"] = maxOccupancy }
        if let description = description { roomData["description"] = description }
        
        let body = try JSONSerialization.data(withJSONObject: roomData)
        let request = createRequest(url: url, method: "PUT", body: body)
        
        return try await performRequest(request)
    }
    
    func deleteRoom(id: String) async throws {
        let url = URL(string: "\(baseURL)/rooms/\(id)")!
        let request = createRequest(url: url, method: "DELETE")
        
        let _: [String: String] = try await performRequest(request)
    }
    
    // MARK: - Guest Operations
    
    func getAllGuests() async throws -> [Guest] {
        let url = URL(string: "\(baseURL)/guests")!
        let request = createRequest(url: url)
        return try await performRequest(request)
    }
    
    func getGuest(id: String) async throws -> Guest {
        let url = URL(string: "\(baseURL)/guests/\(id)")!
        let request = createRequest(url: url)
        return try await performRequest(request)
    }
    
    func createGuest(name: String, email: String, phone: String? = nil, address: String? = nil) async throws -> Guest {
        let url = URL(string: "\(baseURL)/guests")!

        // Split name into first and last name
        let nameParts = name.split(separator: " ", maxSplits: 1).map(String.init)
        let firstName = nameParts.first ?? name
        let lastName = nameParts.count > 1 ? nameParts[1] : ""

        let guestRequest = GuestRequest(
            firstName: firstName,
            lastName: lastName,
            email: email,
            phone: phone,
            addressLine1: address,
            city: nil,
            stateProvince: nil,
            postalCode: nil,
            country: nil
        )
        let body = try JSONEncoder().encode(guestRequest)
        let request = createRequest(url: url, method: "POST", body: body)

        return try await performRequest(request)
    }
    
    func updateGuest(id: String, name: String? = nil, email: String? = nil, phone: String? = nil, address: String? = nil) async throws -> Guest {
        let url = URL(string: "\(baseURL)/guests/\(id)")!
        var guestData: [String: Any] = [:]
        
        if let name = name { guestData["name"] = name }
        if let email = email { guestData["email"] = email }
        if let phone = phone { guestData["phone"] = phone }
        if let address = address { guestData["address"] = address }
        
        let body = try JSONSerialization.data(withJSONObject: guestData)
        let request = createRequest(url: url, method: "PUT", body: body)
        
        return try await performRequest(request)
    }
    
    func deleteGuest(id: String) async throws {
        let url = URL(string: "\(baseURL)/guests/\(id)")!
        let request = createRequest(url: url, method: "DELETE")
        
        let _: [String: String] = try await performRequest(request)
    }
    
    // MARK: - Booking Operations
    
    func getAllBookings() async throws -> [BookingWithDetails] {
        let url = URL(string: "\(baseURL)/bookings")!
        let request = createRequest(url: url)
        return try await performRequest(request)
    }
    
    func getBooking(id: String) async throws -> BookingWithDetails {
        let url = URL(string: "\(baseURL)/bookings/\(id)")!
        let request = createRequest(url: url)
        return try await performRequest(request)
    }
    
    func createBooking(guestId: String, roomId: String, checkIn: String, checkOut: String) async throws -> Booking {
        let url = URL(string: "\(baseURL)/bookings")!
        let bookingRequest = BookingRequest(
            guestId: Int(guestId) ?? 0,
            roomId: Int(roomId) ?? 0,
            checkInDate: checkIn,
            checkOutDate: checkOut,
            postType: nil,
            rateCode: nil
        )
        let body = try JSONEncoder().encode(bookingRequest)
        let request = createRequest(url: url, method: "POST", body: body)

        return try await performRequest(request)
    }
    
    func updateBooking(id: String, checkIn: String? = nil, checkOut: String? = nil, status: String? = nil) async throws -> Booking {
        let url = URL(string: "\(baseURL)/bookings/\(id)")!
        var bookingData: [String: Any] = [:]
        
        if let checkIn = checkIn { bookingData["check_in"] = checkIn }
        if let checkOut = checkOut { bookingData["check_out"] = checkOut }
        if let status = status { bookingData["status"] = status }
        
        let body = try JSONSerialization.data(withJSONObject: bookingData)
        let request = createRequest(url: url, method: "PUT", body: body)
        
        return try await performRequest(request)
    }
    
    func cancelBooking(id: String) async throws -> Booking {
        let url = URL(string: "\(baseURL)/bookings/\(id)/cancel")!
        let request = createRequest(url: url, method: "POST")
        
        return try await performRequest(request)
    }
    
    func deleteBooking(id: String) async throws {
        let url = URL(string: "\(baseURL)/bookings/\(id)")!
        let request = createRequest(url: url, method: "DELETE")

        let _: [String: String] = try await performRequest(request)
    }

    // MARK: - Enhanced Check-In

    func performEnhancedCheckIn(bookingId: String, checkInData: EnhancedCheckInRequest) async throws -> BookingWithDetails {
        let url = URL(string: "\(baseURL)/bookings/\(bookingId)/check-in")!
        let body = try JSONEncoder().encode(checkInData)
        let request = createRequest(url: url, method: "PATCH", body: body)

        return try await performRequest(request)
    }

    // MARK: - Personalized Reports

    func getPersonalizedReport(period: String = "month") async throws -> PersonalizedReport {
        var components = URLComponents(string: "\(baseURL)/analytics/personalized")!
        components.queryItems = [URLQueryItem(name: "period", value: period)]

        guard let url = components.url else {
            throw APIError.networkError("Invalid URL")
        }

        let request = createRequest(url: url)
        return try await performRequest(request)
    }

    // MARK: - Loyalty Program Operations

    func getAllLoyaltyPrograms() async throws -> [LoyaltyProgram] {
        let url = URL(string: "\(baseURL)/loyalty/programs")!
        let request = createRequest(url: url)
        return try await performRequest(request)
    }

    func getAllLoyaltyMemberships() async throws -> [LoyaltyMembershipWithDetails] {
        let url = URL(string: "\(baseURL)/loyalty/memberships")!
        let request = createRequest(url: url)
        return try await performRequest(request)
    }

    func getLoyaltyMembershipsByGuest(guestId: String) async throws -> [LoyaltyMembership] {
        let url = URL(string: "\(baseURL)/loyalty/guests/\(guestId)/memberships")!
        let request = createRequest(url: url)
        return try await performRequest(request)
    }

    func getPointsTransactions(membershipId: Int) async throws -> [PointsTransaction] {
        let url = URL(string: "\(baseURL)/loyalty/memberships/\(membershipId)/transactions")!
        let request = createRequest(url: url)
        return try await performRequest(request)
    }

    func getLoyaltyStatistics() async throws -> LoyaltyStatistics {
        let url = URL(string: "\(baseURL)/loyalty/statistics")!
        let request = createRequest(url: url)
        return try await performRequest(request)
    }

    func addPointsToMembership(membershipId: Int, points: Int, description: String? = nil) async throws -> PointsTransaction {
        let url = URL(string: "\(baseURL)/loyalty/memberships/\(membershipId)/points/add")!
        var pointsData: [String: Any] = ["points": points]
        if let description = description {
            pointsData["description"] = description
        }
        let body = try JSONSerialization.data(withJSONObject: pointsData)
        let request = createRequest(url: url, method: "POST", body: body)

        return try await performRequest(request)
    }

    func redeemPoints(membershipId: Int, points: Int, description: String? = nil) async throws -> PointsTransaction {
        let url = URL(string: "\(baseURL)/loyalty/memberships/\(membershipId)/points/redeem")!
        var pointsData: [String: Any] = ["points": points]
        if let description = description {
            pointsData["description"] = description
        }
        let body = try JSONSerialization.data(withJSONObject: pointsData)
        let request = createRequest(url: url, method: "POST", body: body)

        return try await performRequest(request)
    }

    // MARK: - User Profile Operations

    func getUserProfile() async throws -> UserProfile {
        let url = URL(string: "\(baseURL)/profile")!
        let request = createRequest(url: url)
        return try await performRequest(request)
    }

    func updateUserProfile(fullName: String? = nil, email: String? = nil, phone: String? = nil, address: String? = nil, city: String? = nil, country: String? = nil) async throws -> UserProfile {
        let url = URL(string: "\(baseURL)/profile")!
        var profileData: [String: Any] = [:]

        if let fullName = fullName { profileData["full_name"] = fullName }
        if let email = email { profileData["email"] = email }
        if let phone = phone { profileData["phone"] = phone }
        if let address = address { profileData["address"] = address }
        if let city = city { profileData["city"] = city }
        if let country = country { profileData["country"] = country }

        let body = try JSONSerialization.data(withJSONObject: profileData)
        let request = createRequest(url: url, method: "PATCH", body: body)

        return try await performRequest(request)
    }

    func updatePassword(currentPassword: String, newPassword: String) async throws {
        let url = URL(string: "\(baseURL)/profile/password")!
        let passwordUpdate = PasswordUpdate(currentPassword: currentPassword, newPassword: newPassword)
        let body = try JSONEncoder().encode(passwordUpdate)
        let request = createRequest(url: url, method: "POST", body: body)

        let _: [String: String] = try await performRequest(request)
    }

    // MARK: - Passkey Management

    func listPasskeys() async throws -> [PasskeyInfo] {
        let url = URL(string: "\(baseURL)/profile/passkeys")!
        let request = createRequest(url: url)
        return try await performRequest(request)
    }

    func deletePasskey(passkeyId: String) async throws {
        let url = URL(string: "\(baseURL)/profile/passkeys/\(passkeyId)")!
        let request = createRequest(url: url, method: "DELETE")

        let _: [String: String] = try await performRequest(request)
    }
}
