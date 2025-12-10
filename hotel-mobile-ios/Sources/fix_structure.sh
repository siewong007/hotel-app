#!/bin/bash

# Fix Swift Package Structure
# This script moves all Swift files to Sources/ directory and fixes Package.swift

echo "🔧 Fixing Swift Package Structure..."
echo ""

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Create Sources directory if it doesn't exist
mkdir -p Sources

echo "📁 Moving Swift files to Sources/ directory..."

# List of Swift files to move
files=(
    "AppDelegate.swift"
    "SceneDelegate.swift"
    "LoginViewController.swift"
    "SettingsViewController.swift"
    "GuestListViewController.swift"
    "BookingListViewController.swift"
    "RoomSearchViewController.swift"
    "HotelTabViewController.swift"
    "PersonalizedReportsViewController.swift"
    "UserProfileViewController.swift"
    "LoyaltyStatisticsViewController.swift"
    "Models.swift"
    "AuthManager.swift"
    "HotelAPIService.swift"
    "KeychainHelper.swift"
    "NetworkMonitor.swift"
    "DeviceHelperUtility.swift"
)

# Move each file if it exists in root
for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        echo "  Moving $file to Sources/"
        mv "$file" "Sources/"
    elif [ -f "Sources/$file" ]; then
        echo "  ✓ $file already in Sources/"
    else
        echo "  ⚠️  $file not found"
    fi
done

echo ""
echo "🗑️  Removing problematic files..."

# Remove main.swift (conflicts with @main)
if [ -f "main.swift" ]; then
    echo "  Removing main.swift"
    rm "main.swift"
fi
if [ -f "Sources/main.swift" ]; then
    echo "  Removing Sources/main.swift"
    rm "Sources/main.swift"
fi

# Remove DeviceHelper.swift (Markdown file with wrong extension)
if [ -f "DeviceHelper.swift" ]; then
    echo "  Removing DeviceHelper.swift (Markdown file)"
    rm "DeviceHelper.swift"
fi
if [ -f "Sources/DeviceHelper.swift" ]; then
    echo "  Removing Sources/DeviceHelper.swift (Markdown file)"
    rm "Sources/DeviceHelper.swift"
fi

echo ""
echo "✅ Structure Fixed!"
echo ""
echo "📝 Next steps:"
echo "1. In Xcode: File → Close Project"
echo "2. In Xcode: File → Open → Select Package.swift"
echo "3. Product → Clean Build Folder (⇧⌘K)"
echo "4. Product → Build (⌘B)"
echo ""
echo "⚠️  IMPORTANT: Swift Package executables cannot run iOS apps!"
echo "To actually run your app, you must create an iOS App project in Xcode."
echo "See CONVERT_TO_IOS_APP.md for instructions."
echo ""
