#!/bin/bash

# Hotel Management iOS App - Device Testing Script
# This script runs the app on multiple simulators for testing

set -e

echo "🏨 Hotel Management iOS App - Multi-Device Testing"
echo "=================================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SCHEME="HotelMobileIOS"
WORKSPACE="HotelMobileIOS.xcworkspace"  # or .xcodeproj
PROJECT="HotelMobileIOS.xcodeproj"

# Device configurations
DEVICES=(
    "iPhone SE (3rd generation)"
    "iPhone 14 Pro"
    "iPhone 15 Pro Max"
    "iPad Air (5th generation)"
    "iPad Pro (12.9-inch) (6th generation)"
)

# Function to check if backend is running
check_backend() {
    echo -e "${BLUE}Checking backend server...${NC}"
    if curl -s http://localhost:3030 > /dev/null; then
        echo -e "${GREEN}✓ Backend server is running${NC}"
        return 0
    else
        echo -e "${RED}✗ Backend server is not running${NC}"
        echo -e "${YELLOW}Please start your backend server on http://localhost:3030${NC}"
        return 1
    fi
}

# Function to build the app
build_app() {
    echo -e "${BLUE}Building app...${NC}"
    
    if [ -d "$WORKSPACE" ]; then
        xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration Debug clean build
    else
        xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Debug clean build
    fi
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Build successful${NC}"
        return 0
    else
        echo -e "${RED}✗ Build failed${NC}"
        return 1
    fi
}

# Function to boot simulator if needed
boot_simulator() {
    local device_name=$1
    local device_id=$(xcrun simctl list devices | grep "$device_name" | grep -v "unavailable" | head -1 | grep -oE '\([A-F0-9-]+\)' | tr -d '()')
    
    if [ -z "$device_id" ]; then
        echo -e "${RED}✗ Device not found: $device_name${NC}"
        return 1
    fi
    
    local boot_status=$(xcrun simctl list devices | grep "$device_id" | grep -o "Booted\|Shutdown")
    
    if [ "$boot_status" = "Shutdown" ]; then
        echo -e "${BLUE}Booting simulator...${NC}"
        xcrun simctl boot "$device_id"
        sleep 3
    fi
    
    return 0
}

# Function to run app on specific device
run_on_device() {
    local device_name=$1
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Testing on: $device_name${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    # Boot simulator
    boot_simulator "$device_name"
    
    # Run the app
    echo -e "${BLUE}Launching app on simulator...${NC}"
    
    if [ -d "$WORKSPACE" ]; then
        xcodebuild -workspace "$WORKSPACE" \
                   -scheme "$SCHEME" \
                   -destination "platform=iOS Simulator,name=$device_name" \
                   build
    else
        xcodebuild -project "$PROJECT" \
                   -scheme "$SCHEME" \
                   -destination "platform=iOS Simulator,name=$device_name" \
                   build
    fi
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Successfully launched on $device_name${NC}"
        echo -e "${YELLOW}👀 Please test the app manually on the simulator${NC}"
        echo -e "${YELLOW}Press Enter when done testing this device...${NC}"
        read
        return 0
    else
        echo -e "${RED}✗ Failed to launch on $device_name${NC}"
        return 1
    fi
}

# Function to run automated tests
run_automated_tests() {
    local device_name=$1
    echo -e "${BLUE}Running automated tests on $device_name...${NC}"
    
    if [ -d "$WORKSPACE" ]; then
        xcodebuild test \
                   -workspace "$WORKSPACE" \
                   -scheme "$SCHEME" \
                   -destination "platform=iOS Simulator,name=$device_name" \
                   -only-testing:HotelAppDeviceTests
    else
        xcodebuild test \
                   -project "$PROJECT" \
                   -scheme "$SCHEME" \
                   -destination "platform=iOS Simulator,name=$device_name" \
                   -only-testing:HotelAppDeviceTests
    fi
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Tests passed on $device_name${NC}"
        return 0
    else
        echo -e "${RED}✗ Tests failed on $device_name${NC}"
        return 1
    fi
}

# Function to list available simulators
list_simulators() {
    echo -e "${BLUE}Available iOS Simulators:${NC}"
    xcrun simctl list devices iOS | grep -v "unavailable"
}

# Main menu
show_menu() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════${NC}"
    echo -e "${BLUE}  Hotel Management iOS Testing Menu${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════${NC}"
    echo ""
    echo "1. Test on all configured devices"
    echo "2. Test on specific device"
    echo "3. Run automated tests"
    echo "4. List available simulators"
    echo "5. Build only"
    echo "6. Check backend connection"
    echo "7. Exit"
    echo ""
    echo -n "Choose an option: "
}

# Parse command line arguments
if [ "$1" = "all" ]; then
    MODE="all"
elif [ "$1" = "auto" ]; then
    MODE="auto"
elif [ "$1" = "list" ]; then
    list_simulators
    exit 0
else
    MODE="menu"
fi

# Main execution
main() {
    echo ""
    
    # Check backend
    check_backend
    if [ $? -ne 0 ]; then
        echo -e "${YELLOW}Continue anyway? (y/n)${NC}"
        read continue
        if [ "$continue" != "y" ]; then
            exit 1
        fi
    fi
    
    if [ "$MODE" = "all" ]; then
        # Test on all devices
        echo -e "${BLUE}Testing on all configured devices...${NC}"
        for device in "${DEVICES[@]}"; do
            run_on_device "$device"
        done
        echo -e "${GREEN}✓ All device testing complete!${NC}"
        
    elif [ "$MODE" = "auto" ]; then
        # Run automated tests
        echo -e "${BLUE}Running automated tests...${NC}"
        for device in "${DEVICES[@]}"; do
            run_automated_tests "$device"
        done
        echo -e "${GREEN}✓ Automated testing complete!${NC}"
        
    else
        # Interactive menu
        while true; do
            show_menu
            read choice
            
            case $choice in
                1)
                    for device in "${DEVICES[@]}"; do
                        run_on_device "$device"
                    done
                    echo -e "${GREEN}✓ All device testing complete!${NC}"
                    ;;
                2)
                    echo ""
                    echo "Available devices:"
                    for i in "${!DEVICES[@]}"; do
                        echo "$((i+1)). ${DEVICES[$i]}"
                    done
                    echo -n "Choose device number: "
                    read device_num
                    if [ "$device_num" -ge 1 ] && [ "$device_num" -le "${#DEVICES[@]}" ]; then
                        run_on_device "${DEVICES[$((device_num-1))]}"
                    else
                        echo -e "${RED}Invalid device number${NC}"
                    fi
                    ;;
                3)
                    echo ""
                    echo "Run automated tests on:"
                    echo "1. All devices"
                    echo "2. Specific device"
                    echo -n "Choose: "
                    read test_choice
                    
                    if [ "$test_choice" = "1" ]; then
                        for device in "${DEVICES[@]}"; do
                            run_automated_tests "$device"
                        done
                    elif [ "$test_choice" = "2" ]; then
                        echo ""
                        for i in "${!DEVICES[@]}"; do
                            echo "$((i+1)). ${DEVICES[$i]}"
                        done
                        echo -n "Choose device number: "
                        read device_num
                        if [ "$device_num" -ge 1 ] && [ "$device_num" -le "${#DEVICES[@]}" ]; then
                            run_automated_tests "${DEVICES[$((device_num-1))]}"
                        fi
                    fi
                    ;;
                4)
                    list_simulators
                    ;;
                5)
                    build_app
                    ;;
                6)
                    check_backend
                    ;;
                7)
                    echo -e "${BLUE}Goodbye!${NC}"
                    exit 0
                    ;;
                *)
                    echo -e "${RED}Invalid option${NC}"
                    ;;
            esac
        done
    fi
}

# Run main function
main
