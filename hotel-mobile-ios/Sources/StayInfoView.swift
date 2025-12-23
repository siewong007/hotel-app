//
//  StayInfoView.swift
//  HotelMobileIOS
//
//  Tab 2: Stay Information for Enhanced Check-In
//

import SwiftUI

struct StayInfoView: View {
    @ObservedObject var formState: CheckInFormState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Header
                Text("Stay Information")
                    .font(.title2)
                    .fontWeight(.bold)
                    .padding(.bottom, 10)

                // Check-In Details Section
                VStack(alignment: .leading, spacing: 15) {
                    Text("Check-In")
                        .font(.headline)
                        .foregroundColor(.secondary)

                    HStack(spacing: 15) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("Date")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            DatePicker("", selection: $formState.checkInDate, displayedComponents: .date)
                                .labelsHidden()
                                .frame(maxWidth: .infinity)
                        }

                        VStack(alignment: .leading, spacing: 5) {
                            Text("Time")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            DatePicker("", selection: $formState.checkInTime, displayedComponents: .hourAndMinute)
                                .labelsHidden()
                                .frame(maxWidth: .infinity)
                        }
                    }

                    // Day of week display
                    Text(dayOfWeek(for: formState.checkInDate))
                        .font(.caption)
                        .foregroundColor(.blue)
                }
                .padding()
                .background(Color(.systemBackground))
                .cornerRadius(12)
                .shadow(color: Color.black.opacity(0.05), radius: 5)

                // Check-Out Details Section
                VStack(alignment: .leading, spacing: 15) {
                    Text("Check-Out")
                        .font(.headline)
                        .foregroundColor(.secondary)

                    HStack(spacing: 15) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("Date")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            DatePicker("", selection: $formState.checkOutDate, displayedComponents: .date)
                                .labelsHidden()
                                .frame(maxWidth: .infinity)
                        }

                        VStack(alignment: .leading, spacing: 5) {
                            Text("Time")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            DatePicker("", selection: $formState.checkOutTime, displayedComponents: .hourAndMinute)
                                .labelsHidden()
                                .frame(maxWidth: .infinity)
                        }
                    }

                    // Day of week and nights calculation
                    HStack {
                        Text(dayOfWeek(for: formState.checkOutDate))
                            .font(.caption)
                            .foregroundColor(.blue)

                        Spacer()

                        Text("\(formState.numberOfNights()) night\(formState.numberOfNights() == 1 ? "" : "s")")
                            .font(.caption)
                            .fontWeight(.semibold)
                            .foregroundColor(.green)
                    }
                }
                .padding()
                .background(Color(.systemBackground))
                .cornerRadius(12)
                .shadow(color: Color.black.opacity(0.05), radius: 5)

                // Guest Count Section
                VStack(alignment: .leading, spacing: 15) {
                    Text("Guests")
                        .font(.headline)
                        .foregroundColor(.secondary)

                    HStack(spacing: 15) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("Adults")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            Stepper("\(formState.numberOfAdults)", value: $formState.numberOfAdults, in: 1...10)
                                .padding(10)
                                .background(Color(.systemGray6))
                                .cornerRadius(8)
                        }

                        VStack(alignment: .leading, spacing: 5) {
                            Text("Children")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            Stepper("\(formState.numberOfChildren)", value: $formState.numberOfChildren, in: 0...10)
                                .padding(10)
                                .background(Color(.systemGray6))
                                .cornerRadius(8)
                        }
                    }

                    Text("Total: \(formState.totalGuests) guest\(formState.totalGuests == 1 ? "" : "s")")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding()
                .background(Color(.systemBackground))
                .cornerRadius(12)
                .shadow(color: Color.black.opacity(0.05), radius: 5)

                // Room Details Section
                VStack(alignment: .leading, spacing: 15) {
                    Text("Room Details")
                        .font(.headline)
                        .foregroundColor(.secondary)

                    VStack(alignment: .leading, spacing: 5) {
                        Text("Room Number")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        TextField("Room Number", text: $formState.roomNumber)
                            .textFieldStyle(.roundedBorder)
                            .disabled(true) // Read-only, pre-selected
                            .foregroundColor(.secondary)
                    }

                    VStack(alignment: .leading, spacing: 5) {
                        Text("Room Type")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        TextField("Room Type", text: $formState.roomType)
                            .textFieldStyle(.roundedBorder)
                            .disabled(true) // Read-only, pre-selected
                            .foregroundColor(.secondary)
                    }
                }
                .padding()
                .background(Color(.systemBackground))
                .cornerRadius(12)
                .shadow(color: Color.black.opacity(0.05), radius: 5)

                // Rate Information Section
                VStack(alignment: .leading, spacing: 15) {
                    Text("Rate Information")
                        .font(.headline)
                        .foregroundColor(.secondary)

                    VStack(alignment: .leading, spacing: 5) {
                        Text("Rate Code")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        Picker("Rate Code", selection: $formState.rateCode) {
                            ForEach(RateCodeOption.options) { option in
                                Text("\(option.code) - \(option.name)").tag(option.code)
                            }
                        }
                        .pickerStyle(.menu)
                        .padding(10)
                        .background(Color(.systemGray6))
                        .cornerRadius(8)
                    }

                    VStack(alignment: .leading, spacing: 5) {
                        Text("Discount (%)")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        TextField("0", text: $formState.discountPercentage)
                            .textFieldStyle(.roundedBorder)
                            .keyboardType(.decimalPad)
                    }

                    HStack(spacing: 15) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("Weekday Rate Override")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            TextField("Optional", text: $formState.rateOverrideWeekday)
                                .textFieldStyle(.roundedBorder)
                                .keyboardType(.decimalPad)
                        }

                        VStack(alignment: .leading, spacing: 5) {
                            Text("Weekend Rate Override")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            TextField("Optional", text: $formState.rateOverrideWeekend)
                                .textFieldStyle(.roundedBorder)
                                .keyboardType(.decimalPad)
                        }
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
                    Text("Room details are pre-selected and cannot be changed")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(.top, 10)
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground))
    }

    // Helper function to get day of week
    private func dayOfWeek(for date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE"
        return formatter.string(from: date)
    }
}

// MARK: - Preview

struct StayInfoView_Previews: PreviewProvider {
    static var previews: some View {
        StayInfoView(formState: CheckInFormState())
    }
}
