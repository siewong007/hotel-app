import SwiftUI
import AuthenticationServices

struct AuthenticationView: View {
    @EnvironmentObject var authManager: AuthenticationManager
    @State private var isSignUp = false
    
    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                // Logo/Header
                VStack(spacing: 8) {
                    Image(systemName: "key.fill")
                        .font(.system(size: 60))
                        .foregroundStyle(.blue)
                    
                    Text("Passkey Authentication")
                        .font(.title)
                        .bold()
                    
                    Text("Secure login with passkeys")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 40)
                
                Spacer()
                
                // Passkey Sign In Button
                SignInWithPasskeyButton()
                    .padding(.horizontal)
                
                Divider()
                    .padding(.horizontal)
                
                // Traditional Auth Toggle
                if isSignUp {
                    SignUpForm()
                } else {
                    SignInForm()
                }
                
                // Toggle between sign in and sign up
                Button {
                    withAnimation {
                        isSignUp.toggle()
                    }
                } label: {
                    Text(isSignUp ? "Already have an account? Sign In" : "Don't have an account? Sign Up")
                        .font(.subheadline)
                }
                .padding(.bottom, 20)
                
                if authManager.isLoading {
                    ProgressView()
                        .padding()
                }
                
                if let errorMessage = authManager.errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }
                
                Spacer()
            }
            .navigationBarHidden(true)
        }
    }
}

struct SignInWithPasskeyButton: View {
    @EnvironmentObject var authManager: AuthenticationManager
    
    var body: some View {
        Button {
            Task {
                do {
                    try await authManager.signInWithPasskey()
                } catch {
                    print("Passkey sign in failed: \(error)")
                }
            }
        } label: {
            HStack {
                Image(systemName: "person.badge.key.fill")
                Text("Sign in with Passkey")
                    .fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
            .padding()
            .background(Color.blue)
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .disabled(authManager.isLoading)
    }
}

struct SignInForm: View {
    @EnvironmentObject var authManager: AuthenticationManager
    @State private var username = ""
    @State private var password = ""
    
    var body: some View {
        VStack(spacing: 16) {
            TextField("Username", text: $username)
                .textContentType(.username)
                .autocapitalization(.none)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal)
            
            SecureField("Password", text: $password)
                .textContentType(.password)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal)
            
            Button {
                Task {
                    do {
                        try await authManager.signIn(username: username, password: password)
                    } catch {
                        print("Sign in failed: \(error)")
                    }
                }
            } label: {
                Text("Sign In")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.green)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .disabled(username.isEmpty || password.isEmpty || authManager.isLoading)
            .padding(.horizontal)
        }
    }
}

struct SignUpForm: View {
    @EnvironmentObject var authManager: AuthenticationManager
    @State private var username = ""
    @State private var email = ""
    @State private var displayName = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    
    var body: some View {
        VStack(spacing: 16) {
            TextField("Username", text: $username)
                .textContentType(.username)
                .autocapitalization(.none)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal)
            
            TextField("Email", text: $email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .autocapitalization(.none)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal)
            
            TextField("Display Name", text: $displayName)
                .textContentType(.name)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal)
            
            SecureField("Password", text: $password)
                .textContentType(.newPassword)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal)
            
            SecureField("Confirm Password", text: $confirmPassword)
                .textContentType(.newPassword)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal)
            
            Button {
                Task {
                    do {
                        let response = try await APIService.shared.signUp(
                            username: username,
                            email: email,
                            password: password,
                            displayName: displayName
                        )
                        
                        // Save token and update auth state
                        KeychainService.shared.saveToken(response.token)
                        authManager.currentUser = response.user
                        authManager.isAuthenticated = true
                    } catch {
                        authManager.errorMessage = error.localizedDescription
                    }
                }
            } label: {
                Text("Sign Up")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.green)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .disabled(!isFormValid || authManager.isLoading)
            .padding(.horizontal)
        }
    }
    
    private var isFormValid: Bool {
        !username.isEmpty &&
        !email.isEmpty &&
        !displayName.isEmpty &&
        !password.isEmpty &&
        password == confirmPassword &&
        password.count >= 8
    }
}

#Preview {
    AuthenticationView()
        .environmentObject(AuthenticationManager.shared)
}
