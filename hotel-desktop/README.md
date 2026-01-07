# Hotel Management Desktop Application

A cross-platform desktop application for hotel management built with Tauri 2.0, React, and Rust. The app bundles an embedded PostgreSQL database and Axum backend server, requiring no external dependencies.

## Features

- Embedded PostgreSQL database (no external database required)
- Embedded backend API server
- Cross-platform support (Windows, macOS, Linux)
- Offline-first architecture
- Automatic database migrations
- Night audit system
- Guest management, bookings, invoicing

## System Requirements

### Windows
- Windows 10 or later (64-bit)
- WebView2 Runtime (automatically installed if missing)
- 4GB RAM minimum, 8GB recommended
- 500MB disk space for application
- 2GB disk space for database

### macOS
- macOS 10.15 (Catalina) or later
- Apple Silicon (M1/M2) or Intel processor
- 4GB RAM minimum, 8GB recommended
- 500MB disk space for application
- 2GB disk space for database

### Linux
- Ubuntu 20.04+ / Fedora 34+ / equivalent
- WebKitGTK 4.1
- 4GB RAM minimum, 8GB recommended
- 500MB disk space for application
- 2GB disk space for database

## Installation

### From Release

1. Download the appropriate installer from the [Releases](../../releases) page
2. Run the installer
3. Launch "Hotel Management" from your applications

### Build from Source

#### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- [Rust](https://rustup.rs/) (stable toolchain)
- Platform-specific dependencies (see below)

#### Windows Build

```powershell
# Install Rust
winget install Rustlang.Rustup

# Install Visual Studio Build Tools (if not installed)
winget install Microsoft.VisualStudio.2022.BuildTools

# Clone the repository
git clone https://github.com/hotel-management/hotel-app.git
cd hotel-app/hotel-desktop

# Install dependencies
npm install
cd ../hotel-web-fe && npm install && cd ../hotel-desktop

# Build for Windows
npm run build:windows

# Or use the PowerShell build script
.\scripts\build-windows.ps1 -Release
```

Output: `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/`
- NSIS installer: `nsis/*.exe`
- MSI installer: `msi/*.msi`

#### macOS Build

```bash
# Install Xcode Command Line Tools
xcode-select --install

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Clone the repository
git clone https://github.com/hotel-management/hotel-app.git
cd hotel-app/hotel-desktop

# Install dependencies
npm install
cd ../hotel-web-fe && npm install && cd ../hotel-desktop

# Build for macOS (Apple Silicon)
npm run build:macos

# Build for macOS (Intel)
npm run build:macos-intel

# Or use the bash build script
./scripts/build.sh
```

Output: `src-tauri/target/*/release/bundle/`
- App bundle: `macos/*.app`
- DMG installer: `dmg/*.dmg`

#### Linux Build

```bash
# Install dependencies (Ubuntu/Debian)
sudo apt-get update
sudo apt-get install -y \
    build-essential \
    libwebkit2gtk-4.1-dev \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    patchelf

# Install dependencies (Fedora/RHEL)
sudo dnf install webkit2gtk4.1-devel openssl-devel gtk3-devel librsvg2-devel

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Clone the repository
git clone https://github.com/hotel-management/hotel-app.git
cd hotel-app/hotel-desktop

# Install dependencies
npm install
cd ../hotel-web-fe && npm install && cd ../hotel-desktop

# Build for Linux
npm run build:linux

# Or use the bash build script
./scripts/build.sh
```

Output: `src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/`
- DEB package: `deb/*.deb`
- RPM package: `rpm/*.rpm`
- AppImage: `appimage/*.AppImage`

## Development

```bash
# Start development mode (hot-reload)
npm run dev

# Build frontend only
npm run build:frontend

# Build debug version
npm run build:debug

# Clean build artifacts
npm run clean
```

## Build Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development mode with hot-reload |
| `npm run build` | Build release version for current platform |
| `npm run build:windows` | Build for Windows (x64) |
| `npm run build:macos` | Build for macOS (Apple Silicon) |
| `npm run build:macos-intel` | Build for macOS (Intel) |
| `npm run build:linux` | Build for Linux (x64) |
| `npm run clean` | Clean build artifacts |

## Project Structure

```
hotel-desktop/
├── package.json          # npm scripts for Tauri
├── scripts/
│   ├── build.sh          # Unix build script
│   ├── build-windows.ps1 # Windows build script
│   └── run-production.sh # Run production build
├── src-tauri/
│   ├── Cargo.toml        # Rust dependencies
│   ├── tauri.conf.json   # Tauri configuration
│   ├── src/
│   │   ├── main.rs       # Application entry point
│   │   ├── lib.rs        # Core app logic and state
│   │   ├── database.rs   # Embedded PostgreSQL management
│   │   ├── server.rs     # Embedded Axum server
│   │   └── commands.rs   # Tauri IPC commands
│   └── icons/            # App icons for all platforms
└── README.md
```

## Architecture

```
┌─────────────────────────────────────────┐
│           Tauri Desktop App             │
├─────────────────────────────────────────┤
│  ┌─────────────────────────────────┐    │
│  │     React Frontend (WebView)    │    │
│  └─────────────────────────────────┘    │
│                  ↓ HTTP                 │
│  ┌─────────────────────────────────┐    │
│  │   Axum Server (localhost:3030)  │    │
│  └─────────────────────────────────┘    │
│                  ↓ SQL                  │
│  ┌─────────────────────────────────┐    │
│  │   Embedded PostgreSQL (:5433)   │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

### Startup Sequence

1. Initialize embedded PostgreSQL (downloads on first run)
2. Run database migrations (10 migration files)
3. Seed initial data (first run only)
4. Start Axum HTTP server on port 3030
5. Open Tauri window with React frontend

## Configuration

### Data Storage Locations

| Platform | Location |
|----------|----------|
| Windows | `%LOCALAPPDATA%\HotelManagement` |
| macOS | `~/Library/Application Support/com.hotelmanagement.desktop` |
| Linux | `~/.local/share/hotel-management` |

### Ports

- **Axum Server**: 3030
- **PostgreSQL**: 5433+ (finds available port automatically)

### Default Credentials

On first launch, the application creates a default admin user:
- **Username**: `admin`
- **Password**: `admin123`

**Important**: Change the default password after first login!

## Troubleshooting

### Windows: WebView2 Not Found

The installer should automatically install WebView2. If you encounter issues:
1. Download WebView2 from [Microsoft](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)
2. Run the installer
3. Restart the Hotel Management application

### Windows: Build Fails

Ensure Visual Studio Build Tools are installed with C++ workload:
```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools"
```

### macOS: Application Cannot Be Opened

If you see "Application cannot be opened because the developer cannot be verified":
1. Right-click the application
2. Select "Open"
3. Click "Open" in the dialog

Or run:
```bash
xattr -cr "/Applications/Hotel Management.app"
```

### Linux: Missing Libraries

```bash
# Ubuntu/Debian
sudo apt-get install libwebkit2gtk-4.1-0 libssl3

# Fedora/RHEL
sudo dnf install webkit2gtk4.1 openssl
```

### Database Connection Issues

If the database fails to start:
1. Check if another PostgreSQL instance is running on port 5433
2. Delete the data directory and restart:
   - Windows: `%LOCALAPPDATA%\HotelManagement`
   - macOS: `~/Library/Application Support/com.hotelmanagement.desktop`
   - Linux: `~/.local/share/hotel-management`

### Port 3000 Already in Use (Development)

Kill the existing process:
```bash
# macOS/Linux
lsof -ti:3000 | xargs kill -9

# Windows PowerShell
Stop-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess -Force
```

## CI/CD

The project includes GitHub Actions workflows for automated builds:

- **Windows**: Builds NSIS and MSI installers
- **macOS**: Builds DMG and App bundles
- **Linux**: Builds DEB, RPM, and AppImage packages

Releases are automatically created when pushing to the `master` branch.

## License

MIT License - Copyright 2024-2025
