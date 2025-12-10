import Foundation
import AuthenticationServices
import Combine

@MainActor
class AuthenticationManager: NSObject, ObservableObject {
    static let shared = AuthenticationManager()
    
    @Published var isAuthenticated = false
    @Published var currentUser: User?
    @Published var isLoading = false
    @Published var errorMessage: String?
    
    private let apiService = APIService.shared
    private var cancellables = Set<AnyCancellable>()
    
    private override init() {
        super.init()
        checkStoredCredentials()
    }
    
    // MARK: - Authentication State
    
    private func checkStoredCredentials() {
        // Check if we have a valid session token
        if let token = KeychainService.shared.getToken(), !token.isEmpty {
            Task {
                await validateSession()
            }
        }
    }
    
    func validateSession() async {
        isLoading = true
        defer { isLoading = false }
        
        do {
            let user = try await apiService.getCurrentUser()
            self.currentUser = user
            self.isAuthenticated = true
        } catch {
            // Session expired or invalid
            KeychainService.shared.deleteToken()
            self.isAuthenticated = false
            self.currentUser = nil
        }
    }
    
    // MARK: - Traditional Login
    
    func signIn(username: String, password: String) async throws {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        
        do {
            let response = try await apiService.signIn(username: username, password: password)
            
            // Store token
            KeychainService.shared.saveToken(response.token)
            
            // Update state
            self.currentUser = response.user
            self.isAuthenticated = true
            
            // Check if user needs to register passkey
            if !response.user.hasPasskey {
                // The UI will prompt them
                print("User should register a passkey")
            }
        } catch {
            errorMessage = error.localizedDescription
            throw error
        }
    }
    
    // MARK: - Passkey Registration
    
    func registerPasskey() async throws {
        guard let user = currentUser else {
            throw AuthError.notAuthenticated
        }
        
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        
        do {
            // Step 1: Request registration options from server
            let options = try await apiService.getPasskeyRegistrationOptions()
            
            // Step 2: Create passkey using AuthenticationServices
            let credential = try await createPasskey(
                challenge: options.challenge,
                userId: options.userId,
                username: user.username,
                displayName: user.displayName
            )
            
            // Step 3: Send credential to server for verification
            let updatedUser = try await apiService.verifyPasskeyRegistration(
                credentialId: credential.credentialID.base64EncodedString(),
                clientDataJSON: credential.rawClientDataJSON.base64EncodedString(),
                attestationObject: credential.rawAttestationObject?.base64EncodedString() ?? ""
            )
            
            // Update user state
            self.currentUser = updatedUser
            
        } catch {
            errorMessage = error.localizedDescription
            throw error
        }
    }
    
    private func createPasskey(
        challenge: String,
        userId: String,
        username: String,
        displayName: String
    ) async throws -> ASAuthorizationPlatformPublicKeyCredentialRegistration {
        
        guard let challengeData = Data(base64Encoded: challenge),
              let userIdData = Data(base64Encoded: userId) else {
            throw AuthError.invalidData
        }
        
        let platformProvider = ASAuthorizationPlatformPublicKeyCredentialProvider(
            relyingPartyIdentifier: apiService.relyingPartyId
        )
        
        let registrationRequest = platformProvider.createCredentialRegistrationRequest(
            challenge: challengeData,
            name: username,
            userID: userIdData
        )
        
        let authController = ASAuthorizationController(authorizationRequests: [registrationRequest])
        let delegate = PasskeyRegistrationDelegate()
        
        return try await withCheckedThrowingContinuation { continuation in
            delegate.continuation = continuation
            authController.delegate = delegate
            authController.presentationContextProvider = self
            authController.performRequests()
        }
    }
    
    // MARK: - Passkey Sign In
    
    func signInWithPasskey() async throws {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        
        do {
            // Step 1: Request authentication options from server
            let options = try await apiService.getPasskeyAuthenticationOptions()
            
            // Step 2: Authenticate with passkey
            let assertion = try await authenticateWithPasskey(
                challenge: options.challenge,
                credentialIds: options.allowCredentials
            )
            
            // Step 3: Send assertion to server for verification
            let response = try await apiService.verifyPasskeyAuthentication(
                credentialId: assertion.credentialID.base64EncodedString(),
                clientDataJSON: assertion.rawClientDataJSON.base64EncodedString(),
                authenticatorData: assertion.rawAuthenticatorData.base64EncodedString(),
                signature: assertion.signature.base64EncodedString(),
                userHandle: assertion.userID.base64EncodedString()
            )
            
            // Store token
            KeychainService.shared.saveToken(response.token)
            
            // Update state
            self.currentUser = response.user
            self.isAuthenticated = true
            
        } catch {
            errorMessage = error.localizedDescription
            throw error
        }
    }
    
    private func authenticateWithPasskey(
        challenge: String,
        credentialIds: [String]
    ) async throws -> ASAuthorizationPlatformPublicKeyCredentialAssertion {
        
        guard let challengeData = Data(base64Encoded: challenge) else {
            throw AuthError.invalidData
        }
        
        let platformProvider = ASAuthorizationPlatformPublicKeyCredentialProvider(
            relyingPartyIdentifier: apiService.relyingPartyId
        )
        
        let assertionRequest = platformProvider.createCredentialAssertionRequest(
            challenge: challengeData
        )
        
        let authController = ASAuthorizationController(authorizationRequests: [assertionRequest])
        let delegate = PasskeyAuthenticationDelegate()
        
        return try await withCheckedThrowingContinuation { continuation in
            delegate.continuation = continuation
            authController.delegate = delegate
            authController.presentationContextProvider = self
            authController.performRequests()
        }
    }
    
    // MARK: - Sign Out
    
    func signOut() {
        KeychainService.shared.deleteToken()
        currentUser = nil
        isAuthenticated = false
    }
}

// MARK: - ASAuthorizationControllerPresentationContextProviding

extension AuthenticationManager: ASAuthorizationControllerPresentationContextProviding {
    nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        guard let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = windowScene.windows.first else {
            fatalError("No window available")
        }
        return window
    }
}

// MARK: - Passkey Delegates

private class PasskeyRegistrationDelegate: NSObject, ASAuthorizationControllerDelegate {
    var continuation: CheckedContinuation<ASAuthorizationPlatformPublicKeyCredentialRegistration, Error>?
    
    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        if let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration {
            continuation?.resume(returning: credential)
        } else {
            continuation?.resume(throwing: AuthError.invalidCredential)
        }
    }
    
    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        continuation?.resume(throwing: error)
    }
}

private class PasskeyAuthenticationDelegate: NSObject, ASAuthorizationControllerDelegate {
    var continuation: CheckedContinuation<ASAuthorizationPlatformPublicKeyCredentialAssertion, Error>?
    
    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        if let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion {
            continuation?.resume(returning: credential)
        } else {
            continuation?.resume(throwing: AuthError.invalidCredential)
        }
    }
    
    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        continuation?.resume(throwing: error)
    }
}

// MARK: - Error Types

enum AuthError: LocalizedError {
    case notAuthenticated
    case invalidData
    case invalidCredential
    case networkError
    
    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return "User is not authenticated"
        case .invalidData:
            return "Invalid data received"
        case .invalidCredential:
            return "Invalid credential"
        case .networkError:
            return "Network error occurred"
        }
    }
}
