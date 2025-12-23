# Hotel Booking Application

A comprehensive iOS hotel booking application with advanced authentication features including eKYC verification, passkey authentication, and two-factor authentication.

## Features

### 1. **Guest Management & Authentication**
- User registration with guest profile creation
- Email/password login
- Passkey authentication (iOS 16+)
- Two-factor authentication (2FA) with QR code setup
- Secure token-based authentication
- Keychain integration for credential storage

### 2. **eKYC Verification**
- Identity document verification (Passport, National ID, Driver License)
- Document photo capture (front, back, selfie)
- Camera and photo library integration
- Verification status tracking
- Required before booking rooms

### 3. **Room Browsing & Booking**
- Search available rooms by date range and guest count
- View room details with images and amenities
- Real-time availability checking
- Booking creation with special requests
- Price calculation based on nights

### 4. **My Bookings**
- View all bookings with status badges
- Detailed booking information
- Booking cancellation (swipe to cancel)
- Booking status tracking:
  - Pending
  - Confirmed
  - Checked In
  - Checked Out
  - Cancelled

### 5. **Profile & Security Settings**
- User profile management
- Enable/disable two-factor authentication
- Passkey registration
- eKYC status viewing
- Account logout

## Architecture

### Model Layer (`Models.swift`)
- **Guest**: User profile information
- **Room**: Hotel room details and availability
- **Booking**: Booking information and status
- **User**: Authentication user data
- **EKYCDocument**: Identity verification documents
- **Authentication Models**: Passkey, 2FA, and auth responses

### Manager Layer
- **AuthManager** (`AuthManager.swift`): Handles all authentication flows
  - Login/logout
  - Passkey registration and authentication
  - Two-factor authentication setup and verification
  - eKYC submission and status checking
  - Session management with token refresh
  
- **APIManager** (`APIManager.swift`): Backend API communication
  - RESTful API integration
  - Authentication APIs
  - Room management APIs
  - Booking APIs
  - eKYC APIs
  - Multipart form data for image uploads

- **NetworkMonitor** (`NetworkMonitor.swift`): Network connectivity monitoring
  - Real-time connection status
  - Connection type detection (WiFi, Cellular, Ethernet)

### View Controllers

#### Authentication Flow
- **LoginViewController**: Email/password and passkey login
- **RegisterViewController**: New user registration
- **TwoFactorSetupViewController**: 2FA setup with QR code

#### Main App Flow
- **HotelTabViewController**: Tab bar container with three tabs
  - Available Rooms
  - My Bookings
  - Profile

#### Rooms & Booking
- **RoomListViewController**: Browse and search available rooms
- **RoomDetailViewController**: Detailed room information and booking
- **MyBookingsViewController**: List of user's bookings
- **BookingDetailViewController**: Detailed booking information

#### Profile & Security
- **ProfileViewController**: User profile and security settings
- **EKYCViewController**: Identity verification workflow

### Scene Management
- **SceneDelegate**: App scene lifecycle and authentication state management
  - Shows login screen for unauthenticated users
  - Shows main tab interface for authenticated users
  - Handles login/logout navigation

## API Integration

The app communicates with a backend API at `https://api.hotelapp.com/v1` with the following endpoints:

### Authentication
- `POST /auth/login` - Email/password login
- `POST /auth/register` - User registration
- `POST /auth/refresh` - Token refresh
- `POST /auth/passkey/challenge` - Get passkey challenge
- `POST /auth/passkey/register` - Register passkey credential
- `POST /auth/passkey/verify` - Verify passkey authentication

### Two-Factor Authentication
- `POST /auth/2fa/enable` - Enable 2FA
- `POST /auth/2fa/verify` - Verify 2FA code
- `POST /auth/2fa/disable` - Disable 2FA

### eKYC
- `POST /ekyc/submit` - Submit identity documents (multipart)
- `GET /ekyc/status/:guestId` - Get verification status

### Rooms
- `GET /rooms/available` - Get available rooms
- `GET /rooms/:roomId` - Get room details

### Bookings
- `POST /bookings` - Create new booking
- `GET /bookings/guest/:guestId` - Get guest's bookings
- `GET /bookings/:bookingId` - Get booking details
- `POST /bookings/:bookingId/cancel` - Cancel booking
- `PUT /bookings/:bookingId` - Update booking

### Guests
- `PUT /guests/:guestId` - Update guest information

## Security Features

### 1. Keychain Storage
- Secure storage of authentication tokens
- Refresh token persistence
- Automatic credential cleanup on logout

### 2. Passkey Support
- Face ID / Touch ID integration
- WebAuthn-compatible implementation
- Passwordless authentication

### 3. Two-Factor Authentication
- Time-based one-time passwords (TOTP)
- QR code generation for authenticator apps
- Backup codes for account recovery
- Optional enforcement

### 4. eKYC Verification
- Document image capture and validation
- Selfie verification
- Status tracking (pending, verified, rejected)
- Expiry date management

### 5. Token-Based Authentication
- Bearer token authentication
- Automatic token refresh
- Secure HTTP header injection

## Data Flow

### Authentication Flow
1. User enters credentials → LoginViewController
2. LoginViewController → AuthManager.login()
3. AuthManager → APIManager.login()
4. API returns AuthResponse with token and user
5. AuthManager stores token in Keychain
6. AuthManager posts "UserDidLogin" notification
7. SceneDelegate receives notification
8. SceneDelegate transitions to HotelTabViewController

### Booking Flow
1. User searches for rooms → RoomListViewController
2. RoomListViewController → APIManager.getAvailableRooms()
3. User selects room → RoomDetailViewController
4. User attempts booking → checks eKYC status
5. If not verified → navigate to EKYCViewController
6. If verified → APIManager.createBooking()
7. Booking confirmed → BookingResponse
8. Navigate to MyBookingsViewController

### eKYC Flow
1. User navigates to EKYCViewController
2. User selects document type
3. User captures/uploads images
4. EKYCViewController → AuthManager.submitEKYC()
5. AuthManager → APIManager.submitEKYC() (multipart)
6. Server processes and returns EKYCDocument
7. Status tracked in user profile

## UI Components

### Custom Cells
- **RoomTableViewCell**: Displays room information in list
- **BookingTableViewCell**: Displays booking with status badge

### Reusable Elements
- Status badges with color coding
- Image loading with placeholder fallbacks
- Detail rows with label/value pairs
- Activity indicators for async operations
- Alert controllers for user feedback

## Error Handling

### Auth Errors
- `notAuthenticated`: User not logged in
- `invalidCredentials`: Wrong email/password
- `passkeyNotSupported`: Device doesn't support passkeys
- `twoFactorRequired`: 2FA code needed
- `eKYCRequired`: Verification needed for booking
- `eKYCPending`: Verification in progress

### API Errors
- `invalidURL`: Malformed endpoint
- `invalidResponse`: Server returned unexpected data
- `httpError`: HTTP status code error
- `serverError`: Server-side error with message
- `decodingError`: Failed to parse response
- `networkError`: Network connectivity issue

## Requirements

- iOS 15.0+
- Xcode 14.0+
- Swift 5.7+
- Camera and photo library access for eKYC

## Configuration

### Info.plist Additions Required

```xml
<key>NSCameraUsageDescription</key>
<string>We need access to your camera to capture identity documents for verification</string>

<key>NSPhotoLibraryUsageDescription</key>
<string>We need access to your photo library to upload identity documents for verification</string>
```

### API Base URL Configuration

Update the base URL in `APIManager.swift`:
```swift
private let baseURL = "https://api.hotelapp.com/v1"
```

### Associated Domains (for Passkey)

Add to Xcode project entitlements:
```xml
<key>com.apple.developer.associated-domains</key>
<array>
    <string>webcredentials:hotelapp.com</string>
</array>
```

## Usage Examples

### Login
```swift
Task {
    do {
        let user = try await AuthManager.shared.login(
            email: "user@example.com",
            password: "password123"
        )
        print("Logged in as \(user.email)")
    } catch {
        print("Login failed: \(error)")
    }
}
```

### Create Booking
```swift
Task {
    do {
        let booking = try await APIManager.shared.createBooking(
            guestId: guest.id,
            roomId: room.id,
            checkIn: Date(),
            checkOut: Date().addingTimeInterval(86400),
            numberOfGuests: 2,
            specialRequests: "Late check-in please"
        )
        print("Booking created: \(booking.id)")
    } catch {
        print("Booking failed: \(error)")
    }
}
```

### Enable 2FA
```swift
Task {
    do {
        let setup = try await AuthManager.shared.enable2FA()
        // Display QR code from setup.qrCodeURL
        // Get verification code from user
        let verified = try await AuthManager.shared.verify2FA(code: userCode)
        if verified {
            print("2FA enabled successfully")
        }
    } catch {
        print("2FA setup failed: \(error)")
    }
}
```

## Testing

The app uses modern Swift Concurrency (async/await) throughout. For testing, you can:

1. Mock the APIManager for unit tests
2. Test authentication flows with test credentials
3. Test UI navigation with UI tests
4. Verify eKYC upload with sample images

## Future Enhancements

- [ ] Payment integration (Stripe, Apple Pay)
- [ ] Push notifications for booking updates
- [ ] Room favorites and wishlist
- [ ] Booking history export
- [ ] Multi-language support
- [ ] Dark mode optimization
- [ ] Accessibility improvements
- [ ] Offline mode with local caching
- [ ] Review and rating system
- [ ] Social login (Sign in with Apple, Google)

## License

Copyright © 2025. All rights reserved.
