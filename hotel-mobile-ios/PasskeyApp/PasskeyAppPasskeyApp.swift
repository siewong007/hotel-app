//
//  PasskeyApp.swift
//  PasskeyApp
//
//  Created on December 7, 2025.
//

import SwiftUI

@main
struct PasskeyApp: App {
    @StateObject private var authenticationManager = AuthenticationManager()
    
    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(authenticationManager)
        }
    }
}
