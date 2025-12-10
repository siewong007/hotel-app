//
//  APIClient.swift
//  Enhanced API Client with Swift Concurrency
//
//  Optimized for iPhone 17 Pro performance
//

import Foundation

/// Enhanced API Client using modern Swift Concurrency
actor APIClient {
    
    // MARK: - Singleton
    static let shared = APIClient()
    
    // MARK: - Properties
    private let session: URLSession
    private let baseURL: String
    private var cache: [String: CachedResponse] = [:]
    
    // MARK: - Configuration
    struct Configuration {
        var baseURL: String = "https://api.example.com"
        var timeout: TimeInterval = 30
        var cachePolicy: URLRequest.CachePolicy = .returnCacheDataElseLoad
        var maxRetries: Int = 3
    }
    
    private let config: Configuration
    
    // MARK: - Initialization
    private init(configuration: Configuration = Configuration()) {
        self.config = configuration
        self.baseURL = configuration.baseURL
        
        let sessionConfig = URLSessionConfiguration.default
        sessionConfig.timeoutIntervalForRequest = configuration.timeout
        sessionConfig.requestCachePolicy = configuration.cachePolicy
        sessionConfig.waitsForConnectivity = true
        
        // iPhone 17 Pro optimizations
        sessionConfig.multipathServiceType = .handover
        sessionConfig.allowsConstrainedNetworkAccess = true
        sessionConfig.allowsExpensiveNetworkAccess = true
        
        self.session = URLSession(configuration: sessionConfig)
    }
    
    // MARK: - Request Methods
    
    /// Generic GET request with automatic retry and caching
    func get<T: Decodable>(
        endpoint: String,
        queryItems: [URLQueryItem]? = nil,
        headers: [String: String]? = nil,
        useCache: Bool = true
    ) async throws -> T {
        
        let request = try buildRequest(
            endpoint: endpoint,
            method: "GET",
            queryItems: queryItems,
            headers: headers
        )
        
        // Check cache first
        if useCache, let cached = await getCachedResponse(for: request.url?.absoluteString ?? "") {
            if let decoded = try? JSONDecoder().decode(T.self, from: cached.data) {
                print("📦 Cache hit for: \(endpoint)")
                return decoded
            }
        }
        
        let data = try await performRequest(request)
        
        // Cache the response
        if useCache {
            await cacheResponse(data, for: request.url?.absoluteString ?? "")
        }
        
        return try JSONDecoder().decode(T.self, from: data)
    }
    
    /// Generic POST request
    func post<T: Decodable, Body: Encodable>(
        endpoint: String,
        body: Body,
        headers: [String: String]? = nil
    ) async throws -> T {
        
        let request = try buildRequest(
            endpoint: endpoint,
            method: "POST",
            body: body,
            headers: headers
        )
        
        let data = try await performRequest(request)
        return try JSONDecoder().decode(T.self, from: data)
    }
    
    /// Generic PUT request
    func put<T: Decodable, Body: Encodable>(
        endpoint: String,
        body: Body,
        headers: [String: String]? = nil
    ) async throws -> T {
        
        let request = try buildRequest(
            endpoint: endpoint,
            method: "PUT",
            body: body,
            headers: headers
        )
        
        let data = try await performRequest(request)
        return try JSONDecoder().decode(T.self, from: data)
    }
    
    /// Generic DELETE request
    func delete<T: Decodable>(
        endpoint: String,
        headers: [String: String]? = nil
    ) async throws -> T {
        
        let request = try buildRequest(
            endpoint: endpoint,
            method: "DELETE",
            headers: headers
        )
        
        let data = try await performRequest(request)
        return try JSONDecoder().decode(T.self, from: data)
    }
    
    // MARK: - Streaming Support
    
    /// Stream data using AsyncSequence (perfect for real-time updates)
    func stream(
        endpoint: String,
        headers: [String: String]? = nil
    ) -> AsyncThrowingStream<Data, Error> {
        
        AsyncThrowingStream { continuation in
            Task {
                do {
                    let request = try buildRequest(
                        endpoint: endpoint,
                        method: "GET",
                        headers: headers
                    )
                    
                    let (asyncBytes, response) = try await session.bytes(for: request)
                    
                    guard let httpResponse = response as? HTTPURLResponse,
                          (200...299).contains(httpResponse.statusCode) else {
                        throw APIError.invalidResponse
                    }
                    
                    for try await byte in asyncBytes {
                        var data = Data()
                        data.append(byte)
                        continuation.yield(data)
                    }
                    
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
    }
    
    // MARK: - Download Support
    
    /// Download file with progress tracking
    func download(
        from url: URL,
        progressHandler: @escaping (Double) -> Void
    ) async throws -> URL {
        
        let request = URLRequest(url: url)
        
        let (localURL, response) = try await session.download(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.invalidResponse
        }
        
        return localURL
    }
    
    // MARK: - Private Helpers
    
    private func buildRequest<Body: Encodable>(
        endpoint: String,
        method: String,
        queryItems: [URLQueryItem]? = nil,
        body: Body? = nil,
        headers: [String: String]? = nil
    ) throws -> URLRequest {
        
        guard var urlComponents = URLComponents(string: baseURL + endpoint) else {
            throw APIError.invalidURL
        }
        
        if let queryItems = queryItems {
            urlComponents.queryItems = queryItems
        }
        
        guard let url = urlComponents.url else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        
        // Add custom headers
        headers?.forEach { key, value in
            request.setValue(value, forHTTPHeaderField: key)
        }
        
        // Add body if present
        if let body = body {
            request.httpBody = try JSONEncoder().encode(body)
        }
        
        return request
    }
    
    private func buildRequest(
        endpoint: String,
        method: String,
        queryItems: [URLQueryItem]? = nil,
        headers: [String: String]? = nil
    ) throws -> URLRequest {
        
        return try buildRequest(
            endpoint: endpoint,
            method: method,
            queryItems: queryItems,
            body: EmptyBody?.none,
            headers: headers
        )
    }
    
    private func performRequest(_ request: URLRequest, retryCount: Int = 0) async throws -> Data {
        do {
            let (data, response) = try await session.data(for: request)
            
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }
            
            guard (200...299).contains(httpResponse.statusCode) else {
                throw APIError.httpError(statusCode: httpResponse.statusCode)
            }
            
            print("✅ Request successful: \(request.url?.absoluteString ?? "")")
            return data
            
        } catch {
            // Retry logic for network errors
            if retryCount < config.maxRetries {
                print("⚠️ Request failed, retrying... (\(retryCount + 1)/\(config.maxRetries))")
                try await Task.sleep(nanoseconds: UInt64(pow(2.0, Double(retryCount)) * 1_000_000_000))
                return try await performRequest(request, retryCount: retryCount + 1)
            }
            
            throw error
        }
    }
    
    // MARK: - Caching
    
    private struct CachedResponse {
        let data: Data
        let timestamp: Date
        let expiresIn: TimeInterval = 300 // 5 minutes
        
        var isExpired: Bool {
            Date().timeIntervalSince(timestamp) > expiresIn
        }
    }
    
    private func cacheResponse(_ data: Data, for key: String) {
        cache[key] = CachedResponse(data: data, timestamp: Date())
    }
    
    private func getCachedResponse(for key: String) -> CachedResponse? {
        guard let cached = cache[key], !cached.isExpired else {
            cache.removeValue(forKey: key)
            return nil
        }
        return cached
    }
    
    func clearCache() {
        cache.removeAll()
        print("🗑️ Cache cleared")
    }
}

// MARK: - Empty Body Helper
private struct EmptyBody: Encodable {}

// MARK: - API Errors
enum APIError: LocalizedError {
    case invalidURL
    case invalidResponse
    case httpError(statusCode: Int)
    case decodingError(Error)
    case networkError(Error)
    
    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .invalidResponse:
            return "Invalid response from server"
        case .httpError(let statusCode):
            return "HTTP Error: \(statusCode)"
        case .decodingError(let error):
            return "Decoding error: \(error.localizedDescription)"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        }
    }
}
