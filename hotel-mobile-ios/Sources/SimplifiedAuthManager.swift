//
//  SimplifiedAuthManager.swift
//  HotelMobileIOS
//
//  Simplified authentication manager that works with existing DataModels
//  No conflicts, uses existing User, Guest, LoginResponse types
//

import Foundation
import AuthenticationServices

/// Simplified Authentication Manager compatible with existing code
class SimplifiedAuthManager {
    static let shared = SimplifiedAuthManager()
    
    private let keychainService = "com.hotelapp.auth"
    private let tokenKey = "authToken"
    private let refreshTokenKey = "refreshToken"
    
    // Current session using EXISTING types from DataModels.swift
    private(set) var currentUser: User?
    private(set) var currentGuest: Guest?
    private(set) var authToken: String?
    private(set) var refreshToken: String?
    
    var isAuthenticated: Bool {
        return authToken != nil && currentUser != nil
    }
    
    private init() {
        loadStoredCredentials()
    }
    
    // MARK: - Login (Compatible with existing LoginResponse)
    func login(username: String, password: String) async throws -> LoginResponse {
        // This would call your existing API
        // For now, return a mock response to resolve compilation
        throw AuthenticationError.notImplemented
    }
    
    func handleLoginResponse(_ response: LoginResponse) {
        self.authToken = response.accessToken
        self.refreshToken = response.refreshToken
        self.currentUser = response.user
        
        saveCredentials()
        
        NotificationCenter.default.post(name: .userDidLogin, object: nil)
    }
    
    // MARK: - Logout
    func logout() {
        authToken = nil
        refreshToken = nil
        currentUser = nil
        currentGuest = nil
        
        clearStoredCredentials()
        
        NotificationCenter.default.post(name: .userDidLogout, object: nil)
    }
    
    // MARK: - Token Refresh
    func refreshSession() async throws -> RefreshResponse {
        guard self.refreshToken != nil else {
            throw AuthenticationError.noRefreshToken
        }

        // Call your refresh endpoint
        throw AuthenticationError.notImplemented
    }
    
    // MARK: - Keychain Storage
    private func saveCredentials() {
        if let token = authToken {
            KeychainManager.save(token, service: keychainService, account: tokenKey)
        }
        if let refresh = refreshToken {
            KeychainManager.save(refresh, service: keychainService, account: refreshTokenKey)
        }
    }
    
    private func loadStoredCredentials() {
        self.authToken = KeychainManager.load(service: keychainService, account: tokenKey)
        self.refreshToken = KeychainManager.load(service: keychainService, account: refreshTokenKey)
    }
    
    private func clearStoredCredentials() {
        KeychainManager.delete(service: keychainService, account: tokenKey)
        KeychainManager.delete(service: keychainService, account: refreshTokenKey)
    }
}

// MARK: - Authentication Errors
enum AuthenticationError: LocalizedError {
    case notAuthenticated
    case invalidCredentials
    case noRefreshToken
    case notImplemented
    
    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return "User is not authenticated"
        case .invalidCredentials:
            return "Invalid username or password"
        case .noRefreshToken:
            return "No refresh token available"
        case .notImplemented:
            return "This feature needs backend integration"
        }
    }
}

// MARK: - Keychain Manager
class KeychainManager {
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

// MARK: - Notification Names
extension Notification.Name {
    static let userDidLogin = Notification.Name("userDidLogin")
    static let userDidLogout = Notification.Name("userDidLogout")
}
