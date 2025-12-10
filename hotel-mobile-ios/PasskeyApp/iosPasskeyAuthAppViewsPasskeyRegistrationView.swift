import SwiftUI

struct PasskeyRegistrationView: View {
    @EnvironmentObject var authManager: AuthenticationManager
    @Environment(\.dismiss) var dismiss
    @State private var isRegistering = false
    @State private var showSuccess = false
    @State private var errorMessage: String?
    
    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                if showSuccess {
                    successView
                } else {
                    promptView
                }
            }
            .padding()
            .navigationTitle("Secure Your Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Later") {
                        dismiss()
                    }
                    .disabled(isRegistering)
                }
            }
        }
    }
    
    private var promptView: some View {
        VStack(spacing: 24) {
            // Icon
            Image(systemName: "key.viewfinder")
                .font(.system(size: 80))
                .foregroundStyle(.blue)
                .padding(.top, 40)
            
            // Title and Description
            VStack(spacing: 12) {
                Text("Register a Passkey")
                    .font(.title2)
                    .bold()
                
                Text("Passkeys are a safer and easier way to sign in. They use biometric authentication and are more secure than passwords.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            
            // Benefits List
            VStack(alignment: .leading, spacing: 16) {
                BenefitRow(
                    icon: "faceid",
                    title: "Biometric Security",
                    description: "Use Face ID or Touch ID to sign in"
                )
                
                BenefitRow(
                    icon: "shield.checkmark.fill",
                    title: "Phishing Resistant",
                    description: "Protected against phishing attacks"
                )
                
                BenefitRow(
                    icon: "bolt.fill",
                    title: "Fast Sign In",
                    description: "Sign in with just a glance or touch"
                )
            }
            .padding()
            .background(Color(.systemGray6))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            
            Spacer()
            
            // Error Message
            if let errorMessage = errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }
            
            // Register Button
            Button {
                registerPasskey()
            } label: {
                if isRegistering {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(.white)
                        .frame(maxWidth: .infinity)
                        .padding()
                } else {
                    HStack {
                        Image(systemName: "person.badge.key.fill")
                        Text("Register Passkey")
                            .fontWeight(.semibold)
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                }
            }
            .background(Color.blue)
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .disabled(isRegistering)
            
            // Skip Button
            Button("Skip for Now") {
                dismiss()
            }
            .font(.subheadline)
            .disabled(isRegistering)
        }
    }
    
    private var successView: some View {
        VStack(spacing: 24) {
            Spacer()
            
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 80))
                .foregroundStyle(.green)
            
            Text("Passkey Registered!")
                .font(.title2)
                .bold()
            
            Text("You can now sign in quickly and securely using your passkey.")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            
            Spacer()
            
            Button {
                dismiss()
            } label: {
                Text("Done")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color.blue)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
    }
    
    private func registerPasskey() {
        isRegistering = true
        errorMessage = nil
        
        Task {
            do {
                try await authManager.registerPasskey()
                
                await MainActor.run {
                    isRegistering = false
                    withAnimation {
                        showSuccess = true
                    }
                    
                    // Auto-dismiss after showing success
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                        dismiss()
                    }
                }
            } catch {
                await MainActor.run {
                    isRegistering = false
                    errorMessage = error.localizedDescription
                }
            }
        }
    }
}

struct BenefitRow: View {
    let icon: String
    let title: String
    let description: String
    
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundStyle(.blue)
                .frame(width: 32)
            
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)
                
                Text(description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

#Preview {
    PasskeyRegistrationView()
        .environmentObject(AuthenticationManager.shared)
}
