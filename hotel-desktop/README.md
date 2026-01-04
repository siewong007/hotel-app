# Hotel Desktop Application

A self-contained desktop application for the Hotel Management System built with Tauri 2.0. The app bundles an embedded PostgreSQL database and Axum backend server, requiring no external dependencies.

## Prerequisites

- **Node.js** 18+ and npm
- **Rust** 1.70+ (install via [rustup](https://rustup.rs/))
- **Platform-specific requirements**:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Windows**: Visual Studio Build Tools with C++ workload
  - **Linux**: `build-essential`, `libssl-dev`, `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`

## Project Structure

```
hotel-desktop/
├── package.json          # npm scripts for Tauri
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

## Development

1. **Install dependencies**:
   ```bash
   cd hotel-desktop
   npm install
   ```

2. **Run in development mode**:
   ```bash
   npm run dev
   ```
   This will:
   - Start the React frontend dev server on port 3000
   - Build and run the Tauri app with hot-reload

   > **Note**: On first run, PostgreSQL binaries (~100MB) will be downloaded automatically.

## Building for Production

### Build the application:

```bash
cd hotel-desktop
npm run build
```

This creates platform-specific installers in `src-tauri/target/release/bundle/`:

| Platform | Output |
|----------|--------|
| macOS    | `.dmg`, `.app` |
| Windows  | `.msi`, `.exe` |
| Linux    | `.deb`, `.AppImage` |

### Build for specific platform:

```bash
# macOS
npm run tauri build -- --target universal-apple-darwin

# Windows
npm run tauri build -- --target x86_64-pc-windows-msvc

# Linux
npm run tauri build -- --target x86_64-unknown-linux-gnu
```

## How It Works

### Architecture

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
2. Run database migrations
3. Seed initial data (first run only)
4. Start Axum HTTP server on port 3030
5. Open Tauri window with React frontend

### Data Storage

Application data is stored in platform-specific directories:

| Platform | Location |
|----------|----------|
| macOS    | `~/Library/Application Support/com.hotelmanagement.app/` |
| Windows  | `%LOCALAPPDATA%\HotelManagement\` |
| Linux    | `~/.local/share/hotel-management/` |

## Configuration

### Ports

- **Axum Server**: 3030
- **PostgreSQL**: 5433 (avoids conflicts with system PostgreSQL)

### Environment

The embedded server automatically configures:
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Auto-generated secure token

## Troubleshooting

### Port 3000 already in use (development)

Kill the existing process:
```bash
lsof -ti:3000 | xargs kill -9
```

### PostgreSQL download fails

Check network connectivity. The app downloads PostgreSQL from GitHub releases on first run.

### Build fails on macOS

Ensure Xcode Command Line Tools are installed:
```bash
xcode-select --install
```

### Build fails on Linux

Install required dependencies:
```bash
# Ubuntu/Debian
sudo apt install build-essential libssl-dev libgtk-3-dev libwebkit2gtk-4.1-dev

# Fedora
sudo dnf install gtk3-devel webkit2gtk4.1-devel openssl-devel
```

## Scripts

### Run Production Build

```bash
./scripts/run-production.sh
```

This script:
- Detects your platform (macOS, Windows, Linux)
- Builds the app if not already built
- Launches the production application

## License

Copyright 2024
