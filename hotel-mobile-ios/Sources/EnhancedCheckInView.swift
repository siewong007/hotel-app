//
//  EnhancedCheckInView.swift
//  HotelMobileIOS
//
//  Main Enhanced Check-In View with 4-Tab Interface
//

import SwiftUI

struct EnhancedCheckInView: View {
    let booking: BookingWithDetails
    let guest: Guest
    @Environment(\.presentationMode) var presentationMode
    @StateObject private var formState = CheckInFormState()
    @State private var isSubmitting = false
    @State private var showSuccessAlert = false
    @State private var showErrorAlert = false
    @State private var errorMessage = ""

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Tab Bar
                TabView(selection: $formState.selectedTab) {
                    // Tab 1: Personal Information
                    PersonalInfoView(formState: formState)
                        .tabItem {
                            Label("Personal", systemImage: "person.fill")
                        }
                        .tag(0)

                    // Tab 2: Stay Information
                    StayInfoView(formState: formState)
                        .tabItem {
                            Label("Stay", systemImage: "calendar")
                        }
                        .tag(1)

                    // Tab 3: Payment Information
                    PaymentInfoView(formState: formState)
                        .tabItem {
                            Label("Payment", systemImage: "creditcard")
                        }
                        .tag(2)

                    // Tab 4: Other Information
                    OtherInfoView(formState: formState)
                        .tabItem {
                            Label("Other", systemImage: "ellipsis.circle")
                        }
                        .tag(3)
                }

                // Action Buttons
                VStack(spacing: 12) {
                    Divider()

                    HStack(spacing: 15) {
                        // Cancel Button
                        Button(action: {
                            presentationMode.wrappedValue.dismiss()
                        }) {
                            Text("Cancel")
                                .font(.headline)
                                .frame(maxWidth: .infinity)
                                .padding()
                                .background(Color(.systemGray5))
                                .foregroundColor(.primary)
                                .cornerRadius(10)
                        }
                        .disabled(isSubmitting)

                        // Submit Button
                        Button(action: {
                            submitCheckIn()
                        }) {
                            HStack {
                                if isSubmitting {
                                    ProgressView()
                                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                        .scaleEffect(0.8)
                                }
                                Text(isSubmitting ? "Processing..." : "Complete Check-In")
                                    .font(.headline)
                            }
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(isSubmitting ? Color.gray : Color.blue)
                            .foregroundColor(.white)
                            .cornerRadius(10)
                        }
                        .disabled(isSubmitting)
                    }
                    .padding(.horizontal)
                    .padding(.bottom, 10)
                }
                .background(Color(.systemBackground))
            }
            .navigationTitle("Enhanced Check-In")
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarItems(trailing: Button("Close") {
                presentationMode.wrappedValue.dismiss()
            })
            .onAppear {
                // Initialize form with booking and guest data
                formState.initialize(from: booking, guest: guest)
            }
            .alert(isPresented: $showSuccessAlert) {
                Alert(
                    title: Text("Check-In Complete"),
                    message: Text("Guest check-in has been successfully processed."),
                    dismissButton: .default(Text("OK")) {
                        presentationMode.wrappedValue.dismiss()
                    }
                )
            }
            .alert(isPresented: $showErrorAlert) {
                Alert(
                    title: Text("Check-In Failed"),
                    message: Text(errorMessage),
                    dismissButton: .default(Text("OK"))
                )
            }
        }
    }

    // MARK: - Submit Check-In

    private func submitCheckIn() {
        // Validate form
        guard formState.validate() else {
            errorMessage = "Please fill in all required fields (marked with *)"
            showErrorAlert = true
            // Switch to first tab if there are validation errors
            formState.selectedTab = 0
            return
        }

        isSubmitting = true

        Task {
            do {
                let checkInRequest = formState.toCheckInRequest()
                let _ = try await HotelAPIService.shared.performEnhancedCheckIn(
                    bookingId: String(booking.id),
                    checkInData: checkInRequest
                )

                // Success
                await MainActor.run {
                    isSubmitting = false
                    showSuccessAlert = true
                }
            } catch {
                // Error
                await MainActor.run {
                    isSubmitting = false
                    errorMessage = error.localizedDescription
                    showErrorAlert = true
                }
            }
        }
    }
}

// MARK: - Booking Summary Card (Optional Helper View)

struct BookingSummaryCard: View {
    let booking: BookingWithDetails
    let guest: Guest

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 5) {
                    Text(guest.displayName)
                        .font(.headline)

                    Text("Room \(booking.roomNumber) - \(booking.roomType)")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 5) {
                    Text(booking.folioNumber ?? "N/A")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Text(booking.status.uppercased())
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundColor(statusColor(for: booking.status))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(statusColor(for: booking.status).opacity(0.1))
                        .cornerRadius(4)
                }
            }

            Divider()

            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Check-In")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text(formatDate(booking.checkInDate))
                        .font(.subheadline)
                        .fontWeight(.medium)
                }

                Spacer()

                VStack(alignment: .leading, spacing: 3) {
                    Text("Check-Out")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text(formatDate(booking.checkOutDate))
                        .font(.subheadline)
                        .fontWeight(.medium)
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 3) {
                    Text("Total")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text(booking.totalAmountString)
                        .font(.subheadline)
                        .fontWeight(.bold)
                        .foregroundColor(.green)
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: Color.black.opacity(0.05), radius: 5)
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        return formatter.string(from: date)
    }

    private func statusColor(for status: String) -> Color {
        switch status.lowercased() {
        case "confirmed":
            return .blue
        case "checked_in":
            return .green
        case "checked_out":
            return .gray
        case "cancelled":
            return .red
        default:
            return .orange
        }
    }
}

// MARK: - Preview

struct EnhancedCheckInView_Previews: PreviewProvider {
    static var previews: some View {
        // Create sample booking and guest for preview
        let sampleGuest = Guest(
            id: 1,
            firstName: "John",
            lastName: "Doe",
            fullName: "John Doe",
            email: "john.doe@example.com",
            phone: "+1234567890",
            altPhone: nil,
            title: "Mr",
            nationality: "USA",
            icNumber: "A1234567",
            addressLine1: "123 Main St",
            city: "New York",
            stateProvince: "NY",
            postalCode: "10001",
            country: "USA",
            createdAt: nil,
            updatedAt: nil
        )

        let sampleBooking = BookingWithDetails(
            id: 1,
            guestId: 1,
            guestName: "John Doe",
            guestEmail: "john.doe@example.com",
            roomId: 101,
            roomNumber: "101",
            roomType: "Deluxe",
            checkInDate: Date(),
            checkOutDate: Date().addingTimeInterval(86400 * 3),
            totalAmount: Decimal(450.00),
            status: "confirmed",
            folioNumber: "FOLIO123",
            postType: nil,
            rateCode: "RACK",
            marketCode: "DIRECT",
            discountPercentage: nil,
            rateOverrideWeekday: nil,
            rateOverrideWeekend: nil,
            checkInTime: "15:00",
            checkOutTime: "11:00",
            numberOfGuests: 2,
            specialRequests: nil,
            preCheckinCompleted: false,
            preCheckinCompletedAt: nil,
            createdAt: Date()
        )

        EnhancedCheckInView(booking: sampleBooking, guest: sampleGuest)
    }
}
