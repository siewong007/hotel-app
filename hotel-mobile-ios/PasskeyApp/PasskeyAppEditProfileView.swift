//
//  EditProfileView.swift
//  PasskeyApp
//
//  Created on December 7, 2025.
//

import SwiftUI

struct EditProfileView: View {
    @EnvironmentObject var authManager: AuthenticationManager
    @Environment(\.dismiss) var dismiss
    
    @State private var displayName: String
    @State private var username: String
    @State private var email: String
    @State private var bio: String = ""
    @State private var showingSaveAlert = false
    @State private var isSaving = false
    @State private var errorMessage: String?
    
    init() {
        // Initialize with current user data
        _displayName = State(initialValue: "")
        _username = State(initialValue: "")
        _email = State(initialValue: "")
    }
    
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Display Name", text: $displayName)
                        .textContentType(.name)
                    
                    TextField("Username", text: $username)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    
                    TextField("Email", text: $email)
                        .textContentType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        .autocorrectionDisabled()
                } header: {
                    Text("Basic Information")
                } footer: {
                    Text("Your username is unique and visible to others.")
                }
                
                Section {
                    TextField("Bio (optional)", text: $bio, axis: .vertical)
                        .lineLimit(3...6)
                } header: {
                    Text("About")
                } footer: {
                    Text("Tell others a bit about yourself.")
                }
                
                Section {
                    Button("Save Changes") {
                        saveChanges()
                    }
                    .frame(maxWidth: .infinity)
                    .disabled(isSaving || !hasChanges)
                }
            }
            .navigationTitle("Edit Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .alert("Profile Updated", isPresented: $showingSaveAlert) {
                Button("OK") {
                    dismiss()
                }
            } message: {
                Text("Your profile has been successfully updated.")
            }
            .overlay {
                if isSaving {
                    ZStack {
                        Color.black.opacity(0.4)
                            .ignoresSafeArea()
                        
                        ProgressView()
                            .controlSize(.large)
                            .tint(.white)
                    }
                }
            }
        }
        .onAppear {
            loadCurrentUserData()
        }
    }
    
    private var hasChanges: Bool {
        displayName != (authManager.currentUser?.displayName ?? "") ||
        username != (authManager.currentUser?.username ?? "") ||
        email != (authManager.currentUser?.email ?? "")
    }
    
    private func loadCurrentUserData() {
        displayName = authManager.currentUser?.displayName ?? ""
        username = authManager.currentUser?.username ?? ""
        email = authManager.currentUser?.email ?? ""
    }
    
    private func saveChanges() {
        isSaving = true
        errorMessage = nil
        
        // Simulate API call
        Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            
            // Update user data
            // In real app, call backend API here
            
            isSaving = false
            showingSaveAlert = true
        }
    }
}

#Preview {
    EditProfileView()
        .environmentObject(AuthenticationManager())
}
