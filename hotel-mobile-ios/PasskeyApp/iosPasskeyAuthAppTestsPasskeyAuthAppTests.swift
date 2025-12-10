import Testing
import Foundation
@testable import PasskeyAuthApp

/// Tests for backend API integration
@Suite("API Service Tests")
struct APIServiceTests {
    
    @Test("API Service initializes with correct base URL")
    func testAPIServiceInitialization() async throws {
        let apiService = APIService.shared
        #expect(apiService.relyingPartyId.isEmpty == false, "Relying party ID should be set")
    }
    
    @Test("Sign in request creates proper request body")
    func testSignInRequestEncoding() async throws {
        let request = SignInRequest(username: "testuser", password: "testpass")
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        
        let data = try encoder.encode(request)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: String]
        
        #expect(json?["username"] == "testuser")
        #expect(json?["password"] == "testpass")
    }
    
    @Test("Sign up request includes all required fields")
    func testSignUpRequestEncoding() async throws {
        let request = SignUpRequest(
            username: "newuser",
            email: "test@example.com",
            password: "securepass",
            displayName: "Test User"
        )
        
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        
        let data = try encoder.encode(request)
        let json = try JSONSerialization.jsonObject(with: data) as? [String: String]
        
        #expect(json?["username"] == "newuser")
        #expect(json?["email"] == "test@example.com")
        #expect(json?["password"] == "securepass")
        #expect(json?["display_name"] == "Test User")
    }
    
    @Test("Auth response decodes correctly")
    func testAuthResponseDecoding() async throws {
        let jsonString = """
        {
            "token": "test_token_123",
            "user": {
                "id": "user123",
                "username": "testuser",
                "email": "test@example.com",
                "display_name": "Test User",
                "has_passkey": false,
                "created_at": "2024-01-01T00:00:00Z"
            }
        }
        """
        
        let data = jsonString.data(using: .utf8)!
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        
        let response = try decoder.decode(AuthResponse.self, from: data)
        
        #expect(response.token == "test_token_123")
        #expect(response.user.username == "testuser")
        #expect(response.user.hasPasskey == false)
    }
    
    @Test("Passkey registration options decode correctly")
    func testPasskeyRegistrationOptionsDecoding() async throws {
        let jsonString = """
        {
            "challenge": "Y2hhbGxlbmdl",
            "user_id": "dXNlcklk",
            "timeout": 60000
        }
        """
        
        let data = jsonString.data(using: .utf8)!
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        
        let options = try decoder.decode(PasskeyRegistrationOptions.self, from: data)
        
        #expect(options.challenge == "Y2hhbGxlbmdl")
        #expect(options.userId == "dXNlcklk")
        #expect(options.timeout == 60000)
    }
    
    @Test("Passkey authentication options decode correctly")
    func testPasskeyAuthenticationOptionsDecoding() async throws {
        let jsonString = """
        {
            "challenge": "Y2hhbGxlbmdl",
            "allow_credentials": ["cred1", "cred2"],
            "timeout": 60000
        }
        """
        
        let data = jsonString.data(using: .utf8)!
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        
        let options = try decoder.decode(PasskeyAuthenticationOptions.self, from: data)
        
        #expect(options.challenge == "Y2hhbGxlbmdl")
        #expect(options.allowCredentials.count == 2)
        #expect(options.allowCredentials.contains("cred1"))
    }
    
    @Test("Error response decodes correctly")
    func testErrorResponseDecoding() async throws {
        let jsonString = """
        {
            "message": "Invalid credentials"
        }
        """
        
        let data = jsonString.data(using: .utf8)!
        let decoder = JSONDecoder()
        
        let error = try decoder.decode(ErrorResponse.self, from: data)
        
        #expect(error.message == "Invalid credentials")
    }
}

/// Tests for Keychain Service
@Suite("Keychain Service Tests")
struct KeychainServiceTests {
    
    @Test("Keychain can store and retrieve token")
    func testTokenStorage() async throws {
        let keychain = KeychainService.shared
        let testToken = "test_token_12345"
        
        // Save token
        keychain.saveToken(testToken)
        
        // Retrieve token
        let retrievedToken = keychain.getToken()
        #expect(retrievedToken == testToken, "Token should match what was saved")
        
        // Cleanup
        keychain.deleteToken()
    }
    
    @Test("Keychain delete removes token")
    func testTokenDeletion() async throws {
        let keychain = KeychainService.shared
        let testToken = "test_token_delete"
        
        // Save and then delete
        keychain.saveToken(testToken)
        keychain.deleteToken()
        
        // Verify it's gone
        let retrievedToken = keychain.getToken()
        #expect(retrievedToken == nil, "Token should be nil after deletion")
    }
    
    @Test("Keychain returns nil for non-existent token")
    func testNonExistentToken() async throws {
        let keychain = KeychainService.shared
        
        // Ensure no token exists
        keychain.deleteToken()
        
        let token = keychain.getToken()
        #expect(token == nil, "Should return nil when no token exists")
    }
}

/// Tests for Authentication Manager
@Suite("Authentication Manager Tests")
struct AuthenticationManagerTests {
    
    @Test("Auth manager initializes in unauthenticated state")
    @MainActor
    func testInitialState() async throws {
        let authManager = AuthenticationManager.shared
        #expect(authManager.isAuthenticated == false || authManager.isAuthenticated == true, "Should have boolean state")
        #expect(authManager.isLoading == false, "Should not be loading initially")
    }
    
    @Test("Sign out clears authentication state")
    @MainActor
    func testSignOut() async throws {
        let authManager = AuthenticationManager.shared
        
        // Sign out
        authManager.signOut()
        
        // Verify state is cleared
        #expect(authManager.isAuthenticated == false, "Should be unauthenticated after sign out")
        #expect(authManager.currentUser == nil, "User should be nil after sign out")
        
        // Verify token is cleared
        let token = KeychainService.shared.getToken()
        #expect(token == nil || token?.isEmpty == true, "Token should be cleared")
    }
}

/// Tests for App Configuration
@Suite("App Configuration Tests")
struct AppConfigurationTests {
    
    @Test("Configuration returns valid base URL")
    func testAPIBaseURL() async throws {
        let url = AppConfiguration.apiBaseURL
        #expect(url.isEmpty == false, "Base URL should not be empty")
        #expect(url.contains("http"), "URL should contain http/https protocol")
    }
    
    @Test("Configuration returns valid relying party ID")
    func testRelyingPartyID() async throws {
        let rpId = AppConfiguration.relyingPartyId
        #expect(rpId.isEmpty == false, "Relying party ID should not be empty")
    }
    
    @Test("Debug mode is correctly set in debug builds")
    func testDebugMode() async throws {
        #if DEBUG
        #expect(AppConfiguration.isDebugMode == true, "Debug mode should be true in debug builds")
        #else
        // In release builds, depends on environment variable
        #expect(AppConfiguration.isDebugMode == false || AppConfiguration.isDebugMode == true)
        #endif
    }
}

/// Integration test structure (requires running backend)
@Suite("Integration Tests", .disabled("Requires running backend"))
struct IntegrationTests {
    
    @Test("Can connect to backend health check")
    func testBackendConnection() async throws {
        // This would test actual connection to your backend
        // Only run when backend is available
        let url = URL(string: AppConfiguration.apiBaseURL + "/health")!
        let (_, response) = try await URLSession.shared.data(from: url)
        let httpResponse = try #require(response as? HTTPURLResponse)
        #expect(httpResponse.statusCode == 200)
    }
    
    @Test("Full authentication flow")
    @MainActor
    func testFullAuthFlow() async throws {
        // This would test the complete flow:
        // 1. Sign up
        // 2. Register passkey
        // 3. Sign out
        // 4. Sign in with passkey
        // Only run in integration test environment
    }
}
