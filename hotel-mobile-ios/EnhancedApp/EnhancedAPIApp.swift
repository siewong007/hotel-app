import SwiftUI

@main
struct EnhancedAPIApp: App {
    @StateObject private var networkMonitor = NetworkMonitor()
    @StateObject private var apiService = APIService.shared
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(networkMonitor)
                .environmentObject(apiService)
                .preferredColorScheme(.dark) // Optimized for iPhone 17 Pro OLED
        }
    }
}
