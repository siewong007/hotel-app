//
//  ContentView.swift
//  PasskeyApp
//
//  Created on December 7, 2025.
//

import SwiftUI

struct ContentView: View {
    @EnvironmentObject var authManager: AuthenticationManager
    @State private var showingPasskeyRegistration = false
    
    var body: some View {
        NavigationStack {
            Group {
                if authManager.isAuthenticated {
                    MainAppView()
                } else {
                    AuthenticationView(showingPasskeyRegistration: $showingPasskeyRegistration)
                }
            }
            .sheet(isPresented: $showingPasskeyRegistration) {
                PasskeyRegistrationView()
            }
        }
        .task {
            await authManager.checkAuthenticationStatus()
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(AuthenticationManager())
}
