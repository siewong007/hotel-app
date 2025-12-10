import Foundation

enum AppConfiguration {
    // MARK: - API Configuration
    
    /// Base URL for the backend API
    /// Default: http://localhost:8080
    /// Production: Set via environment variable API_BASE_URL
    static var apiBaseURL: String {
        ProcessInfo.processInfo.environment["API_BASE_URL"] ?? "http://localhost:8080"
    }
    
    /// Relying Party ID for Passkey authentication
    /// This should match your domain (e.g., "example.com")
    /// Must be set via environment variable RELYING_PARTY_ID
    static var relyingPartyId: String {
        ProcessInfo.processInfo.environment["RELYING_PARTY_ID"] ?? "example.com"
    }
    
    /// Relying Party Name for Passkey authentication
    static var relyingPartyName: String {
        ProcessInfo.processInfo.environment["RELYING_PARTY_NAME"] ?? "Passkey Auth App"
    }
    
    // MARK: - Feature Flags
    
    /// Enable debug logging
    static var isDebugMode: Bool {
        #if DEBUG
        return true
        #else
        return ProcessInfo.processInfo.environment["DEBUG_MODE"] == "true"
        #endif
    }
    
    /// Force passkey registration prompt
    static var forcePasskeyPrompt: Bool {
        ProcessInfo.processInfo.environment["FORCE_PASSKEY_PROMPT"] == "true"
    }
}
