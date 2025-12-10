//
//  BackendService.swift
//  PasskeyApp
//
//  Created on December 7, 2025.
//

import Foundation
import AuthenticationServices

struct User: Codable, Identifiable {
    let id: String
    let username: String
    let displayName: String
    let email: String?
}

struct PasskeyStatus: Codable {
    let hasPasskey: Bool
    let passkeyCount: Int
}

struct RegistrationChallenge: Codable {
    let challenge: Data
    let userID: Data
    let timeout: Int
}

struct AuthenticationChallenge: Codable {
    let challenge: Data
    let timeout: Int
}

actor BackendService {
    static let shared = BackendService()
    
    // TODO: Update with your backend URL
    private let baseURL = "https://your-backend-api.com/api"
    let relyingPartyID = "your-app-domain.com"
    
    private let session: URLSession
    private var authToken: String?
    
    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        self.session = URLSession(configuration: config)
        
        // Load saved auth token
        self.authToken = UserDefaults.standard.string(forKey: "authToken")
    }
    
    // MARK: - Authentication Status
    
    func checkPasskeyStatus() async throws -> PasskeyStatus {
        let url = URL(string: "\(baseURL)/auth/passkey/status")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        addAuthHeaders(to: &request)
        
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw BackendError.invalidResponse
        }
        
        guard httpResponse.statusCode == 200 else {
            throw BackendError.serverError(httpResponse.statusCode)
        }
        
        return try JSONDecoder().decode(PasskeyStatus.self, from: data)
    }
    
    func getCurrentUser() async -> User? {
        guard authToken != nil else { return nil }
        
        do {
            let url = URL(string: "\(baseURL)/user/me")!
            var request = URLRequest(url: url)
            request.httpMethod = "GET"
            addAuthHeaders(to: &request)
            
            let (data, response) = try await session.data(for: request)
            
            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 else {
                return nil
            }
            
            return try JSONDecoder().decode(User.self, from: data)
        } catch {
            return nil
        }
    }
    
    // MARK: - Passkey Registration
    
    func getRegistrationChallenge(username: String, displayName: String) async throws -> RegistrationChallenge {
        let url = URL(string: "\(baseURL)/auth/passkey/register/challenge")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = [
            "username": username,
            "displayName": displayName
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw BackendError.invalidResponse
        }
        
        guard httpResponse.statusCode == 200 else {
            throw BackendError.serverError(httpResponse.statusCode)
        }
        
        // Parse the challenge response
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        
        guard let challengeString = json["challenge"] as? String,
              let challengeData = Data(base64Encoded: challengeString),
              let userIDString = json["userID"] as? String,
              let userIDData = Data(base64Encoded: userIDString) else {
            throw BackendError.invalidResponse
        }
        
        return RegistrationChallenge(
            challenge: challengeData,
            userID: userIDData,
            timeout: json["timeout"] as? Int ?? 60000
        )
    }
    
    func completePasskeyRegistration(
        credential: ASAuthorizationPlatformPublicKeyCredentialRegistration,
        username: String
    ) async throws -> User {
        let url = URL(string: "\(baseURL)/auth/passkey/register/complete")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        // Encode credential data
        let body: [String: Any] = [
            "username": username,
            "credentialID": credential.credentialID.base64EncodedString(),
            "attestationObject": credential.rawAttestationObject?.base64EncodedString() ?? "",
            "clientDataJSON": credential.rawClientDataJSON.base64EncodedString()
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw BackendError.invalidResponse
        }
        
        guard httpResponse.statusCode == 200 else {
            throw BackendError.serverError(httpResponse.statusCode)
        }
        
        // Parse response and extract auth token
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        if let token = json["token"] as? String {
            await saveAuthToken(token)
        }
        
        let userData = try JSONDecoder().decode(User.self, from: data)
        return userData
    }
    
    // MARK: - Passkey Authentication
    
    func getAuthenticationChallenge() async throws -> Data {
        let url = URL(string: "\(baseURL)/auth/passkey/login/challenge")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw BackendError.invalidResponse
        }
        
        guard httpResponse.statusCode == 200 else {
            throw BackendError.serverError(httpResponse.statusCode)
        }
        
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        guard let challengeString = json["challenge"] as? String,
              let challengeData = Data(base64Encoded: challengeString) else {
            throw BackendError.invalidResponse
        }
        
        return challengeData
    }
    
    func verifyPasskeyAssertion(
        credential: ASAuthorizationPlatformPublicKeyCredentialAssertion
    ) async throws -> User {
        let url = URL(string: "\(baseURL)/auth/passkey/login/verify")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        // Encode assertion data
        let body: [String: Any] = [
            "credentialID": credential.credentialID.base64EncodedString(),
            "authenticatorData": credential.rawAuthenticatorData.base64EncodedString(),
            "signature": credential.signature.base64EncodedString(),
            "clientDataJSON": credential.rawClientDataJSON.base64EncodedString(),
            "userID": credential.userID.base64EncodedString()
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw BackendError.invalidResponse
        }
        
        guard httpResponse.statusCode == 200 else {
            throw BackendError.serverError(httpResponse.statusCode)
        }
        
        // Parse response and extract auth token
        let json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        if let token = json["token"] as? String {
            await saveAuthToken(token)
        }
        
        let userData = try JSONDecoder().decode(User.self, from: data)
        return userData
    }
    
    // MARK: - Sign Out
    
    func signOut() async {
        authToken = nil
        UserDefaults.standard.removeObject(forKey: "authToken")
    }
    
    // MARK: - Helper Methods
    
    private func addAuthHeaders(to request: inout URLRequest) {
        if let token = authToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.setValue("application/json", forHTTPHeaderField: "Accept")
    }
    
    private func saveAuthToken(_ token: String) async {
        authToken = token
        UserDefaults.standard.set(token, forKey: "authToken")
    }
}

// MARK: - Errors

enum BackendError: LocalizedError {
    case invalidResponse
    case serverError(Int)
    case decodingError
    case networkError
    
    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid response from server"
        case .serverError(let code):
            return "Server error: \(code)"
        case .decodingError:
            return "Failed to decode response"
        case .networkError:
            return "Network connection error"
        }
    }
}
