import SwiftUI

/// Main content view with Liquid Glass design
struct ContentView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var intelligenceManager: IntelligenceManager
    
    var body: some View {
        TabView(selection: $appState.currentTab) {
            IntelligenceView()
                .tabItem {
                    Label("Intelligence", systemImage: appState.currentTab.icon)
                }
                .tag(AppState.Tab.intelligence)
            
            EnhancedCameraView()
                .tabItem {
                    Label("Camera", systemImage: AppState.Tab.camera.icon)
                }
                .tag(AppState.Tab.camera)
            
            SpatialFeaturesView()
                .tabItem {
                    Label("Spatial", systemImage: AppState.Tab.spatial.icon)
                }
                .tag(AppState.Tab.spatial)
            
            PerformanceView()
                .tabItem {
                    Label("Performance", systemImage: AppState.Tab.performance.icon)
                }
                .tag(AppState.Tab.performance)
        }
        .liquidGlassBackground()
    }
}

/// Custom Liquid Glass modifier for modern iOS design
extension View {
    func liquidGlassBackground() -> some View {
        self.modifier(LiquidGlassModifier())
    }
}

struct LiquidGlassModifier: ViewModifier {
    @State private var isPressed = false
    
    func body(content: Content) -> some View {
        content
            .background {
                ZStack {
                    // Base blur effect
                    Color.clear
                        .background(.ultraThinMaterial)
                    
                    // Dynamic color reflection
                    Color.accentColor.opacity(0.1)
                        .blendMode(.overlay)
                    
                    // Interactive shimmer effect
                    if isPressed {
                        LinearGradient(
                            colors: [
                                .white.opacity(0.3),
                                .clear,
                                .white.opacity(0.2)
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                        .transition(.opacity)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            }
            .simultaneousGesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                            isPressed = true
                        }
                    }
                    .onEnded { _ in
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                            isPressed = false
                        }
                    }
            )
    }
}

#Preview {
    ContentView()
        .environmentObject(AppState())
        .environmentObject(IntelligenceManager())
}
