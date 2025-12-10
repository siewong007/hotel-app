import SwiftUI

struct ContentView: View {
    @EnvironmentObject var apiService: APIService
    @EnvironmentObject var networkMonitor: NetworkMonitor
    @State private var selectedTab = 0
    
    var body: some View {
        TabView(selection: $selectedTab) {
            APIExplorerView()
                .tabItem {
                    Label("APIs", systemImage: "network")
                }
                .tag(0)
            
            RealTimeDataView()
                .tabItem {
                    Label("Real-Time", systemImage: "antenna.radiowaves.left.and.right")
                }
                .tag(1)
            
            PerformanceView()
                .tabItem {
                    Label("Performance", systemImage: "speedometer")
                }
                .tag(2)
            
            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
                .tag(3)
        }
        .overlay(alignment: .top) {
            if !networkMonitor.isConnected {
                NetworkStatusBanner()
            }
        }
    }
}

struct NetworkStatusBanner: View {
    var body: some View {
        HStack {
            Image(systemName: "wifi.slash")
            Text("No Internet Connection")
                .font(.subheadline)
        }
        .foregroundColor(.white)
        .padding()
        .frame(maxWidth: .infinity)
        .background(Color.red)
    }
}

#Preview {
    ContentView()
        .environmentObject(APIService.shared)
        .environmentObject(NetworkMonitor())
}
