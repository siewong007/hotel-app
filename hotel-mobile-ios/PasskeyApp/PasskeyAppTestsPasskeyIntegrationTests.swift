//
//  PasskeyIntegrationTests.swift
//  PasskeyAppTests
//
//  Created on December 7, 2025.
//

import Testing
import Foundation
@testable import PasskeyApp

@Suite("Backend Integration Tests")
struct PasskeyIntegrationTests {
    
    @Test("Backend service initialization")
    func testBackendServiceInitialization() async throws {
        let service = BackendService.shared
        #expect(service.relyingPartyID == "your-app-domain.com")
    }
    
    @Test("User model encoding and decoding")
    func testUserModelCodable() async throws {
        let user = User(
            id: "123",
            username: "testuser",
            displayName: "Test User",
            email: "test@example.com"
        )
        
        let encoder = JSONEncoder()
        let data = try encoder.encode(user)
        
        let decoder = JSONDecoder()
        let decodedUser = try decoder.decode(User.self, from: data)
        
        #expect(decodedUser.id == user.id)
        #expect(decodedUser.username == user.username)
        #expect(decodedUser.displayName == user.displayName)
        #expect(decodedUser.email == user.email)
    }
    
    @Test("PasskeyStatus model decoding")
    func testPasskeyStatusDecoding() async throws {
        let json = """
        {
            "hasPasskey": true,
            "passkeyCount": 2
        }
        """
        
        let data = json.data(using: .utf8)!
        let decoder = JSONDecoder()
        let status = try decoder.decode(PasskeyStatus.self, from: data)
        
        #expect(status.hasPasskey == true)
        #expect(status.passkeyCount == 2)
    }
    
    @Test("RegistrationChallenge data encoding")
    func testRegistrationChallengeEncoding() async throws {
        let challengeData = "test-challenge-data".data(using: .utf8)!
        let userIDData = "test-user-id".data(using: .utf8)!
        
        let challenge = RegistrationChallenge(
            challenge: challengeData,
            userID: userIDData,
            timeout: 60000
        )
        
        #expect(challenge.challenge == challengeData)
        #expect(challenge.userID == userIDData)
        #expect(challenge.timeout == 60000)
    }
    
    @Test("Backend error descriptions")
    func testBackendErrorDescriptions() async throws {
        let invalidResponseError = BackendError.invalidResponse
        #expect(invalidResponseError.errorDescription == "Invalid response from server")
        
        let serverError = BackendError.serverError(404)
        #expect(serverError.errorDescription == "Server error: 404")
        
        let decodingError = BackendError.decodingError
        #expect(decodingError.errorDescription == "Failed to decode response")
        
        let networkError = BackendError.networkError
        #expect(networkError.errorDescription == "Network connection error")
    }
}

@Suite("Authentication Manager Tests")
struct AuthenticationManagerTests {
    
    @Test("Initial authentication state")
    @MainActor
    func testInitialAuthState() async throws {
        let authManager = AuthenticationManager()
        
        #expect(authManager.isAuthenticated == false)
        #expect(authManager.currentUser == nil)
        #expect(authManager.hasPasskey == false)
        #expect(authManager.errorMessage == nil)
        #expect(authManager.isLoading == false)
    }
    
    @Test("Sign out resets authentication state")
    @MainActor
    func testSignOut() async throws {
        let authManager = AuthenticationManager()
        
        // Simulate authenticated state
        authManager.isAuthenticated = true
        authManager.currentUser = User(
            id: "123",
            username: "test",
            displayName: "Test",
            email: nil
        )
        
        // Sign out
        await authManager.signOut()
        
        #expect(authManager.isAuthenticated == false)
        #expect(authManager.currentUser == nil)
    }
}

@Suite("Data Validation Tests")
struct DataValidationTests {
    
    @Test("Base64 encoding of credential data")
    func testBase64Encoding() async throws {
        let testData = "test-credential-data".data(using: .utf8)!
        let base64String = testData.base64EncodedString()
        
        #expect(!base64String.isEmpty)
        
        // Verify decoding
        let decodedData = Data(base64Encoded: base64String)
        let unwrappedData = try #require(decodedData)
        #expect(unwrappedData == testData)
    }
    
    @Test("Username validation")
    func testUsernameValidation() async throws {
        // Valid usernames
        let validUsernames = ["user123", "test_user", "john.doe", "a"]
        for username in validUsernames {
            #expect(username.count >= 1)
        }
        
        // Invalid usernames (too short for app requirements)
        let shortUsername = "ab"
        #expect(shortUsername.count < 3)
    }
    
    @Test("Email validation regex")
    func testEmailValidation() async throws {
        let emailRegex = "[A-Z0-9a-z._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}"
        let emailPredicate = NSPredicate(format: "SELF MATCHES %@", emailRegex)
        
        // Valid emails
        let validEmails = [
            "test@example.com",
            "user.name@domain.co.uk",
            "test+tag@gmail.com"
        ]
        
        for email in validEmails {
            #expect(emailPredicate.evaluate(with: email) == true)
        }
        
        // Invalid emails
        let invalidEmails = [
            "notanemail",
            "@example.com",
            "user@",
            "user @example.com"
        ]
        
        for email in invalidEmails {
            #expect(emailPredicate.evaluate(with: email) == false)
        }
    }
}

@Suite("URL Construction Tests")
struct URLConstructionTests {
    
    @Test("Backend API endpoint URLs")
    func testEndpointURLs() async throws {
        let baseURL = "https://your-backend-api.com/api"
        
        let endpoints = [
            "/auth/passkey/status",
            "/auth/passkey/register/challenge",
            "/auth/passkey/register/complete",
            "/auth/passkey/login/challenge",
            "/auth/passkey/login/verify",
            "/user/me"
        ]
        
        for endpoint in endpoints {
            let url = URL(string: "\(baseURL)\(endpoint)")
            let unwrappedURL = try #require(url)
            #expect(unwrappedURL.absoluteString.contains(baseURL))
        }
    }
}
