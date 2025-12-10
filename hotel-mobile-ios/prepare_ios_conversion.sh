#!/bin/bash

# Script to prepare files for iOS App conversion
# This organizes your files for easy import into new Xcode project

echo "🏨 Hotel Management iOS - Project Conversion Helper"
echo "=================================================="
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Create conversion directory
CONV_DIR="iOS_App_Files"
echo -e "${BLUE}Creating conversion directory...${NC}"
mkdir -p "$CONV_DIR"

# List of Swift files to copy
SWIFT_FILES=(
    "AppDelegate.swift"
    "SceneDelegate.swift"
    "LoginViewController.swift"
    "SettingsViewController.swift"
    "GuestListViewController.swift"
    "BookingListViewController.swift"
    "RoomSearchViewController.swift"
    "HotelTabViewController.swift"
    "PersonalizedReportsViewController.swift"
    "Models.swift"
    "AuthManager.swift"
    "HotelAPIService.swift"
    "KeychainHelper.swift"
    "NetworkMonitor.swift"
    "DeviceHelperUtility.swift"
)

# Copy Swift files
echo -e "${BLUE}Copying Swift source files...${NC}"
for file in "${SWIFT_FILES[@]}"; do
    if [ -f "$file" ]; then
        cp "$file" "$CONV_DIR/"
        echo -e "${GREEN}✓ Copied: $file${NC}"
    else
        echo -e "${YELLOW}⚠ Not found: $file${NC}"
    fi
done

# Copy Info.plist
if [ -f "Info.plist" ]; then
    cp "Info.plist" "$CONV_DIR/"
    echo -e "${GREEN}✓ Copied: Info.plist${NC}"
fi

# Copy test files
if [ -f "HotelAppDeviceTests.swift" ]; then
    cp "HotelAppDeviceTests.swift" "$CONV_DIR/"
    echo -e "${GREEN}✓ Copied: Test files${NC}"
fi

# Create README in conversion directory
cat > "$CONV_DIR/README.txt" << 'EOF'
iOS App Conversion Files
========================

These files are ready to import into your new Xcode iOS App project.

STEPS:
1. Create new iOS App project in Xcode:
   - File → New → Project → iOS → App
   - Name: HotelMobileIOS
   - Interface: Storyboard
   - Language: Swift

2. Delete default ViewController.swift

3. Add these files:
   - Right-click project in Xcode
   - Add Files to "HotelMobileIOS"...
   - Select all .swift files from this folder
   - ✓ Copy items if needed
   - ✓ Create groups
   - ✓ Add to target

4. Replace Info.plist (if provided)

5. Build and Run (⌘R)

For detailed instructions, see: FIXING_UIKIT_ERROR.md

Good luck! 🚀
EOF

echo ""
echo -e "${GREEN}✓ Conversion directory created: $CONV_DIR${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo "1. Open Xcode"
echo "2. File → New → Project → iOS → App"
echo "3. Name: HotelMobileIOS"
echo "4. Drag files from $CONV_DIR into new project"
echo "5. Build and Run (⌘R)"
echo ""
echo -e "${YELLOW}See FIXING_UIKIT_ERROR.md for detailed instructions${NC}"
echo ""

# Create a summary file
cat > "CONVERSION_SUMMARY.txt" << EOF
Project Conversion Summary
==========================

Current Issue:
- Swift Package cannot import UIKit
- Need to convert to iOS App project

Files Ready:
- $CONV_DIR/ contains all necessary source files
- ${#SWIFT_FILES[@]} Swift files prepared
- Info.plist included
- Test files included

What to Do:
1. Create new iOS App project in Xcode
2. Import files from $CONV_DIR/
3. Build and run

Documentation:
- FIXING_UIKIT_ERROR.md - Detailed conversion guide
- DEVICE_TESTING_SETUP.md - Testing instructions
- API_REFERENCE.md - API documentation

Status: Ready for conversion ✅
EOF

echo -e "${GREEN}✓ Created: CONVERSION_SUMMARY.txt${NC}"
echo ""
echo "Done! 🎉"
