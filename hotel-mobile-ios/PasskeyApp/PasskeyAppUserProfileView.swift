//
//  UserProfileView.swift
//  PasskeyApp
//
//  Created on December 7, 2025.
//

import SwiftUI
import PhotosUI

// MARK: - Enhanced User Profile View

struct UserProfileView: View {
    @EnvironmentObject var authManager: AuthenticationManager
    @State private var isEditingProfile = false
    @State private var showingPasskeyManagement = false
    @State private var showingImagePicker = false
    @State private var selectedImage: PhotosPickerItem?
    @State private var profileImage: Image?
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Profile Header
                    profileHeader
                    
                    // Quick Stats
                    quickStats
                    
                    // Account Information
                    accountInformation
                    
                    // Security Section
                    securitySection
                    
                    // Data Management
                    dataManagement
                    
                    // Danger Zone
                    dangerZone
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Edit") {
                        isEditingProfile = true
                    }
                }
            }
            .sheet(isPresented: $isEditingProfile) {
                EditProfileView()
            }
            .sheet(isPresented: $showingPasskeyManagement) {
                PasskeyManagementView()
            }
            .onChange(of: selectedImage) { _, newValue in
                Task {
                    if let data = try? await newValue?.loadTransferable(type: Data.self),
                       let uiImage = UIImage(data: data) {
                        profileImage = Image(uiImage: uiImage)
                    }
                }
            }
        }
    }
    
    // MARK: - Profile Header
    
    private var profileHeader: some View {
        VStack(spacing: 16) {
            // Profile Picture
            ZStack(alignment: .bottomTrailing) {
                if let profileImage {
                    profileImage
                        .resizable()
                        .scaledToFill()
                        .frame(width: 120, height: 120)
                        .clipShape(Circle())
                } else {
                    Circle()
                        .fill(.blue.gradient)
                        .frame(width: 120, height: 120)
                        .overlay {
                            Text(authManager.currentUser?.displayName.prefix(1).uppercased() ?? "U")
                                .font(.system(size: 50, weight: .bold))
                                .foregroundStyle(.white)
                        }
                }
                
                PhotosPicker(selection: $selectedImage, matching: .images) {
                    Image(systemName: "camera.circle.fill")
                        .font(.system(size: 32))
                        .foregroundStyle(.white)
                        .background(Circle().fill(.blue))
                }
            }
            
            // User Info
            VStack(spacing: 4) {
                Text(authManager.currentUser?.displayName ?? "User")
                    .font(.title2.bold())
                
                Text("@\(authManager.currentUser?.username ?? "username")")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                
                if let email = authManager.currentUser?.email {
                    Text(email)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            
            // Status Badge
            HStack(spacing: 6) {
                Image(systemName: "checkmark.shield.fill")
                    .foregroundStyle(.green)
                Text("Verified Account")
                    .font(.caption)
                    .fontWeight(.medium)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(.green.opacity(0.1))
            .clipShape(Capsule())
        }
        .padding(.vertical)
        .frame(maxWidth: .infinity)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }
    
    // MARK: - Quick Stats
    
    private var quickStats: some View {
        HStack(spacing: 12) {
            QuickStatCard(
                title: "Sign-ins",
                value: "47",
                icon: "arrow.right.circle.fill",
                color: .blue
            )
            
            QuickStatCard(
                title: "Days Active",
                value: "23",
                icon: "calendar.circle.fill",
                color: .green
            )
            
            QuickStatCard(
                title: "Sessions",
                value: "156",
                icon: "clock.circle.fill",
                color: .orange
            )
        }
    }
    
    // MARK: - Account Information
    
    private var accountInformation: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Account Information")
                .font(.headline)
                .padding(.horizontal)
            
            VStack(spacing: 0) {
                InfoRow(
                    icon: "person.fill",
                    title: "Display Name",
                    value: authManager.currentUser?.displayName ?? "Not set"
                )
                
                Divider().padding(.leading, 52)
                
                InfoRow(
                    icon: "at",
                    title: "Username",
                    value: authManager.currentUser?.username ?? "Not set"
                )
                
                Divider().padding(.leading, 52)
                
                InfoRow(
                    icon: "envelope.fill",
                    title: "Email",
                    value: authManager.currentUser?.email ?? "Not set"
                )
                
                Divider().padding(.leading, 52)
                
                InfoRow(
                    icon: "number",
                    title: "User ID",
                    value: authManager.currentUser?.id ?? "Not available"
                )
            }
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
    }
    
    // MARK: - Security Section
    
    private var securitySection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Security")
                .font(.headline)
                .padding(.horizontal)
            
            VStack(spacing: 0) {
                Button {
                    showingPasskeyManagement = true
                } label: {
                    ActionRow(
                        icon: "key.horizontal.fill",
                        title: "Manage Passkeys",
                        subtitle: "View and manage your registered passkeys",
                        color: .blue,
                        hasChevron: true
                    )
                }
                .buttonStyle(.plain)
                
                Divider().padding(.leading, 52)
                
                ActionRow(
                    icon: "faceid",
                    title: "Biometric Authentication",
                    subtitle: "Face ID enabled",
                    color: .green,
                    trailing: {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    }
                )
                
                Divider().padding(.leading, 52)
                
                ActionRow(
                    icon: "lock.shield.fill",
                    title: "Two-Factor Authentication",
                    subtitle: "Add an extra layer of security",
                    color: .orange,
                    hasChevron: true
                )
            }
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
    }
    
    // MARK: - Data Management
    
    private var dataManagement: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Data Management")
                .font(.headline)
                .padding(.horizontal)
            
            VStack(spacing: 0) {
                Button {
                    // Export data
                } label: {
                    ActionRow(
                        icon: "square.and.arrow.up.fill",
                        title: "Export My Data",
                        subtitle: "Download a copy of your data",
                        color: .blue,
                        hasChevron: true
                    )
                }
                .buttonStyle(.plain)
                
                Divider().padding(.leading, 52)
                
                Button {
                    // Privacy settings
                } label: {
                    ActionRow(
                        icon: "hand.raised.fill",
                        title: "Privacy Settings",
                        subtitle: "Control your data and privacy",
                        color: .purple,
                        hasChevron: true
                    )
                }
                .buttonStyle(.plain)
                
                Divider().padding(.leading, 52)
                
                Button {
                    // Activity log
                } label: {
                    ActionRow(
                        icon: "list.bullet.rectangle.fill",
                        title: "Activity Log",
                        subtitle: "View your account activity",
                        color: .indigo,
                        hasChevron: true
                    )
                }
                .buttonStyle(.plain)
            }
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
    }
    
    // MARK: - Danger Zone
    
    private var dangerZone: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Danger Zone")
                .font(.headline)
                .foregroundStyle(.red)
                .padding(.horizontal)
            
            VStack(spacing: 0) {
                Button(role: .destructive) {
                    // Delete account
                } label: {
                    ActionRow(
                        icon: "trash.fill",
                        title: "Delete Account",
                        subtitle: "Permanently delete your account and data",
                        color: .red,
                        hasChevron: true
                    )
                }
                .buttonStyle(.plain)
            }
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
    }
}

// MARK: - Supporting Views

struct QuickStatCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color
    
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 24))
                .foregroundStyle(color.gradient)
            
            Text(value)
                .font(.title2.bold())
            
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

struct InfoRow: View {
    let icon: String
    let title: String
    let value: String
    
    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: icon)
                .font(.system(size: 18))
                .foregroundStyle(.blue)
                .frame(width: 28)
            
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                
                Text(value)
                    .font(.body)
            }
            
            Spacer()
        }
        .padding(.horizontal)
        .padding(.vertical, 12)
    }
}

struct ActionRow<Trailing: View>: View {
    let icon: String
    let title: String
    let subtitle: String
    let color: Color
    var hasChevron: Bool = false
    var trailing: (() -> Trailing)? = nil
    
    init(
        icon: String,
        title: String,
        subtitle: String,
        color: Color,
        hasChevron: Bool = false,
        @ViewBuilder trailing: @escaping () -> Trailing
    ) {
        self.icon = icon
        self.title = title
        self.subtitle = subtitle
        self.color = color
        self.hasChevron = hasChevron
        self.trailing = trailing
    }
    
    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: icon)
                .font(.system(size: 18))
                .foregroundStyle(color)
                .frame(width: 28)
            
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.body)
                
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            
            Spacer()
            
            if let trailing {
                trailing()
            } else if hasChevron {
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 12)
    }
}

extension ActionRow where Trailing == EmptyView {
    init(
        icon: String,
        title: String,
        subtitle: String,
        color: Color,
        hasChevron: Bool = false
    ) {
        self.icon = icon
        self.title = title
        self.subtitle = subtitle
        self.color = color
        self.hasChevron = hasChevron
        self.trailing = nil
    }
}

// MARK: - Preview

#Preview {
    UserProfileView()
        .environmentObject(AuthenticationManager())
}
