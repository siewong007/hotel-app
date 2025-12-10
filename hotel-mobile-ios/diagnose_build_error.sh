#!/bin/bash

# Quick diagnostic script for UIKit import error
# Run this to understand the issue and get immediate fix instructions

echo "🔍 Hotel Management iOS - Build Error Diagnostic"
echo "================================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Check if Package.swift exists
if [ -f "Package.swift" ]; then
    echo -e "${RED}❌ ISSUE FOUND: Swift Package Configuration${NC}"
    echo ""
    echo "Your project is configured as a Swift Package (Package.swift exists)."
    echo "Swift Packages CANNOT import UIKit for executable targets."
    echo ""
    echo -e "${YELLOW}This is why you see:${NC}"
    echo "  error: Unable to find module dependency: 'UIKit'"
    echo ""
else
    echo -e "${GREEN}✅ No Package.swift found${NC}"
fi

# Check for Xcode project
if [ -f "HotelMobileIOS.xcodeproj" ] || [ -d "HotelMobileIOS.xcodeproj" ]; then
    echo -e "${GREEN}✅ Xcode project found${NC}"
    NEEDS_CONVERSION=false
else
    echo -e "${RED}❌ No Xcode project found${NC}"
    NEEDS_CONVERSION=true
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ "$NEEDS_CONVERSION" = true ]; then
    echo -e "${BLUE}🔧 SOLUTION: Convert to iOS App Project${NC}"
    echo ""
    echo "You need to create a proper iOS App project in Xcode."
    echo ""
    echo -e "${GREEN}QUICK FIX (5 minutes):${NC}"
    echo ""
    echo "1️⃣  Open Xcode"
    echo "2️⃣  File → New → Project"
    echo "3️⃣  Choose: iOS → App"
    echo "4️⃣  Name: HotelMobileIOS"
    echo "5️⃣  Interface: Storyboard"
    echo "6️⃣  Import all .swift files from this folder"
    echo "7️⃣  Build and Run (⌘R)"
    echo ""
    echo -e "${YELLOW}📚 Detailed Guides:${NC}"
    echo "   • VISUAL_CONVERSION_GUIDE.md - Step-by-step with screenshots"
    echo "   • FIXING_UIKIT_ERROR.md - Complete conversion instructions"
    echo ""
    
    # Offer to prepare files
    echo -e "${BLUE}Would you like to prepare files for conversion? (y/n)${NC}"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        if [ -f "prepare_ios_conversion.sh" ]; then
            chmod +x prepare_ios_conversion.sh
            ./prepare_ios_conversion.sh
        else
            echo -e "${YELLOW}prepare_ios_conversion.sh not found${NC}"
            echo "Manually copy these files to new Xcode project:"
            echo ""
            ls -1 *.swift 2>/dev/null | grep -v "main.swift" | sed 's/^/  • /'
        fi
    fi
else
    echo -e "${GREEN}✅ Project appears to be properly configured${NC}"
    echo ""
    echo "Try these steps:"
    echo "1. Clean Build Folder: Product → Clean Build Folder (⇧⌘K)"
    echo "2. Rebuild: Product → Build (⌘B)"
    echo "3. Check file target membership in Xcode"
    echo ""
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Count Swift files
SWIFT_COUNT=$(ls -1 *.swift 2>/dev/null | wc -l | tr -d ' ')
echo -e "${BLUE}📊 Project Status:${NC}"
echo "   Swift files: $SWIFT_COUNT"
if [ -f "Info.plist" ]; then
    echo "   Info.plist: ✅ Found"
else
    echo "   Info.plist: ⚠️  Not found"
fi
if [ -f "Package.swift" ]; then
    echo "   Package.swift: ⚠️  Present (should remove after conversion)"
fi
echo ""

# List important files
echo -e "${BLUE}📁 Required Files Checklist:${NC}"
REQUIRED_FILES=(
    "AppDelegate.swift"
    "SceneDelegate.swift"
    "LoginViewController.swift"
    "AuthManager.swift"
    "HotelAPIService.swift"
    "Models.swift"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo -e "   ${GREEN}✅${NC} $file"
    else
        echo -e "   ${RED}❌${NC} $file"
    fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check Xcode installation
if command -v xcodebuild &> /dev/null; then
    XCODE_VERSION=$(xcodebuild -version 2>/dev/null | head -1)
    echo -e "${GREEN}✅ Xcode installed: $XCODE_VERSION${NC}"
    
    # Check version
    VERSION_NUM=$(echo $XCODE_VERSION | grep -oE '[0-9]+' | head -1)
    if [ "$VERSION_NUM" -lt 14 ]; then
        echo -e "${YELLOW}   ⚠️  Warning: Xcode 14.0+ recommended${NC}"
    fi
else
    echo -e "${RED}❌ Xcode not found or not in PATH${NC}"
    echo "   Install Xcode from App Store"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ "$NEEDS_CONVERSION" = true ]; then
    echo -e "${YELLOW}⚡ NEXT STEPS:${NC}"
    echo ""
    echo "1. Read: VISUAL_CONVERSION_GUIDE.md"
    echo "   (Complete step-by-step guide)"
    echo ""
    echo "2. Or watch this quick summary:"
    echo "   ┌─────────────────────────────────────┐"
    echo "   │ Open Xcode                          │"
    echo "   │ File → New → Project                │"
    echo "   │ iOS → App                           │"
    echo "   │ Name: HotelMobileIOS                │"
    echo "   │ Add all .swift files                │"
    echo "   │ Build (⌘B) - Should work! ✅        │"
    echo "   └─────────────────────────────────────┘"
    echo ""
    echo "3. After conversion:"
    echo "   - Test on simulators (⌘R)"
    echo "   - Run automated tests (⌘U)"
    echo "   - See DEVICE_TESTING_GUIDE.md"
    echo ""
else
    echo -e "${GREEN}✅ Project looks good!${NC}"
    echo ""
    echo "If you're still seeing errors:"
    echo "1. Clean Build Folder (⇧⌘K in Xcode)"
    echo "2. Close and reopen Xcode"
    echo "3. Delete derived data:"
    echo "   rm -rf ~/Library/Developer/Xcode/DerivedData"
    echo "4. Rebuild (⌘B)"
    echo ""
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${BLUE}📖 Available Documentation:${NC}"
echo "   • VISUAL_CONVERSION_GUIDE.md - Easiest (with screenshots)"
echo "   • FIXING_UIKIT_ERROR.md - Detailed technical guide"
echo "   • DEVICE_TESTING_GUIDE.md - Testing across devices"
echo "   • QUICK_TESTING_REFERENCE.md - Quick test checklist"
echo "   • API_REFERENCE.md - Complete API docs"
echo ""
echo "Need help? Read VISUAL_CONVERSION_GUIDE.md first! 📚"
echo ""
