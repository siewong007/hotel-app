//
//  OtherInfoView.swift
//  HotelMobileIOS
//
//  Tab 4: Other Information for Enhanced Check-In
//

import SwiftUI

struct OtherInfoView: View {
    @ObservedObject var formState: CheckInFormState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Header
                Text("Other Information")
                    .font(.title2)
                    .fontWeight(.bold)
                    .padding(.bottom, 10)

                // Special Requests Section
                VStack(alignment: .leading, spacing: 15) {
                    HStack {
                        Text("Special Requests")
                            .font(.headline)
                            .foregroundColor(.secondary)

                        Spacer()

                        Image(systemName: "note.text")
                            .foregroundColor(.blue)
                    }

                    VStack(alignment: .leading, spacing: 5) {
                        Text("Enter any special requests or preferences")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        TextEditor(text: $formState.specialRequests)
                            .frame(height: 120)
                            .padding(8)
                            .background(Color(.systemGray6))
                            .cornerRadius(8)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(Color(.systemGray4), lineWidth: 1)
                            )
                    }

                    // Common request chips
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Common Requests (tap to add)")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                            ForEach(commonRequests, id: \.self) { request in
                                Button(action: {
                                    addCommonRequest(request)
                                }) {
                                    HStack {
                                        Image(systemName: "plus.circle.fill")
                                            .font(.caption)
                                        Text(request)
                                            .font(.caption)
                                    }
                                    .padding(.vertical, 8)
                                    .padding(.horizontal, 12)
                                    .background(Color.blue.opacity(0.1))
                                    .foregroundColor(.blue)
                                    .cornerRadius(16)
                                }
                            }
                        }
                    }
                }
                .padding()
                .background(Color(.systemBackground))
                .cornerRadius(12)
                .shadow(color: Color.black.opacity(0.05), radius: 5)

                // Tourism Tax Section
                VStack(alignment: .leading, spacing: 15) {
                    HStack {
                        Text("Tourism Tax")
                            .font(.headline)
                            .foregroundColor(.secondary)

                        Spacer()

                        Image(systemName: "percent")
                            .foregroundColor(.orange)
                    }

                    VStack(alignment: .leading, spacing: 5) {
                        Text("Tax Amount")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        HStack {
                            Text("$")
                                .foregroundColor(.secondary)

                            TextField("0.00", text: $formState.tourismTax)
                                .keyboardType(.decimalPad)
                                .textFieldStyle(.roundedBorder)
                        }
                    }

                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "info.circle")
                            .foregroundColor(.blue)
                            .font(.caption)

                        Text("Tourism tax is calculated based on nationality and local regulations")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(10)
                    .background(Color.blue.opacity(0.05))
                    .cornerRadius(8)
                }
                .padding()
                .background(Color(.systemBackground))
                .cornerRadius(12)
                .shadow(color: Color.black.opacity(0.05), radius: 5)

                // Extra Bed Section
                VStack(alignment: .leading, spacing: 15) {
                    HStack {
                        Text("Extra Bed")
                            .font(.headline)
                            .foregroundColor(.secondary)

                        Spacer()

                        Image(systemName: "bed.double.fill")
                            .foregroundColor(.purple)
                    }

                    VStack(alignment: .leading, spacing: 5) {
                        Text("Number of Extra Beds")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        Stepper("Count: \(formState.extraBedCount)", value: $formState.extraBedCount, in: 0...5)
                            .padding(12)
                            .background(Color(.systemGray6))
                            .cornerRadius(8)
                    }

                    if formState.extraBedCount > 0 {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("Charge per Extra Bed")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            HStack {
                                Text("$")
                                    .foregroundColor(.secondary)

                                TextField("0.00", text: $formState.extraBedCharge)
                                    .keyboardType(.decimalPad)
                                    .textFieldStyle(.roundedBorder)

                                Text("per night")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }

                        // Total extra bed charge
                        if let chargePerBed = Double(formState.extraBedCharge), chargePerBed > 0 {
                            let totalCharge = chargePerBed * Double(formState.extraBedCount) * Double(formState.numberOfNights())

                            HStack {
                                Text("Total Extra Bed Charge:")
                                    .font(.caption)
                                    .foregroundColor(.secondary)

                                Spacer()

                                Text("$\(totalCharge, specifier: "%.2f")")
                                    .font(.caption)
                                    .fontWeight(.semibold)
                                    .foregroundColor(.green)
                            }
                            .padding(10)
                            .background(Color.green.opacity(0.05))
                            .cornerRadius(8)
                        }
                    }
                }
                .padding()
                .background(Color(.systemBackground))
                .cornerRadius(12)
                .shadow(color: Color.black.opacity(0.05), radius: 5)

                // Room Card Deposit Section
                VStack(alignment: .leading, spacing: 15) {
                    HStack {
                        Text("Room Card Deposit")
                            .font(.headline)
                            .foregroundColor(.secondary)

                        Spacer()

                        Image(systemName: "creditcard.fill")
                            .foregroundColor(.green)
                    }

                    VStack(alignment: .leading, spacing: 5) {
                        Text("Deposit Amount")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        HStack {
                            Text("$")
                                .foregroundColor(.secondary)

                            TextField("0.00", text: $formState.roomCardDeposit)
                                .keyboardType(.decimalPad)
                                .textFieldStyle(.roundedBorder)
                        }
                    }

                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "info.circle")
                            .foregroundColor(.blue)
                            .font(.caption)

                        Text("Refundable deposit for room access card. Will be returned upon checkout when card is returned.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(10)
                    .background(Color.blue.opacity(0.05))
                    .cornerRadius(8)
                }
                .padding()
                .background(Color(.systemBackground))
                .cornerRadius(12)
                .shadow(color: Color.black.opacity(0.05), radius: 5)

                // Internal Notes Section (Staff Only)
                VStack(alignment: .leading, spacing: 15) {
                    HStack {
                        Text("Internal Notes")
                            .font(.headline)
                            .foregroundColor(.secondary)

                        Spacer()

                        HStack(spacing: 4) {
                            Image(systemName: "lock.fill")
                                .font(.caption)
                            Text("Staff Only")
                                .font(.caption)
                        }
                        .foregroundColor(.red)
                    }

                    VStack(alignment: .leading, spacing: 5) {
                        Text("Notes visible only to staff members")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        TextEditor(text: $formState.internalNotes)
                            .frame(height: 100)
                            .padding(8)
                            .background(Color(.systemGray6))
                            .cornerRadius(8)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(Color(.systemGray4), lineWidth: 1)
                            )
                    }
                }
                .padding()
                .background(Color(.systemBackground))
                .cornerRadius(12)
                .shadow(color: Color.black.opacity(0.05), radius: 5)

                // Summary Info
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                        Text("All information is optional in this section")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
                .padding(.top, 10)
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground))
    }

    // Common requests data
    private let commonRequests = [
        "Early Check-In",
        "Late Check-Out",
        "High Floor",
        "Quiet Room",
        "Non-Smoking",
        "Extra Towels"
    ]

    // Helper function to add common request
    private func addCommonRequest(_ request: String) {
        if formState.specialRequests.isEmpty {
            formState.specialRequests = request
        } else {
            formState.specialRequests += "\n" + request
        }
    }
}

// MARK: - Preview

struct OtherInfoView_Previews: PreviewProvider {
    static var previews: some View {
        OtherInfoView(formState: CheckInFormState())
    }
}
