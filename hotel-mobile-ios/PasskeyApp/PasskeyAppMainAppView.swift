//
//  MainAppView.swift
//  PasskeyApp
//
//  Created on December 7, 2025.
//

import SwiftUI

struct MainAppView: View {
    @EnvironmentObject var authManager: AuthenticationManager
    @State private var selectedTab = 0
    
    var body: some View {
        TabView(selection: $selectedTab) {
            HomeView()
                .tabItem {
                    Label("Home", systemImage: "house.fill")
                }
                .tag(0)
            
            ProfileView()
                .tabItem {
                    Label("Profile", systemImage: "person.fill")
                }
                .tag(1)
            
            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gearshape.fill")
                }
                .tag(2)
        }
    }
}

struct HomeView: View {
    @EnvironmentObject var authManager: AuthenticationManager
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Welcome Card
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Welcome back,")
                                    .font(.title3)
                                    .foregroundStyle(.secondary)
                                
                                Text(authManager.currentUser?.displayName ?? "User")
                                    .font(.system(size: 32, weight: .bold))
                            }
                            
                            Spacer()
                            
                            Image(systemName: "checkmark.shield.fill")
                                .font(.system(size: 40))
                                .foregroundStyle(.green.gradient)
                        }
                        
                        HStack {
                            Image(systemName: "key.horizontal.fill")
                                .foregroundStyle(.blue)
                            Text("Signed in with passkey")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(.blue.opacity(0.1))
                        .clipShape(Capsule())
                    }
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.ultraThinMaterial)
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                    
                    // Feature Cards
                    LazyVGrid(columns: [
                        GridItem(.flexible()),
                        GridItem(.flexible())
                    ], spacing: 16) {
                        FeatureCard(
                            icon: "lock.shield.fill",
                            title: "Secure",
                            description: "Protected by passkey",
                            color: .green
                        )
                        
                        FeatureCard(
                            icon: "bolt.fill",
                            title: "Fast",
                            description: "Instant sign in",
                            color: .orange
                        )
                        
                        FeatureCard(
                            icon: "icloud.fill",
                            title: "Synced",
                            description: "Across devices",
                            color: .blue
                        )
                        
                        FeatureCard(
                            icon: "hand.raised.fill",
                            title: "Private",
                            description: "No tracking",
                            color: .purple
                        )
                    }
                    
                    // Recent Activity placeholder
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Recent Activity")
                            .font(.title2.bold())
                        
                        ForEach(0..<3, id: \.self) { index in
                            HStack {
                                Circle()
                                    .fill(.blue.gradient)
                                    .frame(width: 44, height: 44)
                                    .overlay {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(.white)
                                    }
                                
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Activity \(index + 1)")
                                        .font(.headline)
                                    Text("2 hours ago")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                
                                Spacer()
                                
                                Image(systemName: "chevron.right")
                                    .foregroundStyle(.secondary)
                            }
                            .padding()
                            .background(.ultraThinMaterial)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("Home")
        }
    }
}

struct FeatureCard: View {
    let icon: String
    let title: String
    let description: String
    let color: Color
    
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 32))
                .foregroundStyle(color.gradient)
            
            VStack(spacing: 4) {
                Text(title)
                    .font(.headline)
                
                Text(description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

struct ProfileView: View {
    @EnvironmentObject var authManager: AuthenticationManager
    
    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 16) {
                        Circle()
                            .fill(.blue.gradient)
                            .frame(width: 70, height: 70)
                            .overlay {
                                Text(authManager.currentUser?.displayName.prefix(1).uppercased() ?? "U")
                                    .font(.system(size: 30, weight: .bold))
                                    .foregroundStyle(.white)
                            }
                        
                        VStack(alignment: .leading, spacing: 4) {
                            Text(authManager.currentUser?.displayName ?? "User")
                                .font(.title3.bold())
                            
                            Text("@\(authManager.currentUser?.username ?? "username")")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 8)
                }
                
                Section {
                    LabeledContent {
                        HStack(spacing: 6) {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                            Text("Active")
                                .foregroundStyle(.secondary)
                        }
                    } label: {
                        HStack {
                            Image(systemName: "key.horizontal.fill")
                                .foregroundStyle(.blue)
                            Text("Passkey Status")
                        }
                    }
                    
                    LabeledContent("User ID", value: authManager.currentUser?.id ?? "N/A")
                    
                    if let email = authManager.currentUser?.email {
                        LabeledContent("Email", value: email)
                    }
                } header: {
                    Text("Account Information")
                }
            }
            .navigationTitle("Profile")
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject var authManager: AuthenticationManager
    @State private var showingSignOutConfirmation = false
    
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button {
                        // Manage passkeys
                    } label: {
                        Label("Manage Passkeys", systemImage: "key.horizontal.fill")
                    }
                    
                    Button {
                        // Add another passkey
                    } label: {
                        Label("Add Another Passkey", systemImage: "plus.circle.fill")
                    }
                } header: {
                    Text("Security")
                }
                
                Section {
                    Button {
                        // Notifications settings
                    } label: {
                        Label("Notifications", systemImage: "bell.fill")
                    }
                    
                    Button {
                        // Appearance settings
                    } label: {
                        Label("Appearance", systemImage: "paintbrush.fill")
                    }
                } header: {
                    Text("Preferences")
                }
                
                Section {
                    Button {
                        // Privacy policy
                    } label: {
                        Label("Privacy Policy", systemImage: "hand.raised.fill")
                    }
                    
                    Button {
                        // Terms of service
                    } label: {
                        Label("Terms of Service", systemImage: "doc.text.fill")
                    }
                    
                    Button {
                        // Help & support
                    } label: {
                        Label("Help & Support", systemImage: "questionmark.circle.fill")
                    }
                } header: {
                    Text("About")
                }
                
                Section {
                    Button(role: .destructive) {
                        showingSignOutConfirmation = true
                    } label: {
                        Label("Sign Out", systemImage: "arrow.right.square.fill")
                    }
                }
            }
            .navigationTitle("Settings")
            .confirmationDialog("Sign Out", isPresented: $showingSignOutConfirmation) {
                Button("Sign Out", role: .destructive) {
                    Task {
                        await authManager.signOut()
                    }
                }
                Button("Cancel", role: .cancel) { }
            } message: {
                Text("Are you sure you want to sign out?")
            }
        }
    }
}

#Preview {
    MainAppView()
        .environmentObject(AuthenticationManager())
}
