# Hotel Management iOS App

iOS application for the Hotel Management System with comprehensive authentication, CRUD operations, and API integration.

## 🎉 What's New

### Recently Implemented Features

- ✅ **Secure Token Storage** - Keychain integration for secure credential storage
- ✅ **Automatic Token Refresh** - Seamless token renewal without user intervention
- ✅ **Network Monitoring** - Real-time connection status tracking
- ✅ **Full CRUD Operations** - Create, Read, Update, Delete for all resources
- ✅ **Enhanced Guest Management** - Add, edit, and delete guests with details view
- ✅ **Advanced Booking Management** - Filter, cancel, and manage bookings
- ✅ **Swipe Actions** - Intuitive swipe-to-delete and swipe-to-cancel gestures
- ✅ **Pull-to-Refresh** - Easy data refresh on all list views

## Features

- 🔐 **Authentication**: Secure login with JWT tokens stored in Keychain
- 🔄 **Auto Token Refresh**: Automatic token renewal when expired
- 📶 **Network Monitoring**: Real-time connection status
- 🏨 **Room Management**: Search, view, create, update, and delete rooms
- 👥 **Guest Management**: Full CRUD operations for guest records
- 📅 **Booking Management**: View, create, update, cancel, and delete bookings
- ⚙️ **Settings**: Configure server URL and view user information
- 🔍 **Filtering**: Filter bookings by status (Confirmed, Cancelled)

## Setup

### Prerequisites

- Xcode 14.0 or later
- iOS 15.0 or later
- Swift 5.9 or later

### Configuration

1. **Update API Base URL** (if needed):
   - The default API URL is `http://localhost:3030`
   - For physical devices, update this to your computer's IP address
   - You can change it in Settings after logging in

2. **Build and Run**:
   - Open the project in Xcode
   - Select your target device or simulator
   - Build and run (⌘R)

## Authentication

### Default Credentials
- **Username**: `admin`
- **Password**: `admin123`

⚠️ **Note**: Change the default password in production!

### Login Flow

1. Launch the app
2. If not authenticated, you'll see the login screen
3. Enter username and password
4. Upon successful login, you'll be taken to the main tab interface

### Token Management

- Access tokens are stored securely in the iOS Keychain
- Refresh tokens are automatically used when access tokens expire
- Failed refresh attempts will logout the user automatically

### Logout

- Go to the Settings tab
- Tap the "Logout" button
- You'll be returned to the login screen

## API Integration

The app integrates with all backend endpoints with full CRUD support:

### Authentication Endpoints

- `POST /auth/login` - User authentication
- `POST /auth/refresh` - Token refresh

### Room Endpoints

- `GET /rooms` - Get all rooms
- `GET /rooms/:id` - Get specific room
- `GET /rooms/available` - Search available rooms
- `POST /rooms` - Create new room
- `PUT /rooms/:id` - Update room
- `DELETE /rooms/:id` - Delete room

### Guest Endpoints

- `GET /guests` - Get all guests
- `GET /guests/:id` - Get specific guest
- `POST /guests` - Create new guest
- `PUT /guests/:id` - Update guest
- `DELETE /guests/:id` - Delete guest

### Booking Endpoints

- `GET /bookings` - Get all bookings (with details)
- `GET /bookings/:id` - Get specific booking
- `POST /bookings` - Create new booking
- `PUT /bookings/:id` - Update booking
- `POST /bookings/:id/cancel` - Cancel booking
- `DELETE /bookings/:id` - Delete booking

### Analytics Endpoints

- `GET /analytics/personalized` - Get personalized reports

## Architecture

### Key Components

- **KeychainHelper**: Secure storage for sensitive data (tokens)
- **NetworkMonitor**: Real-time network connectivity monitoring
- **AuthManager**: Singleton for managing authentication state with Keychain
- **HotelAPIService**: API client with automatic token refresh
- **Models**: Data models matching backend structure (UUIDs)
- **View Controllers**: 
  - `LoginViewController`: Authentication
  - `RoomSearchViewController`: Room search and booking
  - `GuestListViewController`: Guest CRUD operations
  - `BookingListViewController`: Booking management with filtering
  - `SettingsViewController`: User settings and logout
  - `PersonalizedReportsViewController`: Analytics view

### Security Features

- **Keychain Storage**: Tokens stored in iOS Keychain (not UserDefaults)
- **Automatic Token Refresh**: Seamless re-authentication
- **Secure Communication**: All API calls use HTTPS (recommended)
- **Token Expiry Handling**: Automatic logout on refresh failure

### Data Models

All models use UUID strings (matching the backend):
- `User`: User information with roles and permissions
- `Room`: Room details with UUID
- `Guest`: Guest information with UUID
- `Booking`: Booking information with UUID
- `BookingWithDetails`: Extended booking with guest and room details

## User Guide

### Managing Guests

1. **View Guests**: Tap the Guests tab to see all guests
2. **Add Guest**: Tap the + button in the top right
3. **Edit Guest**: Tap on a guest or tap the info button
4. **Delete Guest**: Swipe left on a guest and tap Delete
5. **Refresh**: Pull down to refresh the list

### Managing Bookings

1. **View Bookings**: Tap the Bookings tab
2. **Filter Bookings**: Tap Filter button to show only confirmed or cancelled
3. **Cancel Booking**: Swipe left on a confirmed booking and tap Cancel
4. **Delete Booking**: Swipe left and tap Delete
5. **View Details**: Tap on any booking to see full details

### Searching Rooms

1. Go to the Rooms tab
2. Enter room type or set max price filter
3. Tap Search to find available rooms
4. Select a room to create a booking

## Permissions

The app respects role-based permissions:
- Users can only access features they have permissions for
- API calls will fail with 401/403 if user lacks required permissions
- Automatic token refresh attempts before showing errors

## Troubleshooting

### Connection Issues

1. **"Connection Failed" error**:
   - Ensure the backend server is running
   - Check the server URL in Settings
   - For physical devices, use your computer's IP address instead of `localhost`
   - Check that Network Monitoring shows "Connected"

2. **Authentication Errors**:
   - Verify credentials are correct
   - Check that the backend is properly configured
   - Ensure JWT_SECRET is set in backend environment
   - If tokens are invalid, logout and login again

3. **Permission Errors**:
   - Verify user has required permissions
   - Check user roles in the database
   - Ensure permissions are properly assigned

4. **Token Refresh Issues**:
   - Check that `/auth/refresh` endpoint is implemented on backend
   - Verify refresh token is being stored properly
   - Check backend logs for refresh errors

### Development Notes

- The app uses async/await for all network calls
- All API calls are authenticated automatically via AuthManager
- Tokens are stored securely in iOS Keychain
- Automatic logout on 401 responses (after refresh attempt)
- Network monitoring runs in background
- Pull-to-refresh available on all list views

## Future Enhancements

- [ ] Biometric authentication (Face ID / Touch ID)
- [ ] Offline mode with local caching (Core Data / SwiftData)
- [ ] Push notifications for booking updates
- [ ] Dark mode support
- [ ] Localization for multiple languages
- [ ] Widget support for quick stats
- [ ] iPad optimization with split views
- [ ] Export booking reports as PDF
- [ ] QR code check-in/check-out

## Technical Implementation Details

### Keychain Storage

Uses iOS Keychain Services API for secure token storage:
- Tokens encrypted by the system
- Persists across app launches
- Automatically deleted on app uninstall
- Protected by device passcode/biometrics

### Automatic Token Refresh

Intelligent retry mechanism:
1. API request receives 401 Unauthorized
2. Attempts token refresh using refresh token
3. Retries original request with new access token
4. On failure, logs user out automatically

### Network Monitoring

Uses NWPathMonitor to track:
- Connection status (connected/disconnected)
- Connection type (WiFi, Cellular, Ethernet)
- Real-time updates via callbacks

## Converting to Xcode Project

⚠️ **Important**: This project is currently configured as a Swift Package but should be converted to a proper Xcode iOS App project for production use.

### Steps to Convert:

1. Create new iOS App project in Xcode:
   - File → New → Project → iOS → App
   - Choose "Storyboard" for Interface (we're using programmatic UI)

2. Copy all .swift files to the new project

3. Use the provided `Info.plist`

4. Add necessary capabilities in project settings:
   - Keychain Sharing (if needed)
   - Network (automatic)

5. Configure bundle identifier and signing

## API Testing

All endpoints can be tested using the built-in Settings → Test Connection feature.

For detailed API testing:
- Use the Test Connection button in Settings
- Check network monitoring status
- Review error messages for debugging

---

**Version**: 1.0  
**Last Updated**: December 2024  
**Minimum iOS Version**: 15.0

