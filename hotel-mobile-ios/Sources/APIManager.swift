//
//  APIManager.swift
//  HotelMobileIOS
//  Updated API Manager to follow the integration documentation
//  Uses Combine for reactive programming and matches all API endpoints exactly
//

import Foundation
import Combine
import AuthenticationServices

class APIManager {
    static let shared = APIManager()

    private let baseURL = "http://localhost:3030" // Update this for production
    private var cancellables = Set<AnyCancellable>()

    // Token management using Keychain
    private var accessToken: String? {
        get { try? KeychainHelper.loadString(key: "access_token") }
        set { try? KeychainHelper.save(key: "access_token", string: newValue ?? "") }
    }

    private var storedRefreshToken: String? {
        get { try? KeychainHelper.loadString(key: "refresh_token") }
        set { try? KeychainHelper.save(key: "refresh_token", string: newValue ?? "") }
    }

    // MARK: - Authentication

    func login(username: String, password: String, totpCode: String? = nil) -> AnyPublisher<LoginResponse, Error> {
        let url = URL(string: "\(baseURL)/auth/login")!
        let loginRequest = LoginRequest(username: username, password: password, totpCode: totpCode)

        guard let request = createRequest(url: url, method: "POST", body: loginRequest) else {
            return Fail(error: APIError.networkError("Invalid URL")).eraseToAnyPublisher()
        }

        return performRequest(request)
            .tryMap { (response: LoginResponse) -> LoginResponse in
                // Store tokens securely
                self.accessToken = response.accessToken
                self.storedRefreshToken = response.refreshToken
                return response
            }
            .eraseToAnyPublisher()
    }

    func refreshToken() -> AnyPublisher<RefreshResponse, Error> {
        guard let token = storedRefreshToken else {
            return Fail(error: APIError.unauthorized).eraseToAnyPublisher()
        }

        let url = URL(string: "\(baseURL)/auth/refresh")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        return performRequest(request)
            .tryMap { (response: RefreshResponse) -> RefreshResponse in
                // Update stored tokens
                self.accessToken = response.accessToken
                self.storedRefreshToken = response.refreshToken
                return response
            }
            .eraseToAnyPublisher()
    }

    func register(email: String, username: String, password: String, fullName: String? = nil, phone: String? = nil) -> AnyPublisher<[String: String], Error> {
        let url = URL(string: "\(baseURL)/auth/register")!
        let registerRequest = [
            "email": email,
            "username": username,
            "password": password,
            "full_name": fullName,
            "phone": phone
        ].compactMapValues { $0 }

        guard let request = createRequest(url: url, method: "POST", body: registerRequest) else {
            return Fail(error: APIError.networkError("Invalid request")).eraseToAnyPublisher()
        }

        return performRequest(request)
    }

    func logout() -> AnyPublisher<EmptyResponse, Error> {
        guard let token = storedRefreshToken else {
            return Fail(error: APIError.unauthorized).eraseToAnyPublisher()
        }

        let url = URL(string: "\(baseURL)/auth/logout")!
        let body = ["refresh_token": token]

        guard let request = createRequest(url: url, method: "POST", body: body) else {
            return Fail(error: APIError.networkError("Invalid request")).eraseToAnyPublisher()
        }

        // Clear local tokens even if request fails
        clearTokens()

        return performRequest(request)
    }

    // MARK: - Room Management

    func getRooms() -> AnyPublisher<[Room], Error> {
        let url = URL(string: "\(baseURL)/rooms")!
        guard let request = createRequest(url: url, method: "GET") else {
            return Fail(error: APIError.networkError("Invalid URL")).eraseToAnyPublisher()
        }

        return performRequest(request)
    }

    func searchAvailableRooms(roomType: String? = nil, maxPrice: Decimal? = nil) -> AnyPublisher<[Room], Error> {
        var components = URLComponents(string: "\(baseURL)/rooms/available")!
        var queryItems: [URLQueryItem] = []

        if let roomType = roomType {
            queryItems.append(URLQueryItem(name: "room_type", value: roomType))
        }
        if let maxPrice = maxPrice {
            queryItems.append(URLQueryItem(name: "max_price", value: maxPrice.description))
        }

        components.queryItems = queryItems.isEmpty ? nil : queryItems

        guard let url = components.url, let request = createRequest(url: url, method: "GET") else {
            return Fail(error: APIError.networkError("Invalid URL")).eraseToAnyPublisher()
        }

        return performRequest(request)
    }

    // MARK: - Guest Management

    func getGuests() -> AnyPublisher<[Guest], Error> {
        let url = URL(string: "\(baseURL)/guests")!
        guard let request = createRequest(url: url, method: "GET") else {
            return Fail(error: APIError.networkError("Invalid URL")).eraseToAnyPublisher()
        }

        return performRequest(request)
    }

    func createGuest(firstName: String, lastName: String, email: String, phone: String? = nil,
                    addressLine1: String? = nil, city: String? = nil, stateProvince: String? = nil,
                    postalCode: String? = nil, country: String? = nil) -> AnyPublisher<Guest, Error> {
        let url = URL(string: "\(baseURL)/guests")!
        let guestRequest = GuestRequest(
            firstName: firstName,
            lastName: lastName,
            email: email,
            phone: phone,
            addressLine1: addressLine1,
            city: city,
            stateProvince: stateProvince,
            postalCode: postalCode,
            country: country
        )

        guard let request = createRequest(url: url, method: "POST", body: guestRequest) else {
            return Fail(error: APIError.networkError("Invalid request")).eraseToAnyPublisher()
        }

        return performRequest(request)
    }

    // MARK: - Booking Management

    func getMyBookings() -> AnyPublisher<[BookingWithDetails], Error> {
        let url = URL(string: "\(baseURL)/bookings/my-bookings")!
        guard let request = createRequest(url: url, method: "GET") else {
            return Fail(error: APIError.networkError("Invalid URL")).eraseToAnyPublisher()
        }

        return performRequest(request)
    }

    func createBooking(guestId: Int, roomId: Int, checkInDate: String, checkOutDate: String,
                      postType: String? = "normal_stay", rateCode: String? = "RACK") -> AnyPublisher<BookingWithDetails, Error> {
        let url = URL(string: "\(baseURL)/bookings")!
        let bookingRequest = BookingRequest(
            guestId: guestId,
            roomId: roomId,
            checkInDate: checkInDate,
            checkOutDate: checkOutDate,
            postType: postType,
            rateCode: rateCode
        )

        guard let request = createRequest(url: url, method: "POST", body: bookingRequest) else {
            return Fail(error: APIError.networkError("Invalid request")).eraseToAnyPublisher()
        }

        return performRequest(request)
    }

    func cancelBooking(bookingId: Int) -> AnyPublisher<BookingWithDetails, Error> {
        let url = URL(string: "\(baseURL)/bookings/\(bookingId)/cancel")!
        guard let request = createRequest(url: url, method: "POST") else {
            return Fail(error: APIError.networkError("Invalid request")).eraseToAnyPublisher()
        }

        return performRequest(request)
    }

    // MARK: - User Profile

    func getProfile() -> AnyPublisher<UserProfile, Error> {
        let url = URL(string: "\(baseURL)/profile")!
        guard let request = createRequest(url: url, method: "GET") else {
            return Fail(error: APIError.networkError("Invalid URL")).eraseToAnyPublisher()
        }

        return performRequest(request)
    }

    func updateProfile(fullName: String? = nil, email: String? = nil, phone: String? = nil,
                      avatarUrl: String? = nil) -> AnyPublisher<UserProfile, Error> {
        let url = URL(string: "\(baseURL)/profile")!
        let profileUpdate = UserProfileUpdate(
            fullName: fullName,
            email: email,
            phone: phone,
            avatarUrl: avatarUrl
        )

        guard let request = createRequest(url: url, method: "PATCH", body: profileUpdate) else {
            return Fail(error: APIError.networkError("Invalid request")).eraseToAnyPublisher()
        }

        return performRequest(request)
    }

    func changePassword(currentPassword: String, newPassword: String) -> AnyPublisher<EmptyResponse, Error> {
        let url = URL(string: "\(baseURL)/profile/password")!
        let passwordUpdate = PasswordUpdate(
            currentPassword: currentPassword,
            newPassword: newPassword
        )

        guard let request = createRequest(url: url, method: "POST", body: passwordUpdate) else {
            return Fail(error: APIError.networkError("Invalid request")).eraseToAnyPublisher()
        }

        return performRequest(request)
    }

    // MARK: - Loyalty Program

    func getLoyaltyMembership() -> AnyPublisher<LoyaltyMembership, Error> {
        let url = URL(string: "\(baseURL)/loyalty/my-membership")!
        guard let request = createRequest(url: url, method: "GET") else {
            return Fail(error: APIError.networkError("Invalid URL")).eraseToAnyPublisher()
        }

        return performRequest(request)
    }

    func getAvailableRewards() -> AnyPublisher<[LoyaltyReward], Error> {
        let url = URL(string: "\(baseURL)/loyalty/rewards")!
        guard let request = createRequest(url: url, method: "GET") else {
            return Fail(error: APIError.networkError("Invalid URL")).eraseToAnyPublisher()
        }

        return performRequest(request)
    }

    func redeemReward(rewardId: Int, bookingId: Int? = nil, notes: String? = nil) -> AnyPublisher<PointsTransaction, Error> {
        let url = URL(string: "\(baseURL)/loyalty/rewards/redeem")!
        let redemption = RewardRedemption(
            rewardId: rewardId,
            bookingId: bookingId,
            notes: notes
        )

        guard let request = createRequest(url: url, method: "POST", body: redemption) else {
            return Fail(error: APIError.networkError("Invalid request")).eraseToAnyPublisher()
        }

        return performRequest(request)
    }

    // MARK: - Analytics

    func getOccupancyReport() -> AnyPublisher<OccupancyReport, Error> {
        let url = URL(string: "\(baseURL)/analytics/occupancy")!
        guard let request = createRequest(url: url, method: "GET") else {
            return Fail(error: APIError.networkError("Invalid URL")).eraseToAnyPublisher()
        }

        return performRequest(request)
    }

    func getBookingAnalytics() -> AnyPublisher<BookingAnalytics, Error> {
        let url = URL(string: "\(baseURL)/analytics/bookings")!
        guard let request = createRequest(url: url, method: "GET") else {
            return Fail(error: APIError.networkError("Invalid URL")).eraseToAnyPublisher()
        }

        return performRequest(request)
    }

    // MARK: - Two-Factor Authentication

    func setupTwoFactor() -> AnyPublisher<TwoFactorSetup, Error> {
        let url = URL(string: "\(baseURL)/auth/2fa/setup")!
        guard let request = createRequest(url: url, method: "POST") else {
            return Fail(error: APIError.networkError("Invalid request")).eraseToAnyPublisher()
        }

        return performRequest(request)
    }

    func enableTwoFactor(code: String) -> AnyPublisher<EmptyResponse, Error> {
        let url = URL(string: "\(baseURL)/auth/2fa/enable")!
        let body = ["code": code]

        guard let request = createRequest(url: url, method: "POST", body: body) else {
            return Fail(error: APIError.networkError("Invalid request")).eraseToAnyPublisher()
        }

        return performRequest(request)
    }

    func getTwoFactorStatus() -> AnyPublisher<TwoFactorStatus, Error> {
        let url = URL(string: "\(baseURL)/auth/2fa/status")!
        guard let request = createRequest(url: url, method: "GET") else {
            return Fail(error: APIError.networkError("Invalid URL")).eraseToAnyPublisher()
        }

        return performRequest(request)
    }

    // MARK: - Passkey Management

    func listPasskeys() -> AnyPublisher<[PasskeyInfo], Error> {
        let url = URL(string: "\(baseURL)/profile/passkeys")!
        guard let request = createRequest(url: url, method: "GET") else {
            return Fail(error: APIError.networkError("Invalid URL")).eraseToAnyPublisher()
        }

        return performRequest(request)
    }

    func renamePasskey(passkeyId: String, deviceName: String) -> AnyPublisher<EmptyResponse, Error> {
        let url = URL(string: "\(baseURL)/profile/passkeys/\(passkeyId)")!
        let body = ["device_name": deviceName]

        guard let request = createRequest(url: url, method: "PATCH", body: body) else {
            return Fail(error: APIError.networkError("Invalid request")).eraseToAnyPublisher()
        }

        return performRequest(request)
    }

    func deletePasskey(passkeyId: String) -> AnyPublisher<EmptyResponse, Error> {
        let url = URL(string: "\(baseURL)/profile/passkeys/\(passkeyId)")!
        guard let request = createRequest(url: url, method: "DELETE") else {
            return Fail(error: APIError.networkError("Invalid request")).eraseToAnyPublisher()
        }

        return performRequest(request)
    }

    // MARK: - Private Helper Methods

    // Overload for requests without a body
    private func createRequest(url: URL, method: String) -> URLRequest? {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Add auth token if available (except for login/register)
        if let token = accessToken, !url.path.contains("/auth/login") && !url.path.contains("/auth/register") {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        return request
    }

    // Overload for requests with a body
    private func createRequest<T: Encodable>(url: URL, method: String, body: T) -> URLRequest? {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Add auth token if available (except for login/register)
        if let token = accessToken, !url.path.contains("/auth/login") && !url.path.contains("/auth/register") {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        do {
            request.httpBody = try JSONEncoder().encode(body)
        } catch {
            return nil
        }

        return request
    }

    private func performRequest<T: Decodable>(_ request: URLRequest) -> AnyPublisher<T, Error> {
        return URLSession.shared.dataTaskPublisher(for: request)
            .tryMap { [weak self] output -> T in
                guard let self = self else { throw APIError.networkError("APIManager deallocated") }

                guard let response = output.response as? HTTPURLResponse else {
                    throw APIError.invalidResponse
                }

                // Handle specific HTTP status codes
                switch response.statusCode {
                case 200...299:
                    return try JSONDecoder().decode(T.self, from: output.data)
                case 401:
                    // Try to refresh token
                    if self.storedRefreshToken != nil {
                        // This would need to be handled in the calling code with retry logic
                        throw APIError.unauthorized
                    } else {
                        throw APIError.unauthorized
                    }
                case 403:
                    throw APIError.forbidden
                case 404:
                    throw APIError.notFound
                default:
                    let errorResponse = try? JSONDecoder().decode(APIErrorResponse.self, from: output.data)
                    throw APIError.serverError(errorResponse?.error ?? "Unknown Error",
                                              errorResponse?.message ?? "Request failed with status code: \(response.statusCode)")
                }
            }
            .mapError { error -> Error in
                if let apiError = error as? APIError {
                    return apiError
                }
                if let decodingError = error as? DecodingError {
                    return APIError.decodingError(decodingError.localizedDescription)
                }
                return APIError.networkError(error.localizedDescription)
            }
            .eraseToAnyPublisher()
    }

    private func clearTokens() {
        accessToken = nil
        storedRefreshToken = nil
    }
}

// MARK: - Convenience Extension for Reactive Programming

extension APIManager {
    // Auto-refreshing request wrapper
    func performAuthenticatedRequest<T: Decodable>(_ request: URLRequest, retryCount: Int = 0) -> AnyPublisher<T, Error> {
        return performRequest(request)
            .catch { [weak self] error -> AnyPublisher<T, Error> in
                guard let self = self else { return Fail(error: error).eraseToAnyPublisher() }

                if case APIError.unauthorized = error, retryCount == 0,
                   self.storedRefreshToken != nil {
                    // Try to refresh token once
                    return self.refreshToken()
                        .flatMap { _ -> AnyPublisher<T, Error> in
                            // Retry original request with new token
                            var newRequest = request
                            if let token = self.accessToken {
                                newRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                            }
                            return self.performAuthenticatedRequest(newRequest, retryCount: 1)
                        }
                        .catch { refreshError -> AnyPublisher<T, Error> in
                            // Refresh failed, logout
                            self.clearTokens()
                            return Fail(error: refreshError).eraseToAnyPublisher()
                        }
                        .eraseToAnyPublisher()
                }

                return Fail(error: error).eraseToAnyPublisher()
            }
            .eraseToAnyPublisher()
    }
}
