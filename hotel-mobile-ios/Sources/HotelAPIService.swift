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
    
    private func performRequest<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError(error: "Invalid response")
        }
        
        // Handle authentication errors
        if httpResponse.statusCode == 401 {
            authManager.logout()
            throw APIError(error: "Authentication required. Please login again.")
        }
        
        guard (200...299).contains(httpResponse.statusCode) else {
            // Try to decode error message
            if let errorResponse = try? JSONDecoder().decode(APIError.self, from: data) {
                throw errorResponse
            }
            throw APIError(error: "Request failed with status code: \(httpResponse.statusCode)")
        }
        
        return try JSONDecoder().decode(T.self, from: data)
    }
    
    // MARK: - Authentication
    
    func login(username: String, password: String) async throws -> AuthResponse {
        let url = URL(string: "\(baseURL)/auth/login")!
        let loginRequest = LoginRequest(username: username, password: password)
        let body = try JSONEncoder().encode(loginRequest)
        
        var request = createRequest(url: url, method: "POST", body: body)
        // Don't include auth token for login
        request.setValue(nil, forHTTPHeaderField: "Authorization")
        
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
            throw APIError(error: "Invalid URL")
        }
        
        let request = createRequest(url: url)
        return try await performRequest(request)
    }
    
    // MARK: - Guest Operations
    
    func getAllGuests() async throws -> [Guest] {
        let url = URL(string: "\(baseURL)/guests")!
        let request = createRequest(url: url)
        return try await performRequest(request)
    }
    
    func createGuest(name: String, email: String, phone: String? = nil, address: String? = nil) async throws -> Guest {
        let url = URL(string: "\(baseURL)/guests")!
        let guestRequest = GuestRequest(name: name, email: email, phone: phone, address: address)
        let body = try JSONEncoder().encode(guestRequest)
        let request = createRequest(url: url, method: "POST", body: body)
        
        return try await performRequest(request)
    }
    
    // MARK: - Booking Operations
    
    func getAllBookings() async throws -> [BookingWithDetails] {
        let url = URL(string: "\(baseURL)/bookings")!
        let request = createRequest(url: url)
        return try await performRequest(request)
    }
    
    func createBooking(guestId: String, roomId: String, checkIn: String, checkOut: String) async throws -> Booking {
        let url = URL(string: "\(baseURL)/bookings")!
        let bookingRequest = BookingRequest(guest_id: guestId, room_id: roomId, check_in: checkIn, check_out: checkOut)
        let body = try JSONEncoder().encode(bookingRequest)
        let request = createRequest(url: url, method: "POST", body: body)
        
        return try await performRequest(request)
    }
    
    // MARK: - Personalized Reports
    
    func getPersonalizedReport(period: String = "month") async throws -> PersonalizedReport {
        var components = URLComponents(string: "\(baseURL)/analytics/personalized")!
        components.queryItems = [URLQueryItem(name: "period", value: period)]
        
        guard let url = components.url else {
            throw APIError(error: "Invalid URL")
        }
        
        let request = createRequest(url: url)
        return try await performRequest(request)
    }
}
