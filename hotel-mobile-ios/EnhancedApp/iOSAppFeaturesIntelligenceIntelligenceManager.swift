import Foundation
import FoundationModels
import Observation

/// Manager for Apple Intelligence features using on-device LLM
@MainActor
@Observable
class IntelligenceManager {
    private var session: InferenceSession?
    var isProcessing = false
    var lastResponse: String = ""
    var error: Error?
    
    // Performance configuration for A19 Pro
    private var performanceConfig: PerformanceConfiguration = .pro
    
    enum PerformanceConfiguration {
        case standard
        case pro
        
        var maxTokens: Int {
            switch self {
            case .standard: return 1024
            case .pro: return 4096 // Utilize A19 Pro's enhanced Neural Engine
            }
        }
        
        var temperature: Double {
            switch self {
            case .standard: return 0.7
            case .pro: return 0.8
            }
        }
    }
    
    init() {
        setupInferenceSession()
    }
    
    /// Configure inference for Pro device performance
    func configureForProPerformance() {
        performanceConfig = .pro
        setupInferenceSession()
    }
    
    private func setupInferenceSession() {
        do {
            // Initialize on-device LLM session
            session = try InferenceSession(
                configuration: .init(
                    maxTokens: performanceConfig.maxTokens,
                    temperature: performanceConfig.temperature
                )
            )
        } catch {
            self.error = error
            print("Failed to initialize inference session: \(error)")
        }
    }
    
    /// Generate text using on-device Apple Intelligence
    func generateText(prompt: String) async throws -> String {
        guard let session = session else {
            throw IntelligenceError.sessionNotInitialized
        }
        
        isProcessing = true
        defer { isProcessing = false }
        
        do {
            let request = InferenceRequest(prompt: prompt)
            let response = try await session.perform(request)
            lastResponse = response.text
            return response.text
        } catch {
            self.error = error
            throw error
        }
    }
    
    /// Summarize content using Apple Intelligence
    func summarizeContent(_ content: String) async throws -> String {
        let prompt = """
        Summarize the following content concisely:
        
        \(content)
        """
        return try await generateText(prompt: prompt)
    }
    
    /// Extract structured data from text
    func extractStructuredData(from text: String, schema: String) async throws -> [String: Any] {
        let prompt = """
        Extract structured data from the text according to this schema:
        Schema: \(schema)
        
        Text: \(text)
        
        Return valid JSON.
        """
        
        let response = try await generateText(prompt: prompt)
        
        guard let data = response.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw IntelligenceError.invalidResponse
        }
        
        return json
    }
    
    /// Generate creative content with custom tools
    func generateWithTools(
        prompt: String,
        tools: [InferenceTool]
    ) async throws -> String {
        guard let session = session else {
            throw IntelligenceError.sessionNotInitialized
        }
        
        isProcessing = true
        defer { isProcessing = false }
        
        let request = InferenceRequest(
            prompt: prompt,
            tools: tools
        )
        
        let response = try await session.perform(request)
        lastResponse = response.text
        return response.text
    }
}

enum IntelligenceError: LocalizedError {
    case sessionNotInitialized
    case invalidResponse
    case processingFailed
    
    var errorDescription: String? {
        switch self {
        case .sessionNotInitialized:
            return "Intelligence session not initialized"
        case .invalidResponse:
            return "Invalid response from model"
        case .processingFailed:
            return "Processing failed"
        }
    }
}
