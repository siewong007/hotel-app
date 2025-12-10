//
//  PasskeyManagementView.swift
//  PasskeyApp
//
//  Created on December 7, 2025.
//

import SwiftUI
import AuthenticationServices

// MARK: - Passkey Model

struct PasskeyInfo: Identifiable {
    let id = UUID()
    let credentialID: String
    let deviceName: String
    let dateCreated: Date
    let lastUsed: Date
    let isCurrentDevice: Bool
    
    var formattedCredentialID: String {
        let prefix = String(credentialID.prefix(8))
        let suffix = String(credentialID.suffix(8))
        return "\(prefix)...\(suffix)"
    }
}

// MARK: - Passkey Management View

struct PasskeyManagementView: View {
    @EnvironmentObject var authManager: AuthenticationManager
    @Environment(\.dismiss) var dismiss
    
    @State private var passkeys: [PasskeyInfo] = []
    @State private var isLoading = true
    @State private var showingAddPasskey = false
    @State private var showingDeleteConfirmation = false
    @State private var passkeyToDelete: PasskeyInfo?
    @State private var errorMessage: String?
    
    var body: some View {
        NavigationStack {
            ZStack {
                if isLoading {
                    ProgressView("Loading passkeys...")
                } else if passkeys.isEmpty {
                    emptyState
                } else {
                    passkeyList
                }
            }
            .navigationTitle("Manage Passkeys")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
                
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showingAddPasskey = true
                    } label: {
                        Label("Add Passkey", systemImage: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingAddPasskey) {
                AddPasskeyView()
            }
            .alert("Delete Passkey", isPresented: $showingDeleteConfirmation, presenting: passkeyToDelete) { passkey in
                Button("Cancel", role: .cancel) { }
                Button("Delete", role: .destructive) {
                    deletePasskey(passkey)
                }
            } message: { passkey in
                Text("Are you sure you want to delete the passkey for \(passkey.deviceName)? You'll need to register a new passkey on that device.")
            }
            .task {
                await loadPasskeys()
            }
        }
    }
    
    // MARK: - Empty State
    
    private var emptyState: some View {
        VStack(spacing: 20) {
            Image(systemName: "key.horizontal.fill")
                .font(.system(size: 60))
                .foregroundStyle(.gray)
            
            Text("No Passkeys")
                .font(.title2.bold())
            
            Text("You haven't registered any passkeys yet. Add one to enable secure, passwordless authentication.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
            
            Button {
                showingAddPasskey = true
            } label: {
                Label("Add Passkey", systemImage: "plus.circle.fill")
                    .font(.headline)
            }
            .buttonStyle(.borderedProminent)
            .padding(.top)
        }
        .padding()
    }
    
    // MARK: - Passkey List
    
    private var passkeyList: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Information Banner
                infoBanner
                
                // Current Device Section
                if let currentDevicePasskey = passkeys.first(where: { $0.isCurrentDevice }) {
                    currentDeviceSection(passkey: currentDevicePasskey)
                }
                
                // Other Devices Section
                otherDevicesSection
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground))
    }
    
    private var infoBanner: some View {
        HStack(spacing: 12) {
            Image(systemName: "info.circle.fill")
                .foregroundStyle(.blue)
                .font(.title2)
            
            VStack(alignment: .leading, spacing: 4) {
                Text("About Passkeys")
                    .font(.subheadline.bold())
                
                Text("Passkeys are synced across your devices via iCloud Keychain and can't be phished or leaked.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            
            Spacer()
        }
        .padding()
        .background(.blue.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
    
    private func currentDeviceSection(passkey: PasskeyInfo) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("This Device")
                .font(.headline)
                .padding(.horizontal, 4)
            
            PasskeyCard(passkey: passkey, onDelete: nil)
        }
    }
    
    private var otherDevicesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            if passkeys.filter({ !$0.isCurrentDevice }).count > 0 {
                Text("Other Devices")
                    .font(.headline)
                    .padding(.horizontal, 4)
                
                ForEach(passkeys.filter { !$0.isCurrentDevice }) { passkey in
                    PasskeyCard(passkey: passkey) {
                        passkeyToDelete = passkey
                        showingDeleteConfirmation = true
                    }
                }
            }
        }
    }
    
    // MARK: - Data Operations
    
    private func loadPasskeys() async {
        isLoading = true
        
        // Simulate API call
        try? await Task.sleep(nanoseconds: 1_000_000_000)
        
        // Generate sample data
        passkeys = [
            PasskeyInfo(
                credentialID: "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6",
                deviceName: "iPhone 17 Pro",
                dateCreated: Calendar.current.date(byAdding: .day, value: -30, to: Date())!,
                lastUsed: Date(),
                isCurrentDevice: true
            ),
            PasskeyInfo(
                credentialID: "Q7R8S9T0U1V2W3X4Y5Z6A7B8C9D0E1F2",
                deviceName: "iPad Pro",
                dateCreated: Calendar.current.date(byAdding: .day, value: -15, to: Date())!,
                lastUsed: Calendar.current.date(byAdding: .hour, value: -5, to: Date())!,
                isCurrentDevice: false
            ),
            PasskeyInfo(
                credentialID: "G3H4I5J6K7L8M9N0O1P2Q3R4S5T6U7V8",
                deviceName: "MacBook Pro",
                dateCreated: Calendar.current.date(byAdding: .day, value: -7, to: Date())!,
                lastUsed: Calendar.current.date(byAdding: .day, value: -2, to: Date())!,
                isCurrentDevice: false
            )
        ]
        
        isLoading = false
    }
    
    private func deletePasskey(_ passkey: PasskeyInfo) {
        // Simulate API call
        Task {
            try? await Task.sleep(nanoseconds: 500_000_000)
            
            withAnimation {
                passkeys.removeAll { $0.id == passkey.id }
            }
        }
    }
}

// MARK: - Passkey Card

struct PasskeyCard: View {
    let passkey: PasskeyInfo
    var onDelete: (() -> Void)?
    
    var body: some View {
        HStack(spacing: 16) {
            // Device Icon
            deviceIcon
                .frame(width: 50)
            
            // Passkey Info
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(passkey.deviceName)
                        .font(.body.bold())
                    
                    if passkey.isCurrentDevice {
                        Text("(Current)")
                            .font(.caption)
                            .foregroundStyle(.blue)
                    }
                }
                
                Text("ID: \(passkey.formattedCredentialID)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fontDesign(.monospaced)
                
                HStack(spacing: 4) {
                    Image(systemName: "calendar")
                        .font(.caption2)
                    Text("Created \(passkey.dateCreated.formatted(date: .abbreviated, time: .omitted))")
                        .font(.caption2)
                }
                .foregroundStyle(.secondary)
                
                HStack(spacing: 4) {
                    Image(systemName: "clock")
                        .font(.caption2)
                    Text("Last used \(passkey.lastUsed.formatted(.relative(presentation: .named)))")
                        .font(.caption2)
                }
                .foregroundStyle(.secondary)
            }
            
            Spacer()
            
            // Delete Button (if not current device)
            if let onDelete {
                Button(role: .destructive) {
                    onDelete()
                } label: {
                    Image(systemName: "trash")
                        .foregroundStyle(.red)
                }
                .buttonStyle(.borderless)
            } else {
                Image(systemName: "checkmark.shield.fill")
                    .foregroundStyle(.green)
                    .font(.title3)
            }
        }
        .padding()
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
    
    private var deviceIcon: some View {
        ZStack {
            Circle()
                .fill(passkey.isCurrentDevice ? Color.blue.gradient : Color.gray.gradient)
                .frame(width: 50, height: 50)
            
            Image(systemName: deviceIconName)
                .font(.title2)
                .foregroundStyle(.white)
        }
    }
    
    private var deviceIconName: String {
        let deviceName = passkey.deviceName.lowercased()
        if deviceName.contains("iphone") {
            return "iphone"
        } else if deviceName.contains("ipad") {
            return "ipad"
        } else if deviceName.contains("mac") {
            return "laptopcomputer"
        } else {
            return "desktopcomputer"
        }
    }
}

// MARK: - Add Passkey View

struct AddPasskeyView: View {
    @EnvironmentObject var authManager: AuthenticationManager
    @Environment(\.dismiss) var dismiss
    
    @State private var deviceName = ""
    @State private var isRegistering = false
    @State private var errorMessage: String?
    
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 16) {
                        HStack {
                            Image(systemName: "key.horizontal.fill")
                                .font(.system(size: 50))
                                .foregroundStyle(.blue.gradient)
                            
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Add New Passkey")
                                    .font(.title3.bold())
                                
                                Text("Register a passkey for this device")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, 8)
                    }
                }
                
                Section {
                    TextField("Device Name", text: $deviceName)
                        .textContentType(.none)
                } header: {
                    Text("Device Information")
                } footer: {
                    Text("Give this passkey a name to identify it later (e.g., 'iPhone 17 Pro').")
                }
                
                Section {
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Secured with Face ID", systemImage: "faceid")
                        Label("Synced via iCloud", systemImage: "icloud.fill")
                        Label("Works across devices", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                } header: {
                    Text("Features")
                }
                
                Section {
                    Button {
                        registerPasskey()
                    } label: {
                        if isRegistering {
                            HStack {
                                ProgressView()
                                    .tint(.white)
                                Text("Registering...")
                            }
                            .frame(maxWidth: .infinity)
                        } else {
                            Text("Register Passkey")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .disabled(deviceName.isEmpty || isRegistering)
                }
                
                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                            .font(.caption)
                    }
                }
            }
            .navigationTitle("Add Passkey")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .disabled(isRegistering)
                }
            }
        }
        .onAppear {
            deviceName = UIDevice.current.name
        }
    }
    
    private func registerPasskey() {
        isRegistering = true
        errorMessage = nil
        
        Task {
            // In a real app, this would call the authentication manager
            // to register a new passkey with the backend
            
            // Simulate Face ID and registration
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            
            isRegistering = false
            dismiss()
        }
    }
}

// MARK: - Preview

#Preview("Passkey Management") {
    PasskeyManagementView()
        .environmentObject(AuthenticationManager())
}

#Preview("Add Passkey") {
    AddPasskeyView()
        .environmentObject(AuthenticationManager())
}
