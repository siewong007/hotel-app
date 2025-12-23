#!/bin/bash

# CRITICAL ERROR FIXES - Automated Cleanup
# This script identifies and helps remove duplicate files causing 63 errors

echo "🚨 CRITICAL ERROR FIXES - Hotel Booking App"
echo "==========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Backup first
echo -e "${BLUE}Step 1: Creating backup...${NC}"
BACKUP_DIR="../hotel_app_backup_$(date +%Y%m%d_%H%M%S)"
cp -r . "$BACKUP_DIR"
echo -e "${GREEN}✓ Backup created at: $BACKUP_DIR${NC}"
echo ""

# Function to list files
list_duplicates() {
    echo -e "${YELLOW}Files to DELETE (duplicates):${NC}"
    echo ""
    
    # Models duplicates
    echo -e "${RED}Models Files (Keep only DataModels.swift):${NC}"
    find . -name "Models.swift" -o -name "Models 2.swift" | while read file; do
        if [ -f "$file" ]; then
            echo "  ❌ $file"
        fi
    done
    echo ""
    
    # HotelTabViewController duplicates
    echo -e "${RED}HotelTabViewController Files (Keep only original):${NC}"
    find . -name "HotelTabViewController 2.swift" | while read file; do
        if [ -f "$file" ]; then
            echo "  ❌ $file"
        fi
    done
    echo ""
    
    # New view controllers that might conflict
    echo -e "${RED}Potentially Conflicting ViewControllers:${NC}"
    NEW_VCS=("LoginViewController.swift" "RegisterViewController.swift" "RoomListViewController.swift" 
             "MyBookingsViewController.swift" "ProfileViewController.swift" "EKYCViewController.swift"
             "TwoFactorSetupViewController.swift" "RoomDetailViewController.swift" "BookingDetailViewController.swift")
    
    for vc in "${NEW_VCS[@]}"; do
        if [ -f "./$vc" ]; then
            echo "  ⚠️  ./$vc (check if it conflicts with existing)"
        fi
    done
    echo ""
    
    # Auth/API managers that conflict
    echo -e "${RED}Manager Files (Use Simplified/existing versions):${NC}"
    if [ -f "./AuthManager.swift" ]; then
        echo "  ❌ ./AuthManager.swift (use SimplifiedAuthManager.swift)"
    fi
    if [ -f "./APIManager.swift" ]; then
        echo "  ❌ ./APIManager.swift (use existing APIService.swift)"
    fi
    if [ -f "./HotelAuthManager.swift" ]; then
        echo "  ❌ ./HotelAuthManager.swift (use SimplifiedAuthManager.swift)"
    fi
    if [ -f "./HotelAPIManager.swift" ]; then
        echo "  ❌ ./HotelAPIManager.swift (use existing APIService.swift)"
    fi
    echo ""
}

# Function to list files to keep
list_keep_files() {
    echo -e "${GREEN}Files to KEEP:${NC}"
    echo ""
    echo "  ✅ DataModels.swift (PRIMARY models)"
    echo "  ✅ ConsolidatedModels.swift (NEW extensions)"
    echo "  ✅ AuthenticationModels.swift (NEW, if exists)"
    echo "  ✅ SimplifiedAuthManager.swift (NEW auth)"
    echo "  ✅ APIService.swift (EXISTING)"
    echo "  ✅ NetworkMonitor.swift (EXISTING)"
    echo "  ✅ HotelTabViewController.swift (ORIGINAL)"
    echo "  ✅ AppDelegate.swift (UPDATED)"
    echo "  ✅ SceneDelegate.swift (UPDATED)"
    echo "  ✅ SettingsViewController.swift (EXISTING)"
    echo "  ✅ All other EXISTING ViewControllers"
    echo ""
}

# Display what needs to be done
list_duplicates
list_keep_files

echo -e "${YELLOW}Action Required:${NC}"
echo "This script will help you identify files to delete."
echo "You must manually delete them in Xcode to ensure proper cleanup."
echo ""

# Check for @main duplicates
echo -e "${BLUE}Step 2: Checking @main attribute...${NC}"
MAIN_COUNT=$(grep -r "@main" --include="*.swift" . 2>/dev/null | grep -v "//" | wc -l | tr -d ' ')
if [ "$MAIN_COUNT" -gt 1 ]; then
    echo -e "${RED}⚠️  Found $MAIN_COUNT @main attributes!${NC}"
    echo "Only AppDelegate.swift should have @main:"
    grep -r "@main" --include="*.swift" . 2>/dev/null | grep -v "//"
    echo ""
    echo -e "${YELLOW}Action: Remove @main from all files except AppDelegate.swift${NC}"
elif [ "$MAIN_COUNT" -eq 1 ]; then
    echo -e "${GREEN}✓ Correct: Found 1 @main attribute${NC}"
else
    echo -e "${YELLOW}⚠️  No @main found. AppDelegate.swift needs @main${NC}"
fi
echo ""

# Generate cleanup commands
echo -e "${BLUE}Step 3: Generated cleanup commands${NC}"
echo "Copy and paste these commands to delete duplicates:"
echo ""
echo -e "${YELLOW}# Delete duplicate Models files${NC}"
echo "find . -name 'Models.swift' -not -name 'DataModels.swift' -type f"
echo "find . -name 'Models 2.swift' -type f"
echo ""
echo -e "${YELLOW}# Delete duplicate HotelTabViewController${NC}"
echo "find . -name 'HotelTabViewController 2.swift' -type f"
echo ""
echo -e "${YELLOW}# Find conflicting managers${NC}"
echo "find . -name 'AuthManager.swift' -o -name 'APIManager.swift' -o -name 'HotelAuthManager.swift' -o -name 'HotelAPIManager.swift' | grep -v 'Simplified'"
echo ""

# Create a report file
REPORT_FILE="cleanup_report_$(date +%Y%m%d_%H%M%S).txt"
echo "Creating detailed report: $REPORT_FILE"
{
    echo "Hotel Booking App - Cleanup Report"
    echo "Generated: $(date)"
    echo ""
    echo "=========================================="
    echo "FILES TO DELETE IN XCODE:"
    echo "=========================================="
    echo ""
    
    find . -name "Models.swift" -o -name "Models 2.swift" | while read file; do
        echo "DELETE: $file"
    done
    
    find . -name "HotelTabViewController 2.swift" | while read file; do
        echo "DELETE: $file"
    done
    
    for file in "AuthManager.swift" "APIManager.swift" "HotelAuthManager.swift" "HotelAPIManager.swift"; do
        if [ -f "./$file" ]; then
            echo "DELETE: ./$file"
        fi
    done
    
    echo ""
    echo "=========================================="
    echo "FILES TO KEEP:"
    echo "=========================================="
    echo ""
    echo "KEEP: DataModels.swift"
    echo "KEEP: ConsolidatedModels.swift"
    echo "KEEP: SimplifiedAuthManager.swift"
    echo "KEEP: APIService.swift"
    echo "KEEP: NetworkMonitor.swift"
    echo "KEEP: HotelTabViewController.swift (original)"
    echo "KEEP: AppDelegate.swift"
    echo "KEEP: SceneDelegate.swift"
    
} > "$REPORT_FILE"

echo -e "${GREEN}✓ Report saved to: $REPORT_FILE${NC}"
echo ""

# Instructions
echo -e "${BLUE}Step 4: Manual Actions Required in Xcode${NC}"
echo "----------------------------------------"
echo ""
echo "1. Open your project in Xcode"
echo "2. For each file marked DELETE above:"
echo "   - Select the file in Project Navigator"
echo "   - Press Delete key"
echo "   - Choose 'Move to Trash'"
echo ""
echo "3. After deleting files:"
echo "   - Product → Clean Build Folder (Cmd+Shift+K)"
echo "   - Delete Derived Data:"
echo "     Xcode → Preferences → Locations → Derived Data"
echo "     Click the arrow and delete the folder"
echo "   - Restart Xcode"
echo "   - Product → Build (Cmd+B)"
echo ""
echo "4. Verify @main:"
echo "   - Only AppDelegate.swift should have @main"
echo "   - Remove from any other files"
echo ""
echo -e "${GREEN}Expected Result: 0 compilation errors${NC}"
echo ""
echo -e "${YELLOW}Need help? Check CRITICAL_FIXES.md for detailed instructions${NC}"
echo ""

# Summary
echo "=========================================="
echo "SUMMARY"
echo "=========================================="
echo -e "${GREEN}Backup created at: $BACKUP_DIR${NC}"
echo -e "${BLUE}Report saved to: $REPORT_FILE${NC}"
echo ""
echo "Next steps:"
echo "1. Review the report"
echo "2. Delete duplicate files in Xcode"
echo "3. Clean build and rebuild"
echo "4. Check CRITICAL_FIXES.md if errors persist"
echo ""
echo -e "${GREEN}Good luck! 🍀${NC}"
