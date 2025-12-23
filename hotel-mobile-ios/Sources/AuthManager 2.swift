import Foundation
import AuthenticationServices

/// Manages user authentication including Passkey, 2FA, and eKYC
class AuthManager: NSObject {
    static let shared = AuthManager()
    
    private let keychainService = "com.hotelapp.auth"
    private let tokenKey = "authToken"
    private let refreshTokenKey = "refreshToken"
    
    private(set) var currentUser: User?
    private(set) var authToken: String?
    
    var isAuthenticated: Bool {
        return authToken != nil && currentUser != nil
    }
    
    private override init() {
        super.init()
        loadStoredCredentials()
    }
    
    // MARK: - Traditional Login
    func login(email: String, password: String) async throws -> User {
        let response = try await APIManager.shared.login(email: email, password: password)
        return try await handleAuthResponse(response)
    }
    
    // MARK: - Passkey Authentication
    func registerPasskey(for user: User) async throws {
        guard #available(iOS 16.0, *) else {
            throw AuthError.passkeyNotSupported
        }
        
        // Get challenge from server
        let challenge = try await APIManager.shared.getPasskeyChallenge(userId: user.id)
        
        // Create passkey
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: "hotelapp.com")
        let challengeData = Data(challenge.challenge.utf8)
        let userIdData = Data(user.id.utf8)
        
        let registrationRequest = provider.createCredentialRegistrationRequest(
            challenge: challengeData,
            name: user.email,
            userID: userIdData
        )
        
        // This will trigger the passkey UI
        // In a real implementation, you'd use ASAuthorizationController
        // For now, we'll simulate the flow
        
        throw AuthError.requiresUI
    }
    
    func loginWithPasskey() async throws -> User {
        guard #available(iOS 16.0, *) else {
            throw AuthError.passkeyNotSupported
        }
        
        // This would trigger passkey authentication
        throw AuthError.requiresUI
    }
    
    // MARK: - Two-Factor Authentication
    func enable2FA() async throws -> TwoFactorSetup {
        guard let user = currentUser else {
            throw AuthError.notAuthenticated
        }
        
        let setup = try await APIManager.shared.enable2FA(userId: user.id)
        return setup
    }
    
    func verify2FA(code: String) async throws -> Bool {
        guard let user = currentUser else {
            throw AuthError.notAuthenticated
        }
        
        let verification = TwoFactorVerification(code: code)
        let result = try await APIManager.shared.verify2FA(userId: user.id, verification: verification)
        
        // Update user
        if result {
            var updatedUser = user
            updatedUser.twoFactorEnabled = true
            self.currentUser = updatedUser
        }
        
        return result
    }
    
    func disable2FA(code: String) async throws -> Bool {
        guard let user = currentUser else {
            throw AuthError.notAuthenticated
        }
        
        let verification = TwoFactorVerification(code: code)
        let result = try await APIManager.shared.disable2FA(userId: user.id, verification: verification)
        
        if result {
            var updatedUser = user
            updatedUser.twoFactorEnabled = false
            self.currentUser = updatedUser
        }
        
        return result
    }
    
    // MARK: - eKYC Verification
    func submitEKYC(documentType: DocumentType, 
                    frontImage: Data, 
                    backImage: Data?, 
                    selfieImage: Data) async throws -> EKYCDocument {
        guard let user = currentUser, let guest = user.guest else {
            throw AuthError.notAuthenticated
        }
        
        let document = try await APIManager.shared.submitEKYC(
            guestId: guest.id,
            documentType: documentType,
            frontImage: frontImage,
            backImage: backImage,
            selfieImage: selfieImage
        )
        
        return document
    }
    
    func getEKYCStatus() async throws -> EKYCStatus {
        guard let user = currentUser, let guest = user.guest else {
            throw AuthError.notAuthenticated
        }
        
        let status = try await APIManager.shared.getEKYCStatus(guestId: guest.id)
        return status
    }
    
    // MARK: - Session Management
    func logout() {
        authToken = nil
        currentUser = nil
        clearStoredCredentials()
        
        NotificationCenter.default.post(name: NSNotification.Name("UserDidLogout"), object: nil)
    }
    
    func refreshSession() async throws {
        guard let refreshToken = loadRefreshToken() else {
            throw AuthError.noRefreshToken
        }
        
        let response = try await APIManager.shared.refreshToken(refreshToken: refreshToken)
        try await handleAuthResponse(response)
    }
    
    // MARK: - Private Methods
    private func handleAuthResponse(_ response: AuthResponse) async throws -> User {
        self.authToken = response.token
        self.currentUser = response.user
        
        saveCredentials(token: response.token, refreshToken: response.refreshToken)
        
        NotificationCenter.default.post(name: NSNotification.Name("UserDidLogin"), object: nil)
        
        return response.user
    }
    
    private func saveCredentials(token: String, refreshToken: String) {
        KeychainHelper.save(token, service: keychainService, account: tokenKey)
        KeychainHelper.save(refreshToken, service: keychainService, account: refreshTokenKey)
    }
    
    private func loadStoredCredentials() {
        if let token = KeychainHelper.load(service: keychainService, account: tokenKey) {
            self.authToken = token
            // In a real app, you'd validate the token with the server
        }
    }
    
    private func loadRefreshToken() -> String? {
        return KeychainHelper.load(service: keychainService, account: refreshTokenKey)
    }
    
    private func clearStoredCredentials() {
        KeychainHelper.delete(service: keychainService, account: tokenKey)
        KeychainHelper.delete(service: keychainService, account: refreshTokenKey)
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

// MARK: - Keychain Helper
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
