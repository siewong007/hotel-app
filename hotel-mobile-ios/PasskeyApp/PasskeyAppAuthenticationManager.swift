//
//  AuthenticationManager.swift
//  PasskeyApp
//
//  Created on December 7, 2025.
//

import Foundation
import AuthenticationServices
import OSLog

@MainActor
class AuthenticationManager: NSObject, ObservableObject {
    @Published var isAuthenticated = false
    @Published var currentUser: User?
    @Published var hasPasskey = false
    @Published var errorMessage: String?
    @Published var isLoading = false
    
    private let logger = Logger(subsystem: "com.passkeyapp", category: "Authentication")
    private let backendService = BackendService.shared
    
    // Check if user is authenticated and has passkey
    func checkAuthenticationStatus() async {
        // Check if user has existing passkey credentials
        hasPasskey = await checkForExistingPasskey()
        
        // Try to restore authenticated session
        if let savedUser = await backendService.getCurrentUser() {
            currentUser = savedUser
            isAuthenticated = true
        }
    }
    
    // Check if passkey exists for this device
    private func checkForExistingPasskey() async -> Bool {
        // Check with backend if user has registered passkeys
        do {
            let passkeyStatus = try await backendService.checkPasskeyStatus()
            return passkeyStatus.hasPasskey
        } catch {
            logger.error("Failed to check passkey status: \(error.localizedDescription)")
            return false
        }
    }
    
    // Sign in with passkey
    func signInWithPasskey() async {
        isLoading = true
        errorMessage = nil
        
        do {
            // Get challenge from backend
            let challenge = try await backendService.getAuthenticationChallenge()
            
            // Create passkey assertion request
            let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
                relyingPartyIdentifier: backendService.relyingPartyID
            )
            
            let assertionRequest = provider.createCredentialAssertionRequest(
                challenge: challenge
            )
            
            // Perform authentication
            let credential = try await performPasskeyAssertion(assertionRequest)
            
            // Send to backend for verification
            let user = try await backendService.verifyPasskeyAssertion(credential: credential)
            
            currentUser = user
            isAuthenticated = true
            hasPasskey = true
            
            logger.info("Successfully signed in with passkey")
            
        } catch {
            logger.error("Passkey sign in failed: \(error.localizedDescription)")
            errorMessage = "Failed to sign in with passkey. Please try again."
        }
        
        isLoading = false
    }
    
    // Register a new passkey
    func registerPasskey(username: String, displayName: String) async {
        isLoading = true
        errorMessage = nil
        
        do {
            // Get registration challenge from backend
            let registrationData = try await backendService.getRegistrationChallenge(
                username: username,
                displayName: displayName
            )
            
            // Create passkey registration request
            let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
                relyingPartyIdentifier: backendService.relyingPartyID
            )
            
            let registrationRequest = provider.createCredentialRegistrationRequest(
                challenge: registrationData.challenge,
                name: username,
                userID: registrationData.userID
            )
            
            // Configure request
            registrationRequest.userVerificationPreference = .required
            
            // Perform registration
            let credential = try await performPasskeyRegistration(registrationRequest)
            
            // Send to backend for storage
            let user = try await backendService.completePasskeyRegistration(
                credential: credential,
                username: username
            )
            
            currentUser = user
            isAuthenticated = true
            hasPasskey = true
            
            logger.info("Successfully registered passkey for user: \(username)")
            
        } catch {
            logger.error("Passkey registration failed: \(error.localizedDescription)")
            errorMessage = "Failed to register passkey. Please try again."
        }
        
        isLoading = false
    }
    
    // Perform passkey registration using AuthenticationServices
    private func performPasskeyRegistration(
        _ request: ASAuthorizationPlatformPublicKeyCredentialRegistrationRequest
    ) async throws -> ASAuthorizationPlatformPublicKeyCredentialRegistration {
        let controller = ASAuthorizationController(authorizationRequests: [request])
        let delegate = AuthorizationDelegate()
        controller.delegate = delegate
        controller.presentationContextProvider = delegate
        
        return try await withCheckedThrowingContinuation { continuation in
            delegate.registrationContinuation = continuation
            controller.performRequests()
        }
    }
    
    // Perform passkey assertion for sign in
    private func performPasskeyAssertion(
        _ request: ASAuthorizationPlatformPublicKeyCredentialAssertionRequest
    ) async throws -> ASAuthorizationPlatformPublicKeyCredentialAssertion {
        let controller = ASAuthorizationController(authorizationRequests: [request])
        let delegate = AuthorizationDelegate()
        controller.delegate = delegate
        controller.presentationContextProvider = delegate
        
        return try await withCheckedThrowingContinuation { continuation in
            delegate.assertionContinuation = continuation
            controller.performRequests()
        }
    }
    
    // Sign out
    func signOut() async {
        await backendService.signOut()
        currentUser = nil
        isAuthenticated = false
    }
}

// MARK: - Authorization Delegate
class AuthorizationDelegate: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    var registrationContinuation: CheckedContinuation<ASAuthorizationPlatformPublicKeyCredentialRegistration, Error>?
    var assertionContinuation: CheckedContinuation<ASAuthorizationPlatformPublicKeyCredentialAssertion, Error>?
    
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = windowScene.windows.first else {
            fatalError("No window available")
        }
        return window
    }
    
    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        switch authorization.credential {
        case let credential as ASAuthorizationPlatformPublicKeyCredentialRegistration:
            registrationContinuation?.resume(returning: credential)
            
        case let credential as ASAuthorizationPlatformPublicKeyCredentialAssertion:
            assertionContinuation?.resume(returning: credential)
            
        default:
            registrationContinuation?.resume(throwing: NSError(
                domain: "AuthenticationManager",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Unexpected credential type"]
            ))
            assertionContinuation?.resume(throwing: NSError(
                domain: "AuthenticationManager",
                code: -1,
                userInfo: [NSLocalizedDescriptionKey: "Unexpected credential type"]
            ))
        }
    }
    
    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        registrationContinuation?.resume(throwing: error)
        assertionContinuation?.resume(throwing: error)
    }
}
