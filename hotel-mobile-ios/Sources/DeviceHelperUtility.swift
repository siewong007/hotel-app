import UIKit

/// Helper for device-specific UI adaptations
enum DeviceHelper {
    
    // MARK: - Device Type Detection
    
    static var isIPad: Bool {
        return UIDevice.current.userInterfaceIdiom == .pad
    }
    
    static var isIPhone: Bool {
        return UIDevice.current.userInterfaceIdiom == .phone
    }
    
    static var screenSize: CGSize {
        return UIScreen.main.bounds.size
    }
    
    static var isCompact: Bool {
        // iPhone SE, iPhone 8 and smaller
        return screenSize.width <= 375
    }
    
    static var isLandscape: Bool {
        return screenSize.width > screenSize.height
    }
    
    // MARK: - Layout Constants
    
    /// Horizontal padding for content
    static var contentPadding: CGFloat {
        if isIPad {
            return 40 // More padding on iPad
        } else if isCompact {
            return 16 // Less padding on small iPhone
        } else {
            return 20 // Standard iPhone padding
        }
    }
    
    /// Maximum width for centered content (useful for iPad)
    static var maxContentWidth: CGFloat {
        if isIPad {
            return 600 // Constrain content width on iPad
        } else {
            return .infinity // Full width on iPhone
        }
    }
    
    /// Spacing between elements
    static var stackSpacing: CGFloat {
        return isIPad ? 20 : 16
    }
    
    /// Standard button height
    static var buttonHeight: CGFloat {
        return isIPad ? 50 : 44
    }
    
    /// Text field height
    static var textFieldHeight: CGFloat {
        return isIPad ? 50 : 44
    }
    
    /// Cell height for table views
    static var minimumCellHeight: CGFloat {
        return isIPad ? 60 : 44
    }
    
    // MARK: - Font Sizes
    
    static func fontSize(compact: CGFloat, standard: CGFloat, expanded: CGFloat) -> CGFloat {
        if isCompact {
            return compact
        } else if isIPad {
            return expanded
        } else {
            return standard
        }
    }
    
    static var titleFontSize: CGFloat {
        return fontSize(compact: 24, standard: 28, expanded: 34)
    }
    
    static var headlineFontSize: CGFloat {
        return fontSize(compact: 16, standard: 18, expanded: 22)
    }
    
    static var bodyFontSize: CGFloat {
        return fontSize(compact: 14, standard: 16, expanded: 18)
    }
    
    static var captionFontSize: CGFloat {
        return fontSize(compact: 12, standard: 13, expanded: 15)
    }
    
    // MARK: - Network Configuration Helpers
    
    /// Get the appropriate server URL hint based on device
    static var serverURLHint: String {
        if ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"] != nil {
            return "Use http://localhost:3030 for simulator"
        } else {
            return "Use http://YOUR_IP:3030 for physical device"
        }
    }
    
    /// Detect if running in simulator
    static var isSimulator: Bool {
        #if targetEnvironment(simulator)
        return true
        #else
        return false
        #endif
    }
    
    // MARK: - Device Info for Debugging
    
    static var deviceInfo: String {
        let device = UIDevice.current
        let idiom = isIPad ? "iPad" : "iPhone"
        let size = "\(Int(screenSize.width))x\(Int(screenSize.height))"
        let orientation = isLandscape ? "Landscape" : "Portrait"
        let environment = isSimulator ? "Simulator" : "Physical"
        
        return """
        Device: \(idiom)
        Screen: \(size) (\(orientation))
        Environment: \(environment)
        iOS: \(device.systemVersion)
        """
    }
    
    // MARK: - Split View Support (iPad)
    
    /// Check if currently in split view mode
    static func isInSplitView(viewController: UIViewController) -> Bool {
        guard isIPad else { return false }
        
        if let window = viewController.view.window {
            return window.frame.width < UIScreen.main.bounds.width
        }
        return false
    }
    
    /// Get appropriate column count for collection views
    static func columnCount(compact: Int, standard: Int, expanded: Int) -> Int {
        if isCompact {
            return compact
        } else if isIPad {
            return expanded
        } else {
            return standard
        }
    }
}

// MARK: - UIViewController Extension

extension UIViewController {
    
    /// Show device info alert (for testing)
    func showDeviceInfo() {
        let alert = UIAlertController(
            title: "Device Information",
            message: DeviceHelper.deviceInfo,
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
    
    /// Get safe content width considering device and split view
    var safeContentWidth: CGFloat {
        let width = view.bounds.width - (DeviceHelper.contentPadding * 2)
        return min(width, DeviceHelper.maxContentWidth)
    }
}

// MARK: - Size Classes Helper

extension UITraitCollection {
    
    var isIPadDevice: Bool {
        return horizontalSizeClass == .regular && verticalSizeClass == .regular
    }
    
    var isIPhonePortrait: Bool {
        return horizontalSizeClass == .compact && verticalSizeClass == .regular
    }
    
    var isIPhoneLandscape: Bool {
        return horizontalSizeClass == .compact && verticalSizeClass == .compact
    }
}
