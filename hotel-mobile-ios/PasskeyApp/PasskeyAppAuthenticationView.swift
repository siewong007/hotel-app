//
//  AuthenticationView.swift
//  PasskeyApp
//
//  Created on December 7, 2025.
//

import SwiftUI

struct AuthenticationView: View {
    @EnvironmentObject var authManager: AuthenticationManager
    @Binding var showingPasskeyRegistration: Bool
    
    @State private var showAlert = false
    
    var body: some View {
        ZStack {
            // Background gradient optimized for iPhone 17 Pro
            LinearGradient(
                colors: [.blue.opacity(0.6), .purple.opacity(0.4)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()
            
            VStack(spacing: 40) {
                Spacer()
                
                // App Icon/Logo
                Image(systemName: "key.horizontal.fill")
                    .font(.system(size: 80))
                    .foregroundStyle(.white)
                    .shadow(radius: 10)
                
                VStack(spacing: 12) {
                    Text("Welcome Back")
                        .font(.system(size: 36, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                    
                    Text("Sign in securely with passkey")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(.white.opacity(0.9))
                        .multilineTextAlignment(.center)
                }
                
                Spacer()
                
                // Action Buttons
                VStack(spacing: 16) {
                    if authManager.hasPasskey {
                        // Sign in button (passkey exists)
                        Button {
                            Task {
                                await authManager.signInWithPasskey()
                            }
                        } label: {
                            HStack {
                                Image(systemName: "person.badge.key.fill")
                                Text("Sign In with Passkey")
                                    .fontWeight(.semibold)
                            }
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(.white)
                            .foregroundStyle(.blue)
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                        }
                        .disabled(authManager.isLoading)
                    } else {
                        // Register passkey prompt
                        VStack(spacing: 16) {
                            HStack(spacing: 12) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundStyle(.yellow)
                                
                                Text("No passkey found. Please register to continue.")
                                    .font(.system(size: 15))
                                    .foregroundStyle(.white)
                            }
                            .padding()
                            .frame(maxWidth: .infinity)
                            .background(.white.opacity(0.2))
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            
                            Button {
                                showingPasskeyRegistration = true
                            } label: {
                                HStack {
                                    Image(systemName: "plus.circle.fill")
                                    Text("Register Passkey")
                                        .fontWeight(.semibold)
                                }
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(.white)
                                .foregroundStyle(.blue)
                                .clipShape(RoundedRectangle(cornerRadius: 16))
                            }
                        }
                    }
                    
                    // Alternative sign in options
                    Button {
                        // Handle traditional sign in
                    } label: {
                        Text("Use Password Instead")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(.white.opacity(0.9))
                    }
                    .padding(.top, 8)
                }
                .padding(.horizontal, 32)
                
                Spacer()
                
                // Error message
                if let error = authManager.errorMessage {
                    Text(error)
                        .font(.callout)
                        .foregroundStyle(.red)
                        .padding()
                        .background(.white.opacity(0.9))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .padding(.horizontal)
                }
            }
            .padding()
            
            // Loading overlay
            if authManager.isLoading {
                Color.black.opacity(0.4)
                    .ignoresSafeArea()
                
                ProgressView()
                    .controlSize(.large)
                    .tint(.white)
            }
        }
    }
}

#Preview {
    AuthenticationView(showingPasskeyRegistration: .constant(false))
        .environmentObject(AuthenticationManager())
}
