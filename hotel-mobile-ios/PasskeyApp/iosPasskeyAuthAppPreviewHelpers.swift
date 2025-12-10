import SwiftUI

/// Preview helpers for development
extension PreviewProvider {
    
    /// Creates a mock AuthenticationManager for previews
    static var mockAuthManager: AuthenticationManager {
        let manager = AuthenticationManager.shared
        return manager
    }
    
    /// Creates a mock authenticated user
    static var mockUser: User {
        User(
            id: "preview_user_123",
            username: "previewuser",
            email: "preview@example.com",
            displayName: "Preview User",
            hasPasskey: false,
            createdAt: "2024-01-01T00:00:00Z"
        )
    }
    
    /// Creates a mock user with passkey
    static var mockUserWithPasskey: User {
        User(
            id: "preview_user_456",
            username: "passkeyuser",
            email: "passkey@example.com",
            displayName: "Passkey User",
            hasPasskey: true,
            createdAt: "2024-01-01T00:00:00Z"
        )
    }
}

// MARK: - Preview Containers

/// Container view for previews with environment setup
struct PreviewContainer<Content: View>: View {
    let content: Content
    
    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }
    
    var body: some View {
        content
            .environmentObject(AuthenticationManager.shared)
    }
}

// MARK: - Mock Data for Development

#if DEBUG
extension AuthenticationManager {
    /// Configure mock authenticated state for previews
    func mockAuthenticate(withPasskey: Bool = false) {
        self.isAuthenticated = true
        self.currentUser = User(
            id: "mock_user",
            username: "mockuser",
            email: "mock@example.com",
            displayName: "Mock User",
            hasPasskey: withPasskey,
            createdAt: "2024-01-01T00:00:00Z"
        )
    }
    
    /// Reset to unauthenticated state
    func mockReset() {
        self.isAuthenticated = false
        self.currentUser = nil
        self.errorMessage = nil
        self.isLoading = false
    }
}
#endif

// MARK: - Preview Examples

#Preview("Authentication View - Sign In") {
    PreviewContainer {
        AuthenticationView()
    }
}

#Preview("Main View - No Passkey") {
    PreviewContainer {
        let manager = AuthenticationManager.shared
        let _ = manager.mockAuthenticate(withPasskey: false)
        return MainAppView()
    }
}

#Preview("Main View - With Passkey") {
    PreviewContainer {
        let manager = AuthenticationManager.shared
        let _ = manager.mockAuthenticate(withPasskey: true)
        return MainAppView()
    }
}

#Preview("Passkey Registration Modal") {
    PreviewContainer {
        PasskeyRegistrationView()
    }
}

#Preview("Passkey Prompt Card") {
    PreviewContainer {
        PasskeyPromptCard()
            .padding()
    }
}

#Preview("Sign In Form Only") {
    PreviewContainer {
        SignInForm()
    }
}

#Preview("Sign Up Form Only") {
    PreviewContainer {
        SignUpForm()
    }
}

#Preview("Passkey Button") {
    PreviewContainer {
        SignInWithPasskeyButton()
            .padding()
    }
}
