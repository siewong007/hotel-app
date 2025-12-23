#!/bin/bash

# IMMEDIATE FIX - Delete ALL duplicate files causing ambiguous type errors
# This script will identify and help you delete the problematic files

echo "🚨 EMERGENCY FIX - Eliminating All Build Errors"
echo "================================================"
echo ""

# Create backup
echo "Creating backup..."
BACKUP_DIR="../hotel_backup_emergency_$(date +%Y%m%d_%H%M%S)"
cp -r . "$BACKUP_DIR" 2>/dev/null
echo "✓ Backup: $BACKUP_DIR"
echo ""

# List ALL files that need to be DELETED
echo "FILES TO DELETE IMMEDIATELY:"
echo "============================"
echo ""

# These files are causing the ambiguous type errors
PROBLEM_FILES=(
    "Models.swift"
    "Models 2.swift"
    "AuthenticationModels.swift"
    "HotelAuthManager.swift"
    "HotelAPIManager.swift"
    "HotelTabViewController 2.swift"
    "AuthManager.swift"
    "APIManager.swift"
    "LoginViewController.swift"
    "RegisterViewController.swift"
    "RoomListViewController.swift"
    "RoomDetailViewController.swift"
    "MyBookingsViewController.swift"
    "BookingDetailViewController.swift"
    "ProfileViewController.swift"
    "EKYCViewController.swift"
    "TwoFactorSetupViewController.swift"
)

echo "Searching for problematic files..."
echo ""

for file in "${PROBLEM_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "❌ FOUND: $file (DELETE THIS)"
    fi
done

echo ""
echo "FILES TO KEEP:"
echo "============="
echo "✅ DataModels.swift"
echo "✅ APIService.swift"
echo "✅ NetworkMonitor.swift"
echo "✅ HotelTabViewController.swift (original)"
echo "✅ ConsolidatedModels.swift"
echo "✅ SimplifiedAuthManager.swift"
echo "✅ AppDelegate.swift"
echo "✅ SceneDelegate.swift"
echo ""

# Check for @main duplicates
echo "Checking @main attributes..."
MAIN_FILES=$(grep -l "@main" *.swift 2>/dev/null)
MAIN_COUNT=$(echo "$MAIN_FILES" | grep -c "swift" 2>/dev/null || echo "0")

if [ "$MAIN_COUNT" -gt 1 ]; then
    echo "❌ Found multiple @main attributes:"
    echo "$MAIN_FILES"
    echo ""
    echo "Action: Remove @main from all except AppDelegate.swift"
elif [ "$MAIN_COUNT" -eq 1 ]; then
    echo "✅ Found 1 @main (correct)"
else
    echo "⚠️  No @main found"
fi

echo ""
echo "================================================"
echo "MANUAL DELETION REQUIRED IN XCODE:"
echo "================================================"
echo ""
echo "1. Open your project in Xcode"
echo "2. For EACH file listed above with ❌:"
echo "   - Select the file in Project Navigator"
echo "   - Press Delete (or right-click → Delete)"
echo "   - Choose 'Move to Trash'"
echo ""
echo "3. After deleting ALL problem files:"
echo "   - Product → Clean Build Folder (Cmd+Shift+K)"
echo "   - Xcode → Preferences → Locations"
echo "   - Click arrow next to Derived Data, delete folder"
echo "   - Quit and restart Xcode"
echo "   - Product → Build (Cmd+B)"
echo ""
echo "Expected result: 0 errors, app ready to run!"
echo ""
echo "Backup location: $BACKUP_DIR"
