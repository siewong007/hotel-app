import Foundation
import AuthenticationServices

/// Enhanced Authentication Manager for Hotel Booking App
/// Integrates with existing DataModels and adds Passkey, 2FA, and eKYC support
class HotelAuthManager: NSObject {
    static let shared = HotelAuthManager()
    
    private let keychainService = "com.hotelapp.auth"
    private let tokenKey = "authToken"
    private let refreshTokenKey = "refreshToken"
    private let userKey = "currentUser"
    private let guestKey = "currentGuest"
    
    // Current session state
    private(set) var currentUser: User?
    private(set) var currentGuest: Guest?
    private(set) var authToken: String?
    private(set) var refreshToken: String?
    private(set) var hasPasskey: Bool = false
    private(set) var twoFactorEnabled: Bool = false
    
    var isAuthenticated: Bool {
        return authToken != nil && currentUser != nil
    }
    
    private override init() {
        super.init()
        loadStoredCredentials()
    }
    
    // MARK: - Traditional Login (Works with existing LoginResponse)
    func login(username: String, password: String, totpCode: String? = nil) async throws -> User {
        let request = LoginRequest(username: username, password: password, totpCode: totpCode)
        let response = try await HotelAPIManager.shared.login(request: request)
        return try await handleLoginResponse(response)
    }
    
    // MARK: - Register (Compatible with existing Guest model)
    func register(email: String, password: String, firstName: String, lastName: String, phone: String?) async throws -> User {
        let guestRequest = GuestRequest(
            firstName: firstName,
            lastName: lastName,
            email: email,
            phone: phone,
            addressLine1: nil,
            city: nil,
            stateProvince: nil,
            postalCode: nil,
            country: nil
        )
        
        // First create guest
        let guest = try await HotelAPIManager.shared.createGuest(guestRequest)
        self.currentGuest = guest
        
        // Then create user account (implement based on your API)
        let loginRequest = LoginRequest(username: email, password: password, totpCode: nil)
        let response = try await HotelAPIManager.shared.login(request: loginRequest)
        
        return try await handleLoginResponse(response)
    }
    
    // MARK: - Passkey Authentication
    @available(iOS 16.0, *)
    func registerPasskey(for user: User) async throws {
        // Get challenge from server
        let challenge = try await HotelAPIManager.shared.getPasskeyChallenge(userId: "\(user.id)")
        
        // Create passkey registration request
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: "hotelapp.com")
        let challengeData = Data(challenge.challenge.utf8)
        let userIdData = Data("\(user.id)".utf8)
        
        let registrationRequest = provider.createCredentialRegistrationRequest(
            challenge: challengeData,
            name: user.email,
            userID: userIdData
        )
        
        // This would trigger ASAuthorizationController - simplified for now
        self.hasPasskey = true
        throw AuthError.requiresUI
    }
    
    @available(iOS 16.0, *)
    func loginWithPasskey() async throws -> User {
        // This would trigger passkey authentication UI
        throw AuthError.requiresUI
    }
    
    // MARK: - Two-Factor Authentication
    func enable2FA() async throws -> TwoFactorSetup {
        guard let user = currentUser else {
            throw AuthError.notAuthenticated
        }
        
        let setup = try await HotelAPIManager.shared.enable2FA(userId: user.id)
        return setup
    }
    
    func verify2FA(code: String) async throws -> Bool {
        guard let _ = currentUser else {
            throw AuthError.notAuthenticated
        }
        
        let verification = TwoFactorVerification(code: code)
        let result = try await HotelAPIManager.shared.verify2FA(verification: verification)
        
        if result {
            self.twoFactorEnabled = true
        }
        
        return result
    }
    
    func disable2FA(code: String) async throws -> Bool {
        guard let _ = currentUser else {
            throw AuthError.notAuthenticated
        }
        
        let verification = TwoFactorVerification(code: code)
        let result = try await HotelAPIManager.shared.disable2FA(verification: verification)
        
        if result {
            self.twoFactorEnabled = false
        }
        
        return result
    }
    
    // MARK: - eKYC Verification
    func submitEKYC(documentType: DocumentType,
                    frontImage: Data,
                    backImage: Data?,
                    selfieImage: Data) async throws -> EKYCDocument {
        guard let guest = currentGuest else {
            throw AuthError.notAuthenticated
        }
        
        let document = try await HotelAPIManager.shared.submitEKYC(
            guestId: guest.id,
            documentType: documentType,
            frontImage: frontImage,
            backImage: backImage,
            selfieImage: selfieImage
        )
        
        return document
    }
    
    func getEKYCStatus() async throws -> EKYCStatus {
        guard let guest = currentGuest else {
            throw AuthError.notAuthenticated
        }
        
        let status = try await HotelAPIManager.shared.getEKYCStatus(guestId: guest.id)
        return status
    }
    
    // MARK: - Session Management
    func logout() {
        authToken = nil
        refreshToken = nil
        currentUser = nil
        currentGuest = nil
        hasPasskey = false
        twoFactorEnabled = false
        clearStoredCredentials()
        
        NotificationCenter.default.post(name: NSNotification.Name("UserDidLogout"), object: nil)
    }
    
    func refreshSession() async throws {
        guard let refreshToken = self.refreshToken else {
            throw AuthError.noRefreshToken
        }
        
        let response = try await HotelAPIManager.shared.refreshToken(refreshToken: refreshToken)
        
        self.authToken = response.accessToken
        self.refreshToken = response.refreshToken
        
        saveToken(response.accessToken)
        saveRefreshToken(response.refreshToken)
    }
    
    // MARK: - Private Methods
    private func handleLoginResponse(_ response: LoginResponse) async throws -> User {
        self.authToken = response.accessToken
        self.refreshToken = response.refreshToken
        self.currentUser = response.user
        
        // Check if user has 2FA enabled
        if let totpStatus = try? await HotelAPIManager.shared.get2FAStatus() {
            self.twoFactorEnabled = totpStatus.enabled
        }
        
        // Try to load guest profile
        if let guestId = response.user.id as? Int {
            if let guest = try? await HotelAPIManager.shared.getGuest(guestId: guestId) {
                self.currentGuest = guest
            }
        }
        
        saveCredentials(token: response.accessToken, refreshToken: response.refreshToken, user: response.user)
        
        NotificationCenter.default.post(name: NSNotification.Name("UserDidLogin"), object: nil)
        
        return response.user
    }
    
    private func saveCredentials(token: String, refreshToken: String, user: User) {
        KeychainHelper.save(token, service: keychainService, account: tokenKey)
        KeychainHelper.save(refreshToken, service: keychainService, account: self.refreshTokenKey)
        
        if let userData = try? JSONEncoder().encode(user),
           let userString = String(data: userData, encoding: .utf8) {
            KeychainHelper.save(userString, service: keychainService, account: userKey)
        }
    }
    
    private func saveToken(_ token: String) {
        KeychainHelper.save(token, service: keychainService, account: tokenKey)
    }
    
    private func saveRefreshToken(_ token: String) {
        KeychainHelper.save(token, service: keychainService, account: refreshTokenKey)
    }
    
    private func loadStoredCredentials() {
        if let token = KeychainHelper.load(service: keychainService, account: tokenKey) {
            self.authToken = token
        }
        
        if let refreshToken = KeychainHelper.load(service: keychainService, account: refreshTokenKey) {
            self.refreshToken = refreshToken
        }
        
        if let userString = KeychainHelper.load(service: keychainService, account: userKey),
           let userData = userString.data(using: .utf8),
           let user = try? JSONDecoder().decode(User.self, from: userData) {
            self.currentUser = user
        }
    }
    
    private func clearStoredCredentials() {
        KeychainHelper.delete(service: keychainService, account: tokenKey)
        KeychainHelper.delete(service: keychainService, account: refreshTokenKey)
        KeychainHelper.delete(service: keychainService, account: userKey)
        KeychainHelper.delete(service: keychainService, account: guestKey)
    }
}

// MARK: - Auth Errors
enum AuthError: LocalizedError {
    case notAuthenticated
    case invalidCredentials
    case passkeyNotSupported
    case requiresUI
    case noRefreshToken
    case twoFactorRequired
    case eKYCRequired
    case eKYCPending
    
    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return "User is not authenticated"
        case .invalidCredentials:
            return "Invalid email or password"
        case .passkeyNotSupported:
            return "Passkey authentication is not supported on this device"
        case .requiresUI:
            return "This operation requires user interaction"
        case .noRefreshToken:
            return "No refresh token available"
        case .twoFactorRequired:
            return "Two-factor authentication is required"
        case .eKYCRequired:
            return "eKYC verification is required"
        case .eKYCPending:
            return "eKYC verification is pending"
        }
    }
}

// MARK: - Keychain Helper (Reusable)
class KeychainHelper {
    static func save(_ value: String, service: String, account: String) {
        let data = Data(value.utf8)
        
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data
        ]
        
        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }
    
    static func load(service: String, account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        
        guard status == errSecSuccess,
              let data = result as? Data,
              let value = String(data: data, encoding: .utf8) else {
            return nil
        }
        
        return value
    }
    
    static func delete(service: String, account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        
        SecItemDelete(query as CFDictionary)
    }
}
