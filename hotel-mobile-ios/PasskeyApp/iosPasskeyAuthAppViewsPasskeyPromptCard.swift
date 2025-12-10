import SwiftUI

struct PasskeyPromptCard: View {
    @EnvironmentObject var authManager: AuthenticationManager
    @State private var showRegistration = false
    @State private var isDismissed = false
    
    var body: some View {
        if !isDismissed {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Image(systemName: "key.viewfinder")
                        .font(.title2)
                        .foregroundStyle(.blue)
                    
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Secure Your Account")
                            .font(.headline)
                        
                        Text("Register a passkey for faster, more secure sign in")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    
                    Spacer()
                }
                
                HStack(spacing: 12) {
                    Button {
                        showRegistration = true
                    } label: {
                        Text("Set Up Now")
                            .fontWeight(.semibold)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(Color.blue)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    
                    Button {
                        withAnimation {
                            isDismissed = true
                        }
                    } label: {
                        Text("Later")
                            .fontWeight(.medium)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(Color(.systemGray5))
                            .foregroundStyle(.primary)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
            .padding()
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color(.systemBackground))
                    .shadow(color: .black.opacity(0.1), radius: 10, x: 0, y: 5)
            )
            .padding()
            .sheet(isPresented: $showRegistration) {
                PasskeyRegistrationView()
            }
        }
    }
}

#Preview {
    PasskeyPromptCard()
        .environmentObject(AuthenticationManager.shared)
}
