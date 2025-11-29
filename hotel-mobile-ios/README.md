# Hotel Management iOS App

iOS application for the Hotel Management System with authentication and API integration.

## Features

- 🔐 **Authentication**: Login with username/password
- 🏨 **Room Management**: Search and view available rooms
- 👥 **Guest Management**: View and create guests
- 📅 **Booking Management**: View bookings with details
- ⚙️ **Settings**: Configure server URL and view user information

## Setup

### Prerequisites

- Xcode 14.0 or later
- iOS 15.0 or later
- Swift Package Manager (included with Xcode)

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

### Logout

- Go to the Settings tab
- Tap the "Logout" button
- You'll be returned to the login screen

## API Integration

The app uses the same authenticated API as the web frontend:

- All requests include JWT token in the Authorization header
- Automatic token refresh handling
- Error handling for authentication failures

### Endpoints Used

- `POST /auth/login` - User authentication
- `GET /rooms` - Get all rooms (requires `rooms:read` permission)
- `GET /rooms/available` - Search available rooms
- `GET /guests` - Get all guests (requires `guests:read` permission)
- `POST /guests` - Create new guest (requires `guests:write` permission)
- `GET /bookings` - Get all bookings (requires `bookings:read` permission)
- `POST /bookings` - Create new booking (requires `bookings:write` permission)

## Architecture

### Key Components

- **AuthManager**: Singleton for managing authentication state
- **HotelAPIService**: API client with authentication support
- **Models**: Data models matching backend structure (UUIDs)
- **View Controllers**: 
  - `LoginViewController`: Authentication
  - `RoomSearchViewController`: Room search and booking
  - `GuestListViewController`: Guest list
  - `BookingListViewController`: Booking list with details
  - `SettingsViewController`: User settings and logout

### Data Models

All models use UUID strings (matching the backend):
- `User`: User information
- `Room`: Room details with UUID
- `Guest`: Guest information with UUID
- `Booking`: Booking information with UUID
- `BookingWithDetails`: Extended booking with guest and room details

## Permissions

The app respects role-based permissions:
- Users can only access features they have permissions for
- API calls will fail with 401/403 if user lacks required permissions
- UI can be extended to hide/show features based on permissions

## Troubleshooting

### Connection Issues

1. **"Connection Failed" error**:
   - Ensure the backend server is running
   - Check the server URL in Settings
   - For physical devices, use your computer's IP address instead of `localhost`

2. **Authentication Errors**:
   - Verify credentials are correct
   - Check that the backend is properly configured
   - Ensure JWT_SECRET is set in backend environment

3. **Permission Errors**:
   - Verify user has required permissions
   - Check user roles in the database
   - Ensure permissions are properly assigned

### Development Notes

- The app uses async/await for network calls
- All API calls are authenticated automatically
- Token is stored securely in UserDefaults
- Automatic logout on 401 responses

## Future Enhancements

- [ ] Passkey/WebAuthn support
- [ ] Offline mode with local caching
- [ ] Push notifications for booking updates
- [ ] Dark mode support
- [ ] Biometric authentication
- [ ] Refresh token rotation

