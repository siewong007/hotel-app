import SwiftUI

struct ContentView: View {
    @EnvironmentObject var authManager: AuthenticationManager
    
    var body: some View {
        Group {
            if authManager.isAuthenticated {
                MainAppView()
            } else {
                AuthenticationView()
            }
        }
    }
}

struct MainAppView: View {
    @EnvironmentObject var authManager: AuthenticationManager
    @State private var showPasskeyPrompt = false
    
    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Text("Welcome!")
                    .font(.largeTitle)
                    .bold()
                
                if let user = authManager.currentUser {
                    Text("Logged in as: \(user.username)")
                        .font(.headline)
                    
                    if !user.hasPasskey {
                        PasskeyPromptCard()
                    }
                }
                
                Spacer()
                
                Button("Sign Out") {
                    authManager.signOut()
                }
                .buttonStyle(.bordered)
            }
            .padding()
            .navigationTitle("Home")
            .onAppear {
                checkPasskeyStatus()
            }
            .sheet(isPresented: $showPasskeyPrompt) {
                PasskeyRegistrationView()
            }
        }
    }
    
    private func checkPasskeyStatus() {
        if let user = authManager.currentUser, !user.hasPasskey {
            // Prompt user to register passkey if they don't have one
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                showPasskeyPrompt = true
            }
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(AuthenticationManager.shared)
}
