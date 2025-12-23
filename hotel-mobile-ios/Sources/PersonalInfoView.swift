//
//  PersonalInfoView.swift
//  HotelMobileIOS
//
//  Tab 1: Personal Information for Enhanced Check-In
//

import SwiftUI

struct PersonalInfoView: View {
    @ObservedObject var formState: CheckInFormState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Header
                Text("Personal Information")
                    .font(.title2)
                    .fontWeight(.bold)
                    .padding(.bottom, 10)

                // Title and Name Section
                VStack(alignment: .leading, spacing: 15) {
                    Text("Name")
                        .font(.headline)
                        .foregroundColor(.secondary)

                    HStack(spacing: 15) {
                        // Title Picker
                        VStack(alignment: .leading, spacing: 5) {
                            Text("Title")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            Picker("Title", selection: $formState.title) {
                                Text("Select").tag("")
                                ForEach(TitleOption.options) { option in
                                    Text(option.value).tag(option.value)
                                }
                            }
                            .pickerStyle(.menu)
                            .frame(maxWidth: 100)
                            .padding(10)
                            .background(Color(.systemGray6))
                            .cornerRadius(8)
                        }

                        // First Name
                        VStack(alignment: .leading, spacing: 5) {
                            HStack {
                                Text("First Name")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                Text("*")
                                    .font(.caption)
                                    .foregroundColor(.red)
                            }

                            TextField("First Name", text: $formState.firstName)
                                .textFieldStyle(.roundedBorder)
                                .autocapitalization(.words)
                        }
                        .frame(maxWidth: .infinity)
                    }

                    // Last Name
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            Text("Last Name")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            Text("*")
                                .font(.caption)
                                .foregroundColor(.red)
                        }

                        TextField("Last Name", text: $formState.lastName)
                            .textFieldStyle(.roundedBorder)
                            .autocapitalization(.words)
                    }

                    if let error = formState.validationErrors["firstName"] ?? formState.validationErrors["lastName"] {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                }
                .padding()
                .background(Color(.systemBackground))
                .cornerRadius(12)
                .shadow(color: Color.black.opacity(0.05), radius: 5)

                // Address Section
                VStack(alignment: .leading, spacing: 15) {
                    Text("Address")
                        .font(.headline)
                        .foregroundColor(.secondary)

                    VStack(alignment: .leading, spacing: 5) {
                        Text("Street Address")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        TextField("Street Address", text: $formState.addressLine1)
                            .textFieldStyle(.roundedBorder)
                            .autocapitalization(.words)
                    }

                    HStack(spacing: 15) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("City")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            TextField("City", text: $formState.city)
                                .textFieldStyle(.roundedBorder)
                                .autocapitalization(.words)
                        }

                        VStack(alignment: .leading, spacing: 5) {
                            Text("State/Province")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            TextField("State", text: $formState.stateProvince)
                                .textFieldStyle(.roundedBorder)
                                .autocapitalization(.words)
                        }
                    }

                    HStack(spacing: 15) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("Postal Code")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            TextField("Postal Code", text: $formState.postalCode)
                                .textFieldStyle(.roundedBorder)
                                .keyboardType(.numberPad)
                        }

                        VStack(alignment: .leading, spacing: 5) {
                            Text("Country")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            TextField("Country", text: $formState.country)
                                .textFieldStyle(.roundedBorder)
                                .autocapitalization(.words)
                        }
                    }
                }
                .padding()
                .background(Color(.systemBackground))
                .cornerRadius(12)
                .shadow(color: Color.black.opacity(0.05), radius: 5)

                // Contact Information Section
                VStack(alignment: .leading, spacing: 15) {
                    Text("Contact Information")
                        .font(.headline)
                        .foregroundColor(.secondary)

                    VStack(alignment: .leading, spacing: 5) {
                        Text("Phone Number 1")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        TextField("Phone Number", text: $formState.phone)
                            .textFieldStyle(.roundedBorder)
                            .keyboardType(.phonePad)
                    }

                    VStack(alignment: .leading, spacing: 5) {
                        Text("Phone Number 2 (Alternate)")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        TextField("Alternate Phone", text: $formState.altPhone)
                            .textFieldStyle(.roundedBorder)
                            .keyboardType(.phonePad)
                    }
                }
                .padding()
                .background(Color(.systemBackground))
                .cornerRadius(12)
                .shadow(color: Color.black.opacity(0.05), radius: 5)

                // Identification Section
                VStack(alignment: .leading, spacing: 15) {
                    Text("Identification")
                        .font(.headline)
                        .foregroundColor(.secondary)

                    VStack(alignment: .leading, spacing: 5) {
                        Text("Nationality")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        TextField("Nationality", text: $formState.nationality)
                            .textFieldStyle(.roundedBorder)
                            .autocapitalization(.words)
                    }

                    VStack(alignment: .leading, spacing: 5) {
                        Text("IC / Passport Number")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        TextField("IC or Passport Number", text: $formState.icNumber)
                            .textFieldStyle(.roundedBorder)
                            .autocapitalization(.allCharacters)
                    }
                }
                .padding()
                .background(Color(.systemBackground))
                .cornerRadius(12)
                .shadow(color: Color.black.opacity(0.05), radius: 5)

                // Info Footer
                HStack {
                    Image(systemName: "info.circle")
                        .foregroundColor(.blue)
                    Text("Fields marked with * are required")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(.top, 10)
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground))
    }
}

// MARK: - Preview

struct PersonalInfoView_Previews: PreviewProvider {
    static var previews: some View {
        PersonalInfoView(formState: CheckInFormState())
    }
}
