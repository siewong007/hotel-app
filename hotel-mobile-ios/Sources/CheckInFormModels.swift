//
//  CheckInFormModels.swift
//  HotelMobileIOS
//
//  Created for Phase 3 - Enhanced Check-In Implementation
//

import Foundation
import SwiftUI

// MARK: - Enhanced Check-In Request Model

struct EnhancedCheckInRequest: Codable {
    // Guest information
    let guestUpdate: GuestUpdateFields?

    // Booking information
    let marketCode: String?
    let discountPercentage: Decimal?
    let rateOverrideWeekday: Decimal?
    let rateOverrideWeekend: Decimal?
    let checkInTime: String?
    let checkOutTime: String?
    let numberOfGuests: Int?
    let specialRequests: String?

    enum CodingKeys: String, CodingKey {
        case guestUpdate = "guest_update"
        case marketCode = "market_code"
        case discountPercentage = "discount_percentage"
        case rateOverrideWeekday = "rate_override_weekday"
        case rateOverrideWeekend = "rate_override_weekend"
        case checkInTime = "check_in_time"
        case checkOutTime = "check_out_time"
        case numberOfGuests = "number_of_guests"
        case specialRequests = "special_requests"
    }
}

struct GuestUpdateFields: Codable {
    let title: String?
    let firstName: String?
    let lastName: String?
    let email: String?
    let phone: String?
    let altPhone: String?
    let nationality: String?
    let icNumber: String?
    let addressLine1: String?
    let city: String?
    let stateProvince: String?
    let postalCode: String?
    let country: String?

    enum CodingKeys: String, CodingKey {
        case title
        case firstName = "first_name"
        case lastName = "last_name"
        case email
        case phone
        case altPhone = "alt_phone"
        case nationality
        case icNumber = "ic_number"
        case addressLine1 = "address_line1"
        case city
        case stateProvince = "state_province"
        case postalCode = "postal_code"
        case country
    }
}

// MARK: - Form State Management

class CheckInFormState: ObservableObject {
    // Tab state
    @Published var selectedTab = 0

    // Personal Information (Tab 1)
    @Published var title: String = ""
    @Published var firstName: String = ""
    @Published var lastName: String = ""
    @Published var addressLine1: String = ""
    @Published var city: String = ""
    @Published var stateProvince: String = ""
    @Published var postalCode: String = ""
    @Published var country: String = ""
    @Published var phone: String = ""
    @Published var altPhone: String = ""
    @Published var icNumber: String = ""
    @Published var nationality: String = ""

    // Stay Information (Tab 2)
    @Published var checkInDate: Date = Date()
    @Published var checkOutDate: Date = Date().addingTimeInterval(86400) // +1 day
    @Published var checkInTime: Date = Calendar.current.date(bySettingHour: 15, minute: 0, second: 0, of: Date()) ?? Date()
    @Published var checkOutTime: Date = Calendar.current.date(bySettingHour: 11, minute: 0, second: 0, of: Date()) ?? Date()
    @Published var numberOfAdults: Int = 1
    @Published var numberOfChildren: Int = 0
    @Published var roomNumber: String = ""
    @Published var roomType: String = ""
    @Published var rateCode: String = "RACK"
    @Published var discountPercentage: String = "0"
    @Published var rateOverrideWeekday: String = ""
    @Published var rateOverrideWeekend: String = ""

    // Payment Information (Tab 3)
    @Published var paymentMethod: String = "Credit Card"
    @Published var marketCode: String = "WKII"

    // Other Information (Tab 4)
    @Published var specialRequests: String = ""
    @Published var tourismTax: String = "0"
    @Published var extraBedCount: Int = 0
    @Published var extraBedCharge: String = "0"
    @Published var roomCardDeposit: String = "0"
    @Published var internalNotes: String = ""

    // Validation
    @Published var validationErrors: [String: String] = [:]

    // Initialize from existing booking and guest
    func initialize(from booking: BookingWithDetails, guest: Guest) {
        // Personal information
        self.title = guest.title ?? ""
        self.firstName = guest.firstName ?? ""
        self.lastName = guest.lastName ?? ""
        self.addressLine1 = guest.addressLine1 ?? ""
        self.city = guest.city ?? ""
        self.stateProvince = guest.stateProvince ?? ""
        self.postalCode = guest.postalCode ?? ""
        self.country = guest.country ?? ""
        self.phone = guest.phone ?? ""
        self.altPhone = guest.altPhone ?? ""
        self.icNumber = guest.icNumber ?? ""
        self.nationality = guest.nationality ?? ""

        // Stay information
        self.checkInDate = booking.checkInDate
        self.checkOutDate = booking.checkOutDate
        self.roomNumber = booking.roomNumber
        self.roomType = booking.roomType
        self.rateCode = booking.rateCode ?? "RACK"
        self.numberOfAdults = booking.numberOfGuests ?? 1

        // Parse times if available
        if let checkInTimeStr = booking.checkInTime {
            self.checkInTime = parseTime(checkInTimeStr) ?? self.checkInTime
        }
        if let checkOutTimeStr = booking.checkOutTime {
            self.checkOutTime = parseTime(checkOutTimeStr) ?? self.checkOutTime
        }

        // Other fields
        if let discount = booking.discountPercentage {
            self.discountPercentage = "\(discount)"
        }
        if let weekdayRate = booking.rateOverrideWeekday {
            self.rateOverrideWeekday = "\(weekdayRate)"
        }
        if let weekendRate = booking.rateOverrideWeekend {
            self.rateOverrideWeekend = "\(weekendRate)"
        }

        self.marketCode = booking.marketCode ?? "WKII"
        self.specialRequests = booking.specialRequests ?? ""
    }

    // Validate required fields
    func validate() -> Bool {
        validationErrors.removeAll()

        if firstName.isEmpty {
            validationErrors["firstName"] = "First name is required"
        }
        if lastName.isEmpty {
            validationErrors["lastName"] = "Last name is required"
        }

        return validationErrors.isEmpty
    }

    // Convert form state to API request
    func toCheckInRequest() -> EnhancedCheckInRequest {
        let guestUpdate = GuestUpdateFields(
            title: title.isEmpty ? nil : title,
            firstName: firstName.isEmpty ? nil : firstName,
            lastName: lastName.isEmpty ? nil : lastName,
            email: nil, // Not editable in check-in
            phone: phone.isEmpty ? nil : phone,
            altPhone: altPhone.isEmpty ? nil : altPhone,
            nationality: nationality.isEmpty ? nil : nationality,
            icNumber: icNumber.isEmpty ? nil : icNumber,
            addressLine1: addressLine1.isEmpty ? nil : addressLine1,
            city: city.isEmpty ? nil : city,
            stateProvince: stateProvince.isEmpty ? nil : stateProvince,
            postalCode: postalCode.isEmpty ? nil : postalCode,
            country: country.isEmpty ? nil : country
        )

        let timeFormatter = DateFormatter()
        timeFormatter.dateFormat = "HH:mm"

        return EnhancedCheckInRequest(
            guestUpdate: guestUpdate,
            marketCode: marketCode.isEmpty ? nil : marketCode,
            discountPercentage: Decimal(string: discountPercentage),
            rateOverrideWeekday: Decimal(string: rateOverrideWeekday),
            rateOverrideWeekend: Decimal(string: rateOverrideWeekend),
            checkInTime: timeFormatter.string(from: checkInTime),
            checkOutTime: timeFormatter.string(from: checkOutTime),
            numberOfGuests: numberOfAdults + numberOfChildren,
            specialRequests: specialRequests.isEmpty ? nil : specialRequests
        )
    }

    // Helper to parse time string
    private func parseTime(_ timeString: String) -> Date? {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        if let time = formatter.date(from: timeString) {
            let calendar = Calendar.current
            let components = calendar.dateComponents([.hour, .minute], from: time)
            return calendar.date(bySettingHour: components.hour ?? 0, minute: components.minute ?? 0, second: 0, of: Date())
        }
        return nil
    }

    // Computed property for total guests
    var totalGuests: Int {
        numberOfAdults + numberOfChildren
    }

    // Computed property for number of nights
    func numberOfNights() -> Int {
        let calendar = Calendar.current
        let components = calendar.dateComponents([.day], from: checkInDate, to: checkOutDate)
        return max(components.day ?? 1, 1)
    }
}

// MARK: - Supporting Types

struct TitleOption: Identifiable {
    let id = UUID()
    let value: String

    static let options = [
        TitleOption(value: "Mr"),
        TitleOption(value: "Mrs"),
        TitleOption(value: "Ms"),
        TitleOption(value: "Dr"),
        TitleOption(value: "Prof")
    ]
}

struct RateCodeOption: Identifiable {
    let id = UUID()
    let code: String
    let name: String

    static let options = [
        RateCodeOption(code: "RACK", name: "Rack Rate"),
        RateCodeOption(code: "OVR", name: "Override Rate"),
        RateCodeOption(code: "CORP", name: "Corporate"),
        RateCodeOption(code: "GOV", name: "Government"),
        RateCodeOption(code: "AAA", name: "AAA Discount")
    ]
}

struct MarketCodeOption: Identifiable {
    let id = UUID()
    let code: String
    let name: String

    static let options = [
        MarketCodeOption(code: "WKII", name: "Walk-In"),
        MarketCodeOption(code: "DIRECT", name: "Direct Booking"),
        MarketCodeOption(code: "OTA", name: "Online Travel Agency"),
        MarketCodeOption(code: "CORP", name: "Corporate"),
        MarketCodeOption(code: "GRP", name: "Group")
    ]
}

struct PaymentMethodOption: Identifiable {
    let id = UUID()
    let value: String

    static let options = [
        PaymentMethodOption(value: "Credit Card"),
        PaymentMethodOption(value: "Debit Card"),
        PaymentMethodOption(value: "Cash"),
        PaymentMethodOption(value: "Bank Transfer"),
        PaymentMethodOption(value: "Invoice")
    ]
}
