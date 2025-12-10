import Foundation

class APIService {
    static let shared = APIService()
    
    // Configure this to match your backend URL
    private let baseURL = ProcessInfo.processInfo.environment["API_BASE_URL"] ?? "http://localhost:8080"
    let relyingPartyId = ProcessInfo.processInfo.environment["RELYING_PARTY_ID"] ?? "example.com"
    
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder
    
    private init() {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 60
        self.session = URLSession(configuration: configuration)
        
        self.decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        
        self.encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
    }
    
    // MARK: - Traditional Authentication
    
    func signIn(username: String, password: String) async throws -> AuthResponse {
        let request = SignInRequest(username: username, password: password)
        return try await post(endpoint: "/api/auth/signin", body: request)
    }
    
    func signUp(username: String, email: String, password: String, displayName: String) async throws -> AuthResponse {
        let request = SignUpRequest(
            username: username,
            email: email,
            password: password,
            displayName: displayName
        )
        return try await post(endpoint: "/api/auth/signup", body: request)
    }
    
    // MARK: - User Management
    
    func getCurrentUser() async throws -> User {
        return try await get(endpoint: "/api/user/me")
    }
    
    // MARK: - Passkey Registration
    
    func getPasskeyRegistrationOptions() async throws -> PasskeyRegistrationOptions {
        return try await post(endpoint: "/api/passkey/register/begin", body: EmptyBody())
    }
    
    func verifyPasskeyRegistration(
        credentialId: String,
        clientDataJSON: String,
        attestationObject: String
    ) async throws -> User {
        let request = PasskeyRegistrationVerification(
            credentialId: credentialId,
            clientDataJSON: clientDataJSON,
            attestationObject: attestationObject
        )
        return try await post(endpoint: "/api/passkey/register/finish", body: request)
    }
    
    // MARK: - Passkey Authentication
    
    func getPasskeyAuthenticationOptions() async throws -> PasskeyAuthenticationOptions {
        return try await post(endpoint: "/api/passkey/authenticate/begin", body: EmptyBody())
    }
    
    func verifyPasskeyAuthentication(
        credentialId: String,
        clientDataJSON: String,
        authenticatorData: String,
        signature: String,
        userHandle: String
    ) async throws -> AuthResponse {
        let request = PasskeyAuthenticationVerification(
            credentialId: credentialId,
            clientDataJSON: clientDataJSON,
            authenticatorData: authenticatorData,
            signature: signature,
            userHandle: userHandle
        )
        return try await post(endpoint: "/api/passkey/authenticate/finish", body: request)
    }
    
    // MARK: - HTTP Methods
    
    private func get<T: Decodable>(endpoint: String) async throws -> T {
        guard let url = URL(string: baseURL + endpoint) else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        // Add authorization token if available
        if let token = KeychainService.shared.getToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        
        guard (200...299).contains(httpResponse.statusCode) else {
            if let errorResponse = try? decoder.decode(ErrorResponse.self, from: data) {
                throw APIError.serverError(errorResponse.message)
            }
            throw APIError.httpError(httpResponse.statusCode)
        }
        
        return try decoder.decode(T.self, from: data)
    }
    
    private func post<T: Encodable, R: Decodable>(endpoint: String, body: T) async throws -> R {
        guard let url = URL(string: baseURL + endpoint) else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        // Add authorization token if available
        if let token = KeychainService.shared.getToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        
        request.httpBody = try encoder.encode(body)
        
        let (data, response) = try await session.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        
        guard (200...299).contains(httpResponse.statusCode) else {
            if let errorResponse = try? decoder.decode(ErrorResponse.self, from: data) {
                throw APIError.serverError(errorResponse.message)
            }
            throw APIError.httpError(httpResponse.statusCode)
        }
        
        return try decoder.decode(R.self, from: data)
    }
}

// MARK: - API Models

struct EmptyBody: Codable {}

struct SignInRequest: Codable {
    let username: String
    let password: String
}

struct SignUpRequest: Codable {
    let username: String
    let email: String
    let password: String
    let displayName: String
}

struct AuthResponse: Codable {
    let token: String
    let user: User
}

struct User: Codable, Identifiable {
    let id: String
    let username: String
    let email: String
    let displayName: String
    let hasPasskey: Bool
    let createdAt: String
}

struct PasskeyRegistrationOptions: Codable {
    let challenge: String
    let userId: String
    let timeout: Int?
}

struct PasskeyRegistrationVerification: Codable {
    let credentialId: String
    let clientDataJSON: String
    let attestationObject: String
}

struct PasskeyAuthenticationOptions: Codable {
    let challenge: String
    let allowCredentials: [String]
    let timeout: Int?
}

struct PasskeyAuthenticationVerification: Codable {
    let credentialId: String
    let clientDataJSON: String
    let authenticatorData: String
    let signature: String
    let userHandle: String
}

struct ErrorResponse: Codable {
    let message: String
}

// MARK: - API Errors

enum APIError: LocalizedError {
    case invalidURL
    case invalidResponse
    case httpError(Int)
    case serverError(String)
    case decodingError
    
    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .invalidResponse:
            return "Invalid response from server"
        case .httpError(let code):
            return "HTTP error: \(code)"
        case .serverError(let message):
            return message
        case .decodingError:
            return "Failed to decode response"
        }
    }
}
