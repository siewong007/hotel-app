import SwiftUI

struct APIExplorerView: View {
    @EnvironmentObject var apiService: APIService
    @State private var selectedEndpoint = "https://api.github.com/users/apple"
    @State private var responseText = ""
    @State private var isLoading = false
    @State private var requestMethod: HTTPMethod = .get
    @State private var requestBody = ""
    @State private var showError = false
    @State private var errorMessage = ""
    
    enum HTTPMethod: String, CaseIterable {
        case get = "GET"
        case post = "POST"
        case put = "PUT"
        case delete = "DELETE"
        case patch = "PATCH"
    }
    
    var body: some View {
        NavigationStack {
            Form {
                Section("Endpoint") {
                    HStack {
                        Picker("Method", selection: $requestMethod) {
                            ForEach(HTTPMethod.allCases, id: \.self) { method in
                                Text(method.rawValue).tag(method)
                            }
                        }
                        .pickerStyle(.menu)
                        
                        TextField("URL", text: $selectedEndpoint)
                            .textContentType(.URL)
                            .keyboardType(.URL)
                            .autocapitalization(.none)
                    }
                }
                
                if requestMethod != .get {
                    Section("Request Body") {
                        TextEditor(text: $requestBody)
                            .frame(minHeight: 100)
                            .font(.system(.body, design: .monospaced))
                    }
                }
                
                Section {
                    Button(action: executeRequest) {
                        HStack {
                            if isLoading {
                                ProgressView()
                                    .padding(.trailing, 8)
                            }
                            Text("Send Request")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .disabled(isLoading || selectedEndpoint.isEmpty)
                }
                
                Section("Response") {
                    if responseText.isEmpty {
                        Text("No response yet")
                            .foregroundStyle(.secondary)
                            .italic()
                    } else {
                        ScrollView {
                            Text(responseText)
                                .font(.system(.caption, design: .monospaced))
                                .textSelection(.enabled)
                        }
                        .frame(maxHeight: 400)
                    }
                }
                
                Section("Quick Examples") {
                    Button("GitHub User API") {
                        selectedEndpoint = "https://api.github.com/users/apple"
                        requestMethod = .get
                    }
                    
                    Button("JSONPlaceholder Posts") {
                        selectedEndpoint = "https://jsonplaceholder.typicode.com/posts"
                        requestMethod = .get
                    }
                    
                    Button("Random User API") {
                        selectedEndpoint = "https://randomuser.me/api/"
                        requestMethod = .get
                    }
                }
                
                Section("Recent Requests") {
                    if apiService.requestHistory.isEmpty {
                        Text("No requests yet")
                            .foregroundStyle(.secondary)
                            .italic()
                    } else {
                        ForEach(apiService.requestHistory.prefix(5)) { request in
                            RequestHistoryRow(request: request)
                        }
                    }
                }
            }
            .navigationTitle("API Explorer")
            .alert("Error", isPresented: $showError) {
                Button("OK", role: .cancel) { }
            } message: {
                Text(errorMessage)
            }
        }
    }
    
    private func executeRequest() {
        Task {
            isLoading = true
            defer { isLoading = false }
            
            do {
                let data: Data
                
                switch requestMethod {
                case .get:
                    data = try await apiService.get(selectedEndpoint)
                case .post:
                    let bodyData = requestBody.data(using: .utf8) ?? Data()
                    data = try await apiService.post(selectedEndpoint, body: bodyData)
                case .put:
                    let bodyData = requestBody.data(using: .utf8) ?? Data()
                    data = try await apiService.put(selectedEndpoint, body: bodyData)
                case .delete:
                    data = try await apiService.delete(selectedEndpoint)
                case .patch:
                    let bodyData = requestBody.data(using: .utf8) ?? Data()
                    data = try await apiService.patch(selectedEndpoint, body: bodyData)
                }
                
                // Pretty print JSON
                if let json = try? JSONSerialization.jsonObject(with: data),
                   let prettyData = try? JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted, .sortedKeys]),
                   let prettyString = String(data: prettyData, encoding: .utf8) {
                    responseText = prettyString
                } else {
                    responseText = String(data: data, encoding: .utf8) ?? "Unable to decode response"
                }
            } catch {
                errorMessage = error.localizedDescription
                showError = true
                responseText = "Error: \(error.localizedDescription)"
            }
        }
    }
}

struct RequestHistoryRow: View {
    let request: APIRequest
    
    var statusColor: Color {
        switch request.statusCode {
        case 200...299: return .green
        case 300...399: return .blue
        case 400...499: return .orange
        case 500...599: return .red
        default: return .gray
        }
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(request.method)
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundColor(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(Color.blue)
                    .cornerRadius(4)
                
                Text("\(request.statusCode)")
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundColor(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(statusColor)
                    .cornerRadius(4)
                
                Spacer()
                
                Text(request.timestamp, style: .time)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            
            Text(request.url)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            
            Text("Size: \(ByteCountFormatter.string(fromByteCount: Int64(request.responseSize), countStyle: .file))")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
    }
}

#Preview {
    APIExplorerView()
        .environmentObject(APIService.shared)
}
