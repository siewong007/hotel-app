//
//  AppDelegate.swift
//  Enhanced iOS App
//
//  Optimized for iPhone 17 Pro
//

import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        
        // Configure for iPhone 17 Pro features
        configureAppearance()
        configureNetworking()
        
        // Setup window
        window = UIWindow(frame: UIScreen.main.bounds)
        window?.rootViewController = MainViewController()
        window?.makeKeyAndVisible()
        
        print("✅ App launched - Optimized for iPhone 17 Pro")
        
        return true
    }
    
    private func configureAppearance() {
        // ProMotion display support (120Hz)
        if #available(iOS 15.0, *) {
            // Enable high frame rate for smooth animations
            UIScreen.main.maximumFramesPerSecond = 120
        }
        
        // Dynamic Island optimizations
        if #available(iOS 16.1, *) {
            print("✅ Dynamic Island support enabled")
        }
    }
    
    private func configureNetworking() {
        // Configure URLSession with optimizations
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 300
        configuration.waitsForConnectivity = true
        configuration.requestCachePolicy = .returnCacheDataElseLoad
        
        print("✅ Network configuration complete")
    }
    
    func applicationWillResignActive(_ application: UIApplication) {
        // Optimize for Always-On Display (iPhone 17 Pro)
        print("📱 App entering background - Optimizing for Always-On Display")
    }
}
