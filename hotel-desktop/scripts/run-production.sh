#!/bin/bash

# Hotel Desktop Application - Production Runner
# This script runs the production build of the desktop application

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APP_NAME="Hotel Management"

# Detect platform
case "$(uname -s)" in
    Darwin)
        PLATFORM="macos"
        APP_PATH="$PROJECT_DIR/src-tauri/target/release/bundle/macos/$APP_NAME.app"
        ;;
    Linux)
        PLATFORM="linux"
        APP_PATH="$PROJECT_DIR/src-tauri/target/release/hotel-desktop"
        ;;
    MINGW*|MSYS*|CYGWIN*)
        PLATFORM="windows"
        APP_PATH="$PROJECT_DIR/src-tauri/target/release/hotel-desktop.exe"
        ;;
    *)
        echo "Unsupported platform: $(uname -s)"
        exit 1
        ;;
esac

echo "Platform: $PLATFORM"
echo "Looking for application at: $APP_PATH"

# Check if application exists
if [ ! -e "$APP_PATH" ]; then
    echo ""
    echo "Application not found. Building production release..."
    echo ""
    cd "$PROJECT_DIR"
    npm run build
fi

# Run the application
echo ""
echo "Starting $APP_NAME..."
echo ""

case "$PLATFORM" in
    macos)
        open "$APP_PATH"
        ;;
    linux)
        "$APP_PATH"
        ;;
    windows)
        start "" "$APP_PATH"
        ;;
esac

echo "Application started successfully."
