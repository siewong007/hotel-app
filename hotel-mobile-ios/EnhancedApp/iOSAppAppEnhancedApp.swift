import SwiftUI
import FoundationModels
import AppIntents

/// Main application entry point optimized for iPhone 17 Pro
/// Features: Apple Intelligence, Visual Intelligence, Liquid Glass design
@main
struct EnhancedApp: App {
    @StateObject private var appState = AppState()
    @StateObject private var intelligenceManager = IntelligenceManager()
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(appState)
                .environmentObject(intelligenceManager)
                .preferredColorScheme(appState.colorScheme)
                .onAppear {
                    configureForProDevice()
                }
        }
    }
    
    /// Configure app specifically for iPhone Pro features
    private func configureForProDevice() {
        // Enable ProMotion 120Hz optimization
        appState.enableProMotion = true
        
        // Enable Advanced Display Engine features
        appState.enableDynamicIsland = true
        
        // Configure for A19 Pro chip capabilities
        intelligenceManager.configureForProPerformance()
    }
}

/// Application state manager
@MainActor
class AppState: ObservableObject {
    @Published var colorScheme: ColorScheme?
    @Published var enableProMotion: Bool = false
    @Published var enableDynamicIsland: Bool = false
    @Published var currentTab: Tab = .intelligence
    
    enum Tab: String, CaseIterable, Identifiable {
        case intelligence
        case camera
        case spatial
        case performance
        
        var id: String { rawValue }
        
        var icon: String {
            switch self {
            case .intelligence: return "brain.fill"
            case .camera: return "camera.fill"
            case .spatial: return "cube.fill"
            case .performance: return "bolt.fill"
            }
        }
        
        var title: String {
            rawValue.capitalized
        }
    }
}
