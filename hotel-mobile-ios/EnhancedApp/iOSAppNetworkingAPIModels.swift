//
//  APIModels.swift
//  API Data Models
//
//  Enhanced for iPhone 17 Pro testing
//

import Foundation

// MARK: - Sample API Models

/// Generic API Response wrapper
struct APIResponse<T: Codable>: Codable {
    let success: Bool
    let data: T?
    let message: String?
    let timestamp: Date?
}

/// User model
struct User: Codable, Identifiable {
    let id: Int
    let name: String
    let email: String
    let avatar: String?
    let createdAt: Date?
    
    enum CodingKeys: String, CodingKey {
        case id
        case name
        case email
        case avatar
        case createdAt = "created_at"
    }
}

/// Post model
struct Post: Codable, Identifiable {
    let id: Int
    let userId: Int
    let title: String
    let body: String
    let imageUrl: String?
    let likes: Int
    let createdAt: Date?
    
    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case title
        case body
        case imageUrl = "image_url"
        case likes
        case createdAt = "created_at"
    }
}

/// Comment model
struct Comment: Codable, Identifiable {
    let id: Int
    let postId: Int
    let userId: Int
    let content: String
    let createdAt: Date?
    
    enum CodingKeys: String, CodingKey {
        case id
        case postId = "post_id"
        case userId = "user_id"
        case content
        case createdAt = "created_at"
    }
}

/// Device Info (iPhone 17 Pro specific)
struct DeviceInfo: Codable {
    let model: String
    let osVersion: String
    let screenSize: ScreenSize
    let hasDynamicIsland: Bool
    let supportsProMotion: Bool
    let supportsAlwaysOn: Bool
    
    struct ScreenSize: Codable {
        let width: Double
        let height: Double
        let scale: Double
    }
    
    static var current: DeviceInfo {
        let screen = UIScreen.main
        return DeviceInfo(
            model: UIDevice.current.model,
            osVersion: UIDevice.current.systemVersion,
            screenSize: ScreenSize(
                width: Double(screen.bounds.width),
                height: Double(screen.bounds.height),
                scale: Double(screen.scale)
            ),
            hasDynamicIsland: screen.bounds.height >= 852, // iPhone 14 Pro and later
            supportsProMotion: screen.maximumFramesPerSecond >= 120,
            supportsAlwaysOn: screen.bounds.height >= 852 // iPhone 14 Pro and later
        )
    }
}

/// Analytics Event
struct AnalyticsEvent: Codable {
    let name: String
    let properties: [String: String]
    let timestamp: Date
    let deviceInfo: DeviceInfo
}

/// Network Quality Metrics
struct NetworkMetrics: Codable {
    let latency: TimeInterval
    let downloadSpeed: Double
    let uploadSpeed: Double
    let connectionType: String
    let timestamp: Date
}
