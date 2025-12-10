//
//  PasskeyRegistrationView.swift
//  PasskeyApp
//
//  Created on December 7, 2025.
//

import SwiftUI

struct PasskeyRegistrationView: View {
    @EnvironmentObject var authManager: AuthenticationManager
    @Environment(\.dismiss) var dismiss
    
    @State private var username = ""
    @State private var displayName = ""
    @State private var email = ""
    @State private var showValidationError = false
    @State private var validationMessage = ""
    
    var body: some View {
        NavigationStack {
            ZStack {
                Form {
                    Section {
                        VStack(alignment: .leading, spacing: 16) {
                            HStack {
                                Image(systemName: "key.horizontal.fill")
                                    .font(.system(size: 50))
                                    .foregroundStyle(.blue.gradient)
                                
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Register Passkey")
                                        .font(.title2.bold())
                                    
                                    Text("Secure, fast, and passwordless")
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .padding(.vertical, 8)
                            
                            Text("Passkeys are the modern way to sign in. They're more secure than passwords and work across all your devices.")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                        }
                    }
                    
                    Section {
                        TextField("Username", text: $username)
                            .textContentType(.username)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        
                        TextField("Display Name", text: $displayName)
                            .textContentType(.name)
                        
                        TextField("Email (optional)", text: $email)
                            .textContentType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .keyboardType(.emailAddress)
                            .autocorrectionDisabled()
                    } header: {
                        Text("Account Information")
                    } footer: {
                        Text("Your username will be used to identify your account.")
                    }
                    
                    Section {
                        VStack(alignment: .leading, spacing: 12) {
                            Label("Face ID or Touch ID", systemImage: "faceid")
                            Label("Syncs across devices", systemImage: "icloud.fill")
                            Label("No passwords to remember", systemImage: "checkmark.shield.fill")
                            Label("Protected by your device", systemImage: "lock.shield.fill")
                        }
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    } header: {
                        Text("Passkey Benefits")
                    }
                }
                
                // Loading overlay
                if authManager.isLoading {
                    Color.black.opacity(0.4)
                        .ignoresSafeArea()
                    
                    VStack(spacing: 16) {
                        ProgressView()
                            .controlSize(.large)
                            .tint(.white)
                        
                        Text("Creating your passkey...")
                            .font(.headline)
                            .foregroundStyle(.white)
                    }
                }
            }
            .navigationTitle("Create Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .disabled(authManager.isLoading)
                }
                
                ToolbarItem(placement: .confirmationAction) {
                    Button("Register") {
                        registerPasskey()
                    }
                    .disabled(!isFormValid || authManager.isLoading)
                    .fontWeight(.semibold)
                }
            }
            .alert("Validation Error", isPresented: $showValidationError) {
                Button("OK", role: .cancel) { }
            } message: {
                Text(validationMessage)
            }
        }
    }
    
    private var isFormValid: Bool {
        !username.isEmpty && !displayName.isEmpty
    }
    
    private func registerPasskey() {
        // Validate input
        guard validateInput() else { return }
        
        // Trigger passkey registration
        Task {
            await authManager.registerPasskey(
                username: username.trimmingCharacters(in: .whitespaces),
                displayName: displayName.trimmingCharacters(in: .whitespaces)
            )
            
            // Dismiss on success
            if authManager.isAuthenticated {
                dismiss()
            }
        }
    }
    
    private func validateInput() -> Bool {
        let trimmedUsername = username.trimmingCharacters(in: .whitespaces)
        let trimmedDisplayName = displayName.trimmingCharacters(in: .whitespaces)
        
        if trimmedUsername.isEmpty {
            validationMessage = "Please enter a username."
            showValidationError = true
            return false
        }
        
        if trimmedUsername.count < 3 {
            validationMessage = "Username must be at least 3 characters."
            showValidationError = true
            return false
        }
        
        if trimmedDisplayName.isEmpty {
            validationMessage = "Please enter a display name."
            showValidationError = true
            return false
        }
        
        if !email.isEmpty {
            let emailRegex = "[A-Z0-9a-z._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}"
            let emailPredicate = NSPredicate(format: "SELF MATCHES %@", emailRegex)
            if !emailPredicate.evaluate(with: email) {
                validationMessage = "Please enter a valid email address."
                showValidationError = true
                return false
            }
        }
        
        return true
    }
}

#Preview {
    PasskeyRegistrationView()
        .environmentObject(AuthenticationManager())
}
