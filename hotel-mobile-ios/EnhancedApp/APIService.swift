import Foundation
import Combine

/// Enhanced API Service with modern Swift Concurrency
/// Optimized for iPhone 17 Pro performance
@MainActor
class APIService: ObservableObject {
    static let shared = APIService()
    
    @Published var requestHistory: [APIRequest] = []
    @Published var isLoading = false
    @Published var error: APIError?
    
    private let urlSession: URLSession
    private let cache: URLCache
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder
    
    // Request rate limiting for iPhone 17 Pro optimization
    private var rateLimiter = RateLimiter(requestsPerSecond: 100)
    
    private init() {
        // Configure URLSession for optimal performance
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 300
        config.waitsForConnectivity = true
        config.requestCachePolicy = .returnCacheDataElseLoad
        
        // Enhanced cache for iPhone 17 Pro (8GB RAM)
        self.cache = URLCache(
            memoryCapacity: 100 * 1024 * 1024, // 100 MB
            diskCapacity: 500 * 1024 * 1024    // 500 MB
        )
        config.urlCache = cache
        
        // HTTP/3 support for faster connections
        config.multipathServiceType = .handover
        
        self.urlSession = URLSession(configuration: config)
        
        // Configure JSON handling
        self.decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        
        self.encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.keyEncodingStrategy = .convertToSnakeCase
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    }
    
    // MARK: - Generic Request Methods
    
    /// Perform GET request with automatic retries and caching
    func get<T: Decodable>(
        _ endpoint: String,
        queryItems: [URLQueryItem]? = nil,
        cachePolicy: URLRequest.CachePolicy = .returnCacheDataElseLoad
    ) async throws -> T {
        let request = try buildRequest(
            endpoint: endpoint,
            method: "GET",
            queryItems: queryItems,
            cachePolicy: cachePolicy
        )
        return try await performRequest(request)
    }
    
    /// Perform POST request with automatic encoding
    func post<T: Decodable, U: Encodable>(
        _ endpoint: String,
        body: U
    ) async throws -> T {
        let request = try buildRequest(
            endpoint: endpoint,
            method: "POST",
            body: body
        )
        return try await performRequest(request)
    }
    
    /// Perform PUT request
    func put<T: Decodable, U: Encodable>(
        _ endpoint: String,
        body: U
    ) async throws -> T {
        let request = try buildRequest(
            endpoint: endpoint,
            method: "PUT",
            body: body
        )
        return try await performRequest(request)
    }
    
    /// Perform DELETE request
    func delete<T: Decodable>(
        _ endpoint: String
    ) async throws -> T {
        let request = try buildRequest(
            endpoint: endpoint,
            method: "DELETE"
        )
        return try await performRequest(request)
    }
    
    /// Perform PATCH request
    func patch<T: Decodable, U: Encodable>(
        _ endpoint: String,
        body: U
    ) async throws -> T {
        let request = try buildRequest(
            endpoint: endpoint,
            method: "PATCH",
            body: body
        )
        return try await performRequest(request)
    }
    
    // MARK: - Streaming Support
    
    /// Stream data from endpoint (optimized for iPhone 17 Pro)
    func stream<T: Decodable>(
        _ endpoint: String
    ) -> AsyncThrowingStream<T, Error> {
        AsyncThrowingStream { continuation in
            Task {
                do {
                    guard let url = URL(string: endpoint) else {
                        throw APIError.invalidURL
                    }
                    
                    let (bytes, response) = try await urlSession.bytes(from: url)
                    
                    guard let httpResponse = response as? HTTPURLResponse else {
                        throw APIError.invalidResponse
                    }
                    
                    guard (200...299).contains(httpResponse.statusCode) else {
                        throw APIError.httpError(httpResponse.statusCode)
                    }
                    
                    var buffer = Data()
                    
                    for try await byte in bytes {
                        buffer.append(byte)
                        
                        // Try to decode when we hit a newline (NDJSON format)
                        if byte == UInt8(ascii: "\n") {
                            if let object = try? decoder.decode(T.self, from: buffer) {
                                continuation.yield(object)
                            }
                            buffer.removeAll()
                        }
                    }
                    
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
    }
    
    // MARK: - Batch Requests (Optimized for iPhone 17 Pro A18 Pro chip)
    
    /// Execute multiple requests concurrently
    func batchRequest<T: Decodable>(
        endpoints: [String]
    ) async throws -> [T] {
        try await withThrowingTaskGroup(of: T.self) { group in
            for endpoint in endpoints {
                group.addTask {
                    try await self.get(endpoint)
                }
            }
            
            var results: [T] = []
            for try await result in group {
                results.append(result)
            }
            return results
        }
    }
    
    // MARK: - Download with Progress
    
    /// Download file with progress tracking
    func download(
        from endpoint: String,
        progress: @escaping (Double) -> Void
    ) async throws -> URL {
        guard let url = URL(string: endpoint) else {
            throw APIError.invalidURL
        }
        
        let (asyncBytes, response) = try await urlSession.bytes(from: url)
        
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw APIError.invalidResponse
        }
        
        let contentLength = httpResponse.expectedContentLength
        var downloadedData = Data()
        
        for try await byte in asyncBytes {
            downloadedData.append(byte)
            
            if contentLength > 0 {
                let progressValue = Double(downloadedData.count) / Double(contentLength)
                await MainActor.run {
                    progress(progressValue)
                }
            }
        }
        
        // Save to temporary file
        let tempURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
        
        try downloadedData.write(to: tempURL)
        return tempURL
    }
    
    // MARK: - Upload with Progress
    
    /// Upload file with progress tracking
    func upload<T: Decodable>(
        to endpoint: String,
        fileURL: URL,
        progress: @escaping (Double) -> Void
    ) async throws -> T {
        guard let url = URL(string: endpoint) else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        
        let (data, response) = try await urlSession.upload(for: request, fromFile: fileURL)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        
        guard (200...299).contains(httpResponse.statusCode) else {
            throw APIError.httpError(httpResponse.statusCode)
        }
        
        return try decoder.decode(T.self, from: data)
    }
    
    // MARK: - WebSocket Support
    
    /// Connect to WebSocket for real-time communication
    func connectWebSocket(_ endpoint: String) async throws -> WebSocketConnection {
        guard let url = URL(string: endpoint) else {
            throw APIError.invalidURL
        }
        
        let webSocketTask = urlSession.webSocketTask(with: url)
        webSocketTask.resume()
        
        return WebSocketConnection(task: webSocketTask)
    }
    
    // MARK: - Private Helpers
    
    private func buildRequest<T: Encodable>(
        endpoint: String,
        method: String,
        queryItems: [URLQueryItem]? = nil,
        body: T? = nil,
        cachePolicy: URLRequest.CachePolicy = .useProtocolCachePolicy
    ) throws -> URLRequest {
        guard var urlComponents = URLComponents(string: endpoint) else {
            throw APIError.invalidURL
        }
        
        if let queryItems = queryItems {
            urlComponents.queryItems = queryItems
        }
        
        guard let url = urlComponents.url else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url, cachePolicy: cachePolicy)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("EnhancedAPIApp/1.0", forHTTPHeaderField: "User-Agent")
        
        // Add body if present
        if let body = body {
            request.httpBody = try encoder.encode(body)
        }
        
        return request
    }
    
    private func performRequest<T: Decodable>(
        _ request: URLRequest,
        retryCount: Int = 3
    ) async throws -> T {
        // Rate limiting
        await rateLimiter.wait()
        
        isLoading = true
        defer { isLoading = false }
        
        do {
            let (data, response) = try await urlSession.data(for: request)
            
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }
            
            // Log request
            logRequest(request, response: httpResponse, data: data)
            
            // Handle different status codes
            switch httpResponse.statusCode {
            case 200...299:
                return try decoder.decode(T.self, from: data)
            case 401:
                throw APIError.unauthorized
            case 403:
                throw APIError.forbidden
            case 404:
                throw APIError.notFound
            case 429:
                // Rate limited - retry with exponential backoff
                if retryCount > 0 {
                    try await Task.sleep(nanoseconds: UInt64(pow(2.0, Double(4 - retryCount)) * 1_000_000_000))
                    return try await performRequest(request, retryCount: retryCount - 1)
                }
                throw APIError.rateLimited
            case 500...599:
                throw APIError.serverError(httpResponse.statusCode)
            default:
                throw APIError.httpError(httpResponse.statusCode)
            }
        } catch let error as APIError {
            self.error = error
            throw error
        } catch {
            let apiError = APIError.networkError(error)
            self.error = apiError
            throw apiError
        }
    }
    
    private func logRequest(_ request: URLRequest, response: HTTPURLResponse, data: Data) {
        let apiRequest = APIRequest(
            url: request.url?.absoluteString ?? "",
            method: request.httpMethod ?? "GET",
            statusCode: response.statusCode,
            timestamp: Date(),
            responseSize: data.count
        )
        
        requestHistory.insert(apiRequest, at: 0)
        
        // Keep only last 100 requests
        if requestHistory.count > 100 {
            requestHistory.removeLast()
        }
    }
    
    // MARK: - Cache Management
    
    func clearCache() {
        cache.removeAllCachedResponses()
    }
    
    func getCacheSize() -> Int64 {
        return Int64(cache.currentDiskUsage)
    }
}

// MARK: - Supporting Types

struct APIRequest: Identifiable {
    let id = UUID()
    let url: String
    let method: String
    let statusCode: Int
    let timestamp: Date
    let responseSize: Int
}

enum APIError: LocalizedError {
    case invalidURL
    case invalidResponse
    case networkError(Error)
    case httpError(Int)
    case unauthorized
    case forbidden
    case notFound
    case rateLimited
    case serverError(Int)
    case decodingError(Error)
    
    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .invalidResponse:
            return "Invalid response from server"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .httpError(let code):
            return "HTTP error: \(code)"
        case .unauthorized:
            return "Unauthorized - Please log in"
        case .forbidden:
            return "Access forbidden"
        case .notFound:
            return "Resource not found"
        case .rateLimited:
            return "Too many requests - Please try again later"
        case .serverError(let code):
            return "Server error: \(code)"
        case .decodingError(let error):
            return "Failed to decode response: \(error.localizedDescription)"
        }
    }
}

// MARK: - Rate Limiter

actor RateLimiter {
    private let requestsPerSecond: Int
    private var tokens: Int
    private var lastRefill: Date
    
    init(requestsPerSecond: Int) {
        self.requestsPerSecond = requestsPerSecond
        self.tokens = requestsPerSecond
        self.lastRefill = Date()
    }
    
    func wait() async {
        refillTokens()
        
        while tokens <= 0 {
            try? await Task.sleep(nanoseconds: 10_000_000) // 10ms
            refillTokens()
        }
        
        tokens -= 1
    }
    
    private func refillTokens() {
        let now = Date()
        let timePassed = now.timeIntervalSince(lastRefill)
        let tokensToAdd = Int(timePassed * Double(requestsPerSecond))
        
        if tokensToAdd > 0 {
            tokens = min(tokens + tokensToAdd, requestsPerSecond)
            lastRefill = now
        }
    }
}

// MARK: - WebSocket Connection

class WebSocketConnection {
    private let task: URLSessionWebSocketTask
    
    init(task: URLSessionWebSocketTask) {
        self.task = task
    }
    
    func send(_ message: String) async throws {
        try await task.send(.string(message))
    }
    
    func receive() async throws -> String {
        let message = try await task.receive()
        switch message {
        case .string(let text):
            return text
        case .data(let data):
            return String(data: data, encoding: .utf8) ?? ""
        @unknown default:
            return ""
        }
    }
    
    func close() {
        task.cancel(with: .goingAway, reason: nil)
    }
}
