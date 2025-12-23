//
//  PaymentInfoView.swift
//  HotelMobileIOS
//
//  Tab 3: Payment Information for Enhanced Check-In
//

import SwiftUI

struct PaymentInfoView: View {
    @ObservedObject var formState: CheckInFormState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Header
                Text("Payment Information")
                    .font(.title2)
                    .fontWeight(.bold)
                    .padding(.bottom, 10)

                // Important Notice
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundColor(.orange)
                            .font(.title3)

                        VStack(alignment: .leading, spacing: 5) {
                            Text("Payment Method Selection Only")
                                .font(.headline)
                                .foregroundColor(.orange)

                            Text("This section is for selecting your payment method. No card information will be collected or processed at this time. Actual payment will be handled at the front desk during check-in.")
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .padding()
                .background(Color.orange.opacity(0.1))
                .cornerRadius(12)

                // Payment Method Section
                VStack(alignment: .leading, spacing: 15) {
                    Text("Payment Method")
                        .font(.headline)
                        .foregroundColor(.secondary)

                    VStack(alignment: .leading, spacing: 5) {
                        Text("Select Payment Method")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        Picker("Payment Method", selection: $formState.paymentMethod) {
                            ForEach(PaymentMethodOption.options) { option in
                                HStack {
                                    paymentIcon(for: option.value)
                                    Text(option.value)
                                }
                                .tag(option.value)
                            }
                        }
                        .pickerStyle(.menu)
                        .padding(12)
                        .background(Color(.systemGray6))
                        .cornerRadius(8)
                    }

                    // Selected payment method display
                    HStack {
                        paymentIcon(for: formState.paymentMethod)
                            .font(.title2)

                        VStack(alignment: .leading, spacing: 3) {
                            Text("Selected Method")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            Text(formState.paymentMethod)
                                .font(.body)
                                .fontWeight(.medium)
                        }

                        Spacer()

                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                    }
                    .padding()
                    .background(Color(.systemBackground))
                    .cornerRadius(8)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color.green, lineWidth: 2)
                    )
                }
                .padding()
                .background(Color(.systemBackground))
                .cornerRadius(12)
                .shadow(color: Color.black.opacity(0.05), radius: 5)

                // Market Code Section
                VStack(alignment: .leading, spacing: 15) {
                    Text("Booking Source")
                        .font(.headline)
                        .foregroundColor(.secondary)

                    VStack(alignment: .leading, spacing: 5) {
                        Text("Market Code")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        Picker("Market Code", selection: $formState.marketCode) {
                            ForEach(MarketCodeOption.options) { option in
                                Text("\(option.code) - \(option.name)").tag(option.code)
                            }
                        }
                        .pickerStyle(.menu)
                        .padding(12)
                        .background(Color(.systemGray6))
                        .cornerRadius(8)
                    }

                    // Market code description
                    if let selectedMarket = MarketCodeOption.options.first(where: { $0.code == formState.marketCode }) {
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "info.circle")
                                .foregroundColor(.blue)

                            Text(marketCodeDescription(for: selectedMarket.code))
                                .font(.caption)
                                .foregroundColor(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(10)
                        .background(Color.blue.opacity(0.05))
                        .cornerRadius(8)
                    }
                }
                .padding()
                .background(Color(.systemBackground))
                .cornerRadius(12)
                .shadow(color: Color.black.opacity(0.05), radius: 5)

                // Nationality Section (for tourism tax purposes)
                VStack(alignment: .leading, spacing: 15) {
                    Text("Additional Information")
                        .font(.headline)
                        .foregroundColor(.secondary)

                    VStack(alignment: .leading, spacing: 5) {
                        Text("Nationality (for Tourism Tax)")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        TextField("Nationality", text: $formState.nationality)
                            .textFieldStyle(.roundedBorder)
                            .autocapitalization(.words)
                            .disabled(true) // Read from Personal Info tab
                            .foregroundColor(.secondary)
                    }

                    Text("Nationality is used to calculate applicable tourism tax rates")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .italic()
                }
                .padding()
                .background(Color(.systemBackground))
                .cornerRadius(12)
                .shadow(color: Color.black.opacity(0.05), radius: 5)

                // Info Footer
                HStack {
                    Image(systemName: "lock.shield.fill")
                        .foregroundColor(.green)
                    Text("No payment will be processed at this stage")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(.top, 10)
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground))
    }

    // Helper function to get payment icon
    private func paymentIcon(for method: String) -> Image {
        switch method {
        case "Credit Card":
            return Image(systemName: "creditcard.fill")
        case "Debit Card":
            return Image(systemName: "creditcard")
        case "Cash":
            return Image(systemName: "dollarsign.circle.fill")
        case "Bank Transfer":
            return Image(systemName: "building.columns.fill")
        case "Invoice":
            return Image(systemName: "doc.text.fill")
        default:
            return Image(systemName: "questionmark.circle")
        }
    }

    // Helper function to get market code description
    private func marketCodeDescription(for code: String) -> String {
        switch code {
        case "WKII":
            return "Guest arrived without prior reservation and booked on-site"
        case "DIRECT":
            return "Booking made directly through hotel website or phone"
        case "OTA":
            return "Booking made through online travel agencies like Booking.com, Expedia, etc."
        case "CORP":
            return "Corporate booking with negotiated rates"
        case "GRP":
            return "Group booking for events or conferences"
        default:
            return "Market segment for booking analytics"
        }
    }
}

// MARK: - Preview

struct PaymentInfoView_Previews: PreviewProvider {
    static var previews: some View {
        PaymentInfoView(formState: CheckInFormState())
    }
}
