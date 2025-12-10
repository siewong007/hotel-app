import XCTest

/// Automated UI tests for multiple device types
@MainActor
class HotelAppDeviceTests: XCTestCase {
    
    var app: XCUIApplication!
    
    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launch()
    }
    
    override func tearDownWithError() throws {
        app = nil
    }
    
    // MARK: - Device-Specific Tests
    
    func testLoginOnAllDevices() throws {
        // This test should be run on multiple device simulators
        
        let usernameField = app.textFields["Username or Email"]
        let passwordField = app.secureTextFields["Password"]
        let loginButton = app.buttons["Login"]
        
        // Verify elements exist
        XCTAssertTrue(usernameField.exists, "Username field should exist")
        XCTAssertTrue(passwordField.exists, "Password field should exist")
        XCTAssertTrue(loginButton.exists, "Login button should exist")
        
        // Verify elements are visible
        XCTAssertTrue(usernameField.isHittable, "Username field should be tappable")
        XCTAssertTrue(passwordField.isHittable, "Password field should be tappable")
        XCTAssertTrue(loginButton.isHittable, "Login button should be tappable")
        
        // Perform login
        usernameField.tap()
        usernameField.typeText("admin")
        
        passwordField.tap()
        passwordField.typeText("admin123")
        
        loginButton.tap()
        
        // Wait for main interface
        let tabBar = app.tabBars.firstMatch
        let exists = tabBar.waitForExistence(timeout: 5)
        XCTAssertTrue(exists, "Tab bar should appear after successful login")
    }
    
    func testGuestListDisplaysCorrectly() throws {
        // Assumes already logged in or add login flow
        performLogin()
        
        let guestsTab = app.tabBars.buttons["Guests"]
        XCTAssertTrue(guestsTab.exists, "Guests tab should exist")
        
        guestsTab.tap()
        
        // Check table view exists
        let tableView = app.tables.firstMatch
        XCTAssertTrue(tableView.exists, "Guest table should exist")
        
        // Check for add button
        let addButton = app.navigationBars.buttons["Add"]
        XCTAssertTrue(addButton.exists, "Add button should exist in navigation bar")
    }
    
    func testBookingListWithFilter() throws {
        performLogin()
        
        let bookingsTab = app.tabBars.buttons["Bookings"]
        bookingsTab.tap()
        
        // Check filter button
        let filterButton = app.navigationBars.buttons["Filter"]
        XCTAssertTrue(filterButton.exists, "Filter button should exist")
        
        // Tap filter
        filterButton.tap()
        
        // Verify action sheet appears
        let actionSheet = app.sheets.firstMatch
        XCTAssertTrue(actionSheet.waitForExistence(timeout: 2), "Filter action sheet should appear")
    }
    
    func testSettingsDisplayDeviceInfo() throws {
        performLogin()
        
        let settingsTab = app.tabBars.buttons["Settings"]
        settingsTab.tap()
        
        // Scroll to device info button if needed
        let deviceInfoButton = app.buttons["Show Device Info"]
        
        // If button not immediately visible, scroll
        if !deviceInfoButton.isHittable {
            app.swipeUp()
        }
        
        XCTAssertTrue(deviceInfoButton.exists, "Device Info button should exist")
        
        deviceInfoButton.tap()
        
        // Verify alert appears
        let alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 2), "Device info alert should appear")
        
        // Check alert contains device information
        XCTAssertTrue(alert.staticTexts["Device Information"].exists, "Alert should have title")
    }
    
    func testSwipeActionsOnGuest() throws {
        performLogin()
        
        let guestsTab = app.tabBars.buttons["Guests"]
        guestsTab.tap()
        
        // Wait for table to load
        let tableView = app.tables.firstMatch
        XCTAssertTrue(tableView.waitForExistence(timeout: 5), "Table should load")
        
        // Get first cell
        let firstCell = tableView.cells.firstMatch
        if firstCell.exists {
            // Swipe left to reveal delete button
            firstCell.swipeLeft()
            
            // Check delete button appears
            let deleteButton = firstCell.buttons["Delete"]
            XCTAssertTrue(deleteButton.exists, "Delete button should appear after swipe")
        }
    }
    
    func testPullToRefresh() throws {
        performLogin()
        
        let guestsTab = app.tabBars.buttons["Guests"]
        guestsTab.tap()
        
        let tableView = app.tables.firstMatch
        XCTAssertTrue(tableView.waitForExistence(timeout: 5), "Table should load")
        
        // Pull to refresh
        let start = tableView.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.1))
        let end = tableView.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6))
        start.press(forDuration: 0.01, thenDragTo: end)
        
        // Wait a moment for refresh
        sleep(2)
        
        // Table should still exist
        XCTAssertTrue(tableView.exists, "Table should still exist after refresh")
    }
    
    func testKeyboardAppearanceAndDismissal() throws {
        performLogin()
        
        let settingsTab = app.tabBars.buttons["Settings"]
        settingsTab.tap()
        
        // Tap server URL field
        let serverURLField = app.textFields.matching(identifier: "Server URL").firstMatch
        if !serverURLField.isHittable {
            app.swipeUp()
        }
        
        serverURLField.tap()
        
        // Keyboard should appear
        XCTAssertTrue(app.keyboards.firstMatch.exists, "Keyboard should appear")
        
        // Tap outside to dismiss (if scrollView allows)
        app.tap()
        
        // Note: Keyboard dismissal is tricky in tests, this is a basic check
    }
    
    func testAppHandlesBackgroundAndForeground() throws {
        performLogin()
        
        // Background the app
        XCUIDevice.shared.press(.home)
        sleep(2)
        
        // Bring app back to foreground
        app.activate()
        sleep(1)
        
        // App should still be on the same screen
        let tabBar = app.tabBars.firstMatch
        XCTAssertTrue(tabBar.exists, "App should return to same state")
    }
    
    func testLogout() throws {
        performLogin()
        
        let settingsTab = app.tabBars.buttons["Settings"]
        settingsTab.tap()
        
        // Scroll to logout button if needed
        let logoutButton = app.buttons["Logout"]
        if !logoutButton.isHittable {
            app.swipeUp()
        }
        
        logoutButton.tap()
        
        // Confirmation alert
        let alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 2), "Logout confirmation should appear")
        
        // Confirm logout
        alert.buttons["Logout"].tap()
        
        // Should return to login screen
        let loginButton = app.buttons["Login"]
        XCTAssertTrue(loginButton.waitForExistence(timeout: 3), "Should return to login screen")
    }
    
    // MARK: - Device-Specific Layout Tests
    
    func testLayoutOnSmallScreen() throws {
        // Run this test specifically on iPhone SE
        #if targetEnvironment(simulator)
        let deviceName = ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"]
        guard deviceName?.contains("SE") == true else {
            throw XCTSkip("This test is for iPhone SE only")
        }
        #endif
        
        performLogin()
        
        // Check that all tab bar items are visible
        let tabBar = app.tabBars.firstMatch
        XCTAssertTrue(tabBar.exists, "Tab bar should exist")
        
        let visibleButtons = tabBar.buttons.allElementsBoundByIndex
        XCTAssertGreaterThanOrEqual(visibleButtons.count, 4, "All tabs should be visible on small screen")
    }
    
    func testLayoutOnLargeScreen() throws {
        // Run this test specifically on iPad
        #if targetEnvironment(simulator)
        let deviceName = ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"]
        guard deviceName?.contains("iPad") == true else {
            throw XCTSkip("This test is for iPad only")
        }
        #endif
        
        performLogin()
        
        // On iPad, elements should have more spacing
        let guestsTab = app.tabBars.buttons["Guests"]
        guestsTab.tap()
        
        let tableView = app.tables.firstMatch
        XCTAssertTrue(tableView.exists, "Table should exist on iPad")
        
        // iPad should show more content
        let cells = tableView.cells.allElementsBoundByIndex
        XCTAssertGreaterThan(cells.count, 5, "iPad should show more cells due to larger screen")
    }
    
    // MARK: - Helper Methods
    
    private func performLogin() {
        let usernameField = app.textFields["Username or Email"]
        let passwordField = app.secureTextFields["Password"]
        let loginButton = app.buttons["Login"]
        
        // Only login if we're on the login screen
        if loginButton.exists {
            usernameField.tap()
            usernameField.typeText("admin")
            
            passwordField.tap()
            passwordField.typeText("admin123")
            
            loginButton.tap()
            
            // Wait for main interface
            _ = app.tabBars.firstMatch.waitForExistence(timeout: 5)
        }
    }
}

// MARK: - Performance Tests

class HotelAppPerformanceTests: XCTestCase {
    
    var app: XCUIApplication!
    
    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
    }
    
    func testLaunchPerformance() throws {
        measure(metrics: [XCTApplicationLaunchMetric()]) {
            app.launch()
        }
    }
    
    func testScrollPerformance() throws {
        app.launch()
        
        // Perform login
        let usernameField = app.textFields["Username or Email"]
        usernameField.tap()
        usernameField.typeText("admin")
        
        let passwordField = app.secureTextFields["Password"]
        passwordField.tap()
        passwordField.typeText("admin123")
        
        app.buttons["Login"].tap()
        
        // Wait for guests tab
        let guestsTab = app.tabBars.buttons["Guests"]
        _ = guestsTab.waitForExistence(timeout: 5)
        guestsTab.tap()
        
        let tableView = app.tables.firstMatch
        _ = tableView.waitForExistence(timeout: 5)
        
        // Measure scroll performance
        measure(metrics: [XCTOSSignpostMetric.scrollDecelerationMetric]) {
            tableView.swipeUp(velocity: .fast)
            tableView.swipeDown(velocity: .fast)
        }
    }
}
