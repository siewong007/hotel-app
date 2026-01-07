#!/bin/bash

# Hotel Desktop Application - Cross-Platform Build Script
# This script builds the desktop application for macOS, Linux, or Windows (via WSL)
# It ALWAYS builds with the latest frontend and backend code.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FRONTEND_DIR="$(dirname "$PROJECT_DIR")/hotel-web-fe"
BACKEND_DIR="$(dirname "$PROJECT_DIR")/hotel-app-be"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}Hotel Desktop - Build Script${NC}"
echo -e "${CYAN}=============================${NC}"
echo ""

# Parse arguments
RELEASE=true
CLEAN=false
TARGET=""
SKIP_FE_INSTALL=false
SKIP_BE_REBUILD=false

show_help() {
    echo "Usage: ./build.sh [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --debug           Build in debug mode (default: release)"
    echo "  --clean           Clean all build artifacts before building"
    echo "  --target TARGET   Specify build target (e.g., x86_64-apple-darwin)"
    echo "  --skip-fe-install Skip frontend npm install (use existing node_modules)"
    echo "  --skip-be-rebuild Skip explicit backend rebuild"
    echo "  --help            Show this help message"
    echo ""
    echo "This script ALWAYS ensures:"
    echo "  - Frontend is rebuilt with latest code"
    echo "  - Backend crate is recompiled with latest code"
    echo "  - All migrations are bundled from latest BE"
    exit 0
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --debug)
            RELEASE=false
            shift
            ;;
        --clean)
            CLEAN=true
            shift
            ;;
        --target)
            TARGET="$2"
            shift 2
            ;;
        --skip-fe-install)
            SKIP_FE_INSTALL=true
            shift
            ;;
        --skip-be-rebuild)
            SKIP_BE_REBUILD=true
            shift
            ;;
        --help|-h)
            show_help
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Detect platform
detect_platform() {
    case "$(uname -s)" in
        Darwin)
            PLATFORM="macos"
            if [ -z "$TARGET" ]; then
                # Detect Apple Silicon vs Intel
                if [ "$(uname -m)" = "arm64" ]; then
                    TARGET="aarch64-apple-darwin"
                else
                    TARGET="x86_64-apple-darwin"
                fi
            fi
            ;;
        Linux)
            PLATFORM="linux"
            if [ -z "$TARGET" ]; then
                TARGET="x86_64-unknown-linux-gnu"
            fi
            ;;
        MINGW*|MSYS*|CYGWIN*)
            PLATFORM="windows"
            if [ -z "$TARGET" ]; then
                TARGET="x86_64-pc-windows-msvc"
            fi
            ;;
        *)
            echo -e "${RED}Unsupported platform: $(uname -s)${NC}"
            exit 1
            ;;
    esac
    echo -e "${YELLOW}Platform: $PLATFORM${NC}"
    echo -e "${YELLOW}Target: $TARGET${NC}"
    echo ""
}

# Check prerequisites
check_prerequisites() {
    echo -e "${YELLOW}Checking prerequisites...${NC}"

    # Check Rust
    if ! command -v rustc &> /dev/null; then
        echo -e "${RED}ERROR: Rust is not installed. Please install from https://rustup.rs${NC}"
        exit 1
    fi
    echo -e "  ${GREEN}Rust: $(rustc --version)${NC}"

    # Check Node.js
    if ! command -v node &> /dev/null; then
        echo -e "${RED}ERROR: Node.js is not installed. Please install from https://nodejs.org${NC}"
        exit 1
    fi
    echo -e "  ${GREEN}Node.js: $(node --version)${NC}"

    # Check npm
    if ! command -v npm &> /dev/null; then
        echo -e "${RED}ERROR: npm is not installed.${NC}"
        exit 1
    fi
    echo -e "  ${GREEN}npm: $(npm --version)${NC}"

    # Check/add Rust target
    if ! rustup target list --installed | grep -q "$TARGET"; then
        echo -e "${YELLOW}Adding Rust target: $TARGET${NC}"
        rustup target add "$TARGET"
    fi

    # Platform-specific checks
    if [ "$PLATFORM" = "linux" ]; then
        # Check for required Linux dependencies
        echo -e "  ${YELLOW}Checking Linux dependencies...${NC}"
        MISSING_DEPS=""

        if ! dpkg -l | grep -q "libwebkit2gtk-4.1-dev"; then
            MISSING_DEPS="$MISSING_DEPS libwebkit2gtk-4.1-dev"
        fi
        if ! dpkg -l | grep -q "libssl-dev"; then
            MISSING_DEPS="$MISSING_DEPS libssl-dev"
        fi
        if ! dpkg -l | grep -q "libgtk-3-dev"; then
            MISSING_DEPS="$MISSING_DEPS libgtk-3-dev"
        fi
        if ! dpkg -l | grep -q "librsvg2-dev"; then
            MISSING_DEPS="$MISSING_DEPS librsvg2-dev"
        fi

        if [ -n "$MISSING_DEPS" ]; then
            echo -e "${YELLOW}Installing missing dependencies:$MISSING_DEPS${NC}"
            sudo apt-get update
            sudo apt-get install -y $MISSING_DEPS
        fi
    fi

    echo -e "${GREEN}Prerequisites check passed!${NC}"
    echo ""
}

# Clean build artifacts
clean_build() {
    echo -e "${YELLOW}Cleaning build artifacts...${NC}"

    if [ -d "$PROJECT_DIR/src-tauri/target" ]; then
        rm -rf "$PROJECT_DIR/src-tauri/target"
        echo "  Removed: $PROJECT_DIR/src-tauri/target"
    fi

    if [ -d "$FRONTEND_DIR/build" ]; then
        rm -rf "$FRONTEND_DIR/build"
        echo "  Removed: $FRONTEND_DIR/build"
    fi

    # Also clean backend target to ensure fresh compilation
    if [ -d "$BACKEND_DIR/target" ]; then
        rm -rf "$BACKEND_DIR/target"
        echo "  Removed: $BACKEND_DIR/target"
    fi

    echo -e "${GREEN}Clean complete!${NC}"
    echo ""
}

# Build frontend (always rebuilds with latest code)
build_frontend() {
    echo -e "${YELLOW}Building frontend with latest code...${NC}"

    cd "$FRONTEND_DIR"

    # Always remove old build to ensure fresh output
    if [ -d "build" ]; then
        rm -rf build
        echo "  Removed old frontend build"
    fi

    # Install dependencies (clean install by default)
    if [ "$SKIP_FE_INSTALL" = false ]; then
        echo "  Installing frontend dependencies..."
        npm ci --legacy-peer-deps
    else
        echo "  Skipping npm install (using existing node_modules)"
    fi

    # Build the frontend
    echo "  Building React application..."
    npm run build

    echo -e "${GREEN}Frontend build complete!${NC}"
    echo ""
}

# Rebuild backend crate to ensure latest code is compiled
rebuild_backend() {
    if [ "$SKIP_BE_REBUILD" = true ]; then
        echo -e "${YELLOW}Skipping explicit backend rebuild${NC}"
        echo ""
        return
    fi

    echo -e "${YELLOW}Ensuring backend is up to date...${NC}"

    cd "$BACKEND_DIR"

    # Touch lib.rs to force cargo to recheck the crate
    if [ -f "src/lib.rs" ]; then
        touch src/lib.rs
        echo "  Marked backend for recompilation"
    fi

    echo -e "${GREEN}Backend will be recompiled during Tauri build${NC}"
    echo ""
}

# Build Tauri application
build_tauri() {
    local build_type=$1

    echo -e "${YELLOW}Building Tauri application ($build_type)...${NC}"

    cd "$PROJECT_DIR"

    if [ "$build_type" = "release" ]; then
        npm run build -- --target "$TARGET"
    else
        npx tauri build --debug --target "$TARGET"
    fi

    echo -e "${GREEN}Tauri build complete!${NC}"
    echo ""
}

# Display build output
display_output() {
    local build_type=$1

    echo -e "${GREEN}Build completed successfully!${NC}"
    echo ""
    echo -e "${CYAN}Output location:${NC}"

    local bundle_dir="$PROJECT_DIR/src-tauri/target"
    if [ "$build_type" = "release" ]; then
        bundle_dir="$bundle_dir/$TARGET/release/bundle"
    else
        bundle_dir="$bundle_dir/$TARGET/debug"
    fi

    case "$PLATFORM" in
        macos)
            if [ -d "$bundle_dir/macos" ]; then
                echo "  macOS App: $bundle_dir/macos/"
                ls -la "$bundle_dir/macos/" 2>/dev/null | grep ".app" || true
            fi
            if [ -d "$bundle_dir/dmg" ]; then
                echo "  DMG Installer: $bundle_dir/dmg/"
                ls -la "$bundle_dir/dmg/" 2>/dev/null | grep ".dmg" || true
            fi
            ;;
        linux)
            if [ -d "$bundle_dir/deb" ]; then
                echo "  DEB Package: $bundle_dir/deb/"
                ls -la "$bundle_dir/deb/" 2>/dev/null | grep ".deb" || true
            fi
            if [ -d "$bundle_dir/rpm" ]; then
                echo "  RPM Package: $bundle_dir/rpm/"
                ls -la "$bundle_dir/rpm/" 2>/dev/null | grep ".rpm" || true
            fi
            if [ -d "$bundle_dir/appimage" ]; then
                echo "  AppImage: $bundle_dir/appimage/"
                ls -la "$bundle_dir/appimage/" 2>/dev/null | grep ".AppImage" || true
            fi
            ;;
        windows)
            if [ -d "$bundle_dir/nsis" ]; then
                echo "  NSIS Installer: $bundle_dir/nsis/"
                ls -la "$bundle_dir/nsis/" 2>/dev/null | grep ".exe" || true
            fi
            if [ -d "$bundle_dir/msi" ]; then
                echo "  MSI Installer: $bundle_dir/msi/"
                ls -la "$bundle_dir/msi/" 2>/dev/null | grep ".msi" || true
            fi
            ;;
    esac

    echo ""
    echo -e "${CYAN}Done!${NC}"
}

# Main execution
echo -e "${CYAN}Build Configuration:${NC}"
echo "  Release mode: $RELEASE"
echo "  Clean build: $CLEAN"
echo "  Skip FE install: $SKIP_FE_INSTALL"
echo "  Skip BE rebuild: $SKIP_BE_REBUILD"
echo ""

detect_platform
check_prerequisites

if [ "$CLEAN" = true ]; then
    clean_build
fi

# Always rebuild frontend with latest code
build_frontend

# Ensure backend is marked for recompilation
rebuild_backend

if [ "$RELEASE" = true ]; then
    build_tauri "release"
    display_output "release"
else
    build_tauri "debug"
    display_output "debug"
fi

# Print build summary
echo ""
echo -e "${CYAN}Build Summary:${NC}"
echo "  Frontend: Built from $FRONTEND_DIR"
echo "  Backend:  Compiled from $BACKEND_DIR"
echo "  Migrations: Bundled from $BACKEND_DIR/database/migrations"
echo ""
