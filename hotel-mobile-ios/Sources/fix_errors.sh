#!/bin/bash

# Hotel Booking App - Automatic Fixes Script
# This script helps resolve the 66 syntax errors by removing duplicate files

echo "🏨 Hotel Booking App - Fixing Syntax Errors"
echo "============================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to prompt user
confirm() {
    read -p "$1 (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]
    then
        return 0
    else
        return 1
    fi
}

echo "Step 1: Backup your project"
echo "----------------------------"
if confirm "Create a backup of your project?"; then
    BACKUP_DIR="../backup_$(date +%Y%m%d_%H%M%S)"
    echo "Creating backup at $BACKUP_DIR..."
    cp -r . "$BACKUP_DIR"
    echo -e "${GREEN}✓ Backup created at $BACKUP_DIR${NC}"
else
    echo -e "${YELLOW}⚠ Skipping backup (not recommended)${NC}"
fi

echo ""
echo "Step 2: Find duplicate files"
echo "----------------------------"

# Find Models.swift files (not DataModels.swift)
MODELS_FILES=$(find . -name "Models.swift" -not -name "DataModels.swift" -not -path "*/.*" -type f)
if [ -n "$MODELS_FILES" ]; then
    echo -e "${YELLOW}Found duplicate Models.swift files:${NC}"
    echo "$MODELS_FILES"
    if confirm "Delete these files?"; then
        find . -name "Models.swift" -not -name "DataModels.swift" -not -path "*/.*" -type f -delete
        echo -e "${GREEN}✓ Deleted Models.swift duplicates${NC}"
    fi
else
    echo "No duplicate Models.swift files found"
fi

echo ""

# Find Models 2.swift files
MODELS2_FILES=$(find . -name "Models 2.swift" -not -path "*/.*" -type f)
if [ -n "$MODELS2_FILES" ]; then
    echo -e "${YELLOW}Found Models 2.swift files:${NC}"
    echo "$MODELS2_FILES"
    if confirm "Delete these files?"; then
        find . -name "Models 2.swift" -not -path "*/.*" -type f -delete
        echo -e "${GREEN}✓ Deleted Models 2.swift files${NC}"
    fi
else
    echo "No Models 2.swift files found"
fi

echo ""

# Find duplicate HotelTabViewController
HOTEL_TAB_FILES=$(find . -name "HotelTabViewController.swift" -not -path "*/.*" -type f)
HOTEL_TAB_COUNT=$(echo "$HOTEL_TAB_FILES" | wc -l | tr -d ' ')
if [ "$HOTEL_TAB_COUNT" -gt 1 ]; then
    echo -e "${YELLOW}Found multiple HotelTabViewController.swift files:${NC}"
    echo "$HOTEL_TAB_FILES"
    echo ""
    echo -e "${YELLOW}Please manually review and delete the older version${NC}"
    echo "Keep the one with the most complete implementation"
fi

echo ""

# Find duplicate LoginViewController
LOGIN_FILES=$(find . -name "LoginViewController.swift" -not -path "*/.*" -type f)
LOGIN_COUNT=$(echo "$LOGIN_FILES" | wc -l | tr -d ' ')
if [ "$LOGIN_COUNT" -gt 1 ]; then
    echo -e "${YELLOW}Found multiple LoginViewController.swift files:${NC}"
    echo "$LOGIN_FILES"
    echo ""
    echo -e "${YELLOW}Please manually review and delete the older version${NC}"
fi

echo ""
echo "Step 3: Check for old API files"
echo "--------------------------------"

# Check for old AuthManager.swift (not HotelAuthManager.swift)
AUTH_MANAGER=$(find . -name "AuthManager.swift" -not -name "HotelAuthManager.swift" -not -path "*/.*" -type f)
if [ -n "$AUTH_MANAGER" ]; then
    echo -e "${YELLOW}Found old AuthManager.swift:${NC}"
    echo "$AUTH_MANAGER"
    echo "This should be replaced by HotelAuthManager.swift"
    if confirm "Delete old AuthManager.swift?"; then
        find . -name "AuthManager.swift" -not -name "HotelAuthManager.swift" -not -path "*/.*" -type f -delete
        echo -e "${GREEN}✓ Deleted old AuthManager.swift${NC}"
    fi
else
    echo "No conflicting AuthManager.swift found"
fi

echo ""

# Check for old APIManager.swift (not HotelAPIManager.swift)
API_MANAGER=$(find . -name "APIManager.swift" -not -name "HotelAPIManager.swift" -not -path "*/.*" -type f)
if [ -n "$API_MANAGER" ]; then
    echo -e "${YELLOW}Found old APIManager.swift:${NC}"
    echo "$API_MANAGER"
    echo "This conflicts with HotelAPIManager.swift"
    if confirm "Delete old APIManager.swift?"; then
        find . -name "APIManager.swift" -not -name "HotelAPIManager.swift" -not -path "*/.*" -type f -delete
        echo -e "${GREEN}✓ Deleted old APIManager.swift${NC}"
    fi
else
    echo "No conflicting APIManager.swift found"
fi

echo ""
echo "Step 4: Check @main attribute"
echo "------------------------------"

# Count @main occurrences
MAIN_COUNT=$(grep -r "@main" --include="*.swift" . | grep -v "\/\/" | wc -l | tr -d ' ')
echo "Found $MAIN_COUNT @main attributes in your project"

if [ "$MAIN_COUNT" -gt 1 ]; then
    echo -e "${RED}⚠ ERROR: Multiple @main attributes found!${NC}"
    echo "Only ONE file should have @main attribute"
    echo ""
    echo "Files with @main:"
    grep -r "@main" --include="*.swift" . | grep -v "\/\/"
    echo ""
    echo -e "${YELLOW}Please manually remove @main from all files except AppDelegate.swift${NC}"
fi

echo ""
echo "Step 5: Verify new files exist"
echo "-------------------------------"

# Check for new required files
NEW_FILES=(
    "AuthenticationModels.swift"
    "HotelAuthManager.swift"
    "HotelAPIManager.swift"
)

for file in "${NEW_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}✓ Found $file${NC}"
    else
        echo -e "${RED}✗ Missing $file${NC}"
        echo "  This file is required for the authentication features"
    fi
done

echo ""
echo "Step 6: Summary and Next Steps"
echo "-------------------------------"
echo ""
echo "Files that should exist in your project:"
echo "  ✓ DataModels.swift (existing models)"
echo "  ✓ AuthenticationModels.swift (new auth extensions)"
echo "  ✓ HotelAuthManager.swift (new auth manager)"
echo "  ✓ HotelAPIManager.swift (new API manager)"
echo "  ✓ AppDelegate.swift (with @main)"
echo "  ✓ SceneDelegate.swift (updated)"
echo ""
echo "Files that should be DELETED:"
echo "  ✗ Models.swift (duplicate)"
echo "  ✗ Models 2.swift (duplicate)"
echo "  ✗ Old AuthManager.swift (if not HotelAuthManager)"
echo "  ✗ Old APIManager.swift (if not HotelAPIManager)"
echo ""
echo "Next Steps:"
echo "1. Open Xcode"
echo "2. Product → Clean Build Folder (Cmd+Shift+K)"
echo "3. Delete Derived Data (Xcode → Preferences → Locations)"
echo "4. Product → Build (Cmd+B)"
echo ""
echo "If errors persist, check FIXES_DOCUMENTATION.md"
echo ""
echo -e "${GREEN}Script completed!${NC}"
echo ""

# Check if running in Xcode terminal
if [ -n "$XCODE_VERSION_ACTUAL" ]; then
    echo "Running in Xcode. You can now:"
    echo "1. Close any open files"
    echo "2. Clean build folder"
    echo "3. Rebuild project"
fi
