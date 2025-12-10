//
//  APIService.swift
//  High-level API Service Layer
//
//  Optimized for iPhone 17 Pro
//

import Foundation

/// High-level API service for common operations
@MainActor
class APIService: ObservableObject {
    
    // MARK: - Published Properties
    @Published var isLoading = false
    @Published var error: Error?
    @Published var users: [User] = []
    @Published var posts: [Post] = []
    
    // MARK: - Private Properties
    private let apiClient = APIClient.shared
    
    // MARK: - User Operations
    
    func fetchUsers() async {
        isLoading = true
        error = nil
        
        do {
            let response: APIResponse<[User]> = try await apiClient.get(
                endpoint: "/users",
                useCache: true
            )
            
            if let users = response.data {
                self.users = users
                print("✅ Fetched \(users.count) users")
            }
        } catch {
            self.error = error
            print("❌ Error fetching users: \(error)")
        }
        
        isLoading = false
    }
    
    func fetchUser(id: Int) async throws -> User {
        let response: APIResponse<User> = try await apiClient.get(
            endpoint: "/users/\(id)",
            useCache: true
        )
        
        guard let user = response.data else {
            throw APIError.invalidResponse
        }
        
        return user
    }
    
    func createUser(name: String, email: String) async throws -> User {
        struct CreateUserRequest: Encodable {
            let name: String
            let email: String
        }
        
        let request = CreateUserRequest(name: name, email: email)
        let response: APIResponse<User> = try await apiClient.post(
            endpoint: "/users",
            body: request
        )
        
        guard let user = response.data else {
            throw APIError.invalidResponse
        }
        
        print("✅ Created user: \(user.name)")
        return user
    }
    
    func updateUser(id: Int, name: String?, email: String?) async throws -> User {
        struct UpdateUserRequest: Encodable {
            let name: String?
            let email: String?
        }
        
        let request = UpdateUserRequest(name: name, email: email)
        let response: APIResponse<User> = try await apiClient.put(
            endpoint: "/users/\(id)",
            body: request
        )
        
        guard let user = response.data else {
            throw APIError.invalidResponse
        }
        
        print("✅ Updated user: \(user.name)")
        return user
    }
    
    func deleteUser(id: Int) async throws {
        struct DeleteResponse: Decodable {
            let success: Bool
        }
        
        let _: DeleteResponse = try await apiClient.delete(
            endpoint: "/users/\(id)"
        )
        
        print("✅ Deleted user with id: \(id)")
    }
    
    // MARK: - Post Operations
    
    func fetchPosts() async {
        isLoading = true
        error = nil
        
        do {
            let response: APIResponse<[Post]> = try await apiClient.get(
                endpoint: "/posts",
                useCache: true
            )
            
            if let posts = response.data {
                self.posts = posts
                print("✅ Fetched \(posts.count) posts")
            }
        } catch {
            self.error = error
            print("❌ Error fetching posts: \(error)")
        }
        
        isLoading = false
    }
    
    func fetchPost(id: Int) async throws -> Post {
        let response: APIResponse<Post> = try await apiClient.get(
            endpoint: "/posts/\(id)",
            useCache: true
        )
        
        guard let post = response.data else {
            throw APIError.invalidResponse
        }
        
        return post
    }
    
    func createPost(title: String, body: String, userId: Int) async throws -> Post {
        struct CreatePostRequest: Encodable {
            let title: String
            let body: String
            let userId: Int
            
            enum CodingKeys: String, CodingKey {
                case title
                case body
                case userId = "user_id"
            }
        }
        
        let request = CreatePostRequest(title: title, body: body, userId: userId)
        let response: APIResponse<Post> = try await apiClient.post(
            endpoint: "/posts",
            body: request
        )
        
        guard let post = response.data else {
            throw APIError.invalidResponse
        }
        
        print("✅ Created post: \(post.title)")
        return post
    }
    
    func likePost(id: Int) async throws {
        struct LikeResponse: Decodable {
            let likes: Int
        }
        
        let _: LikeResponse = try await apiClient.post(
            endpoint: "/posts/\(id)/like",
            body: EmptyRequest()
        )
        
        print("✅ Liked post with id: \(id)")
    }
    
    // MARK: - Real-time Streaming
    
    func streamUpdates() -> AsyncThrowingStream<Data, Error> {
        return apiClient.stream(endpoint: "/stream/updates")
    }
    
    // MARK: - Analytics
    
    func sendAnalytics(event: String, properties: [String: String] = [:]) async {
        do {
            let analyticsEvent = AnalyticsEvent(
                name: event,
                properties: properties,
                timestamp: Date(),
                deviceInfo: DeviceInfo.current
            )
            
            struct AnalyticsResponse: Decodable {
                let success: Bool
            }
            
            let _: AnalyticsResponse = try await apiClient.post(
                endpoint: "/analytics",
                body: analyticsEvent
            )
            
            print("📊 Analytics sent: \(event)")
        } catch {
            print("⚠️ Analytics error: \(error)")
        }
    }
    
    // MARK: - Device Diagnostics
    
    func reportDeviceMetrics() async {
        let metrics = NetworkMetrics(
            latency: 0.05,
            downloadSpeed: 50.0,
            uploadSpeed: 20.0,
            connectionType: "WiFi",
            timestamp: Date()
        )
        
        do {
            struct MetricsResponse: Decodable {
                let received: Bool
            }
            
            let _: MetricsResponse = try await apiClient.post(
                endpoint: "/metrics",
                body: metrics
            )
            
            print("📈 Device metrics reported")
        } catch {
            print("⚠️ Metrics error: \(error)")
        }
    }
    
    // MARK: - Cache Management
    
    func clearCache() async {
        await apiClient.clearCache()
    }
}

// MARK: - Helper Types
private struct EmptyRequest: Encodable {}
