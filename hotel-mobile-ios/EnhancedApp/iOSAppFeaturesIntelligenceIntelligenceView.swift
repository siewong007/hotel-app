import SwiftUI

/// View showcasing Apple Intelligence capabilities
struct IntelligenceView: View {
    @EnvironmentObject var intelligenceManager: IntelligenceManager
    @State private var inputText = ""
    @State private var outputText = ""
    @State private var selectedFeature: IntelligenceFeature = .generate
    
    enum IntelligenceFeature: String, CaseIterable {
        case generate = "Generate"
        case summarize = "Summarize"
        case extract = "Extract Data"
        case creative = "Creative Writing"
        
        var icon: String {
            switch self {
            case .generate: return "wand.and.stars"
            case .summarize: return "doc.text.magnifyingglass"
            case .extract: return "square.grid.3x3.square"
            case .creative: return "paintbrush.fill"
            }
        }
    }
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Feature selector with Liquid Glass design
                    featureSelector
                    
                    // Input area
                    inputSection
                    
                    // Generate button
                    generateButton
                    
                    // Output area
                    if !outputText.isEmpty {
                        outputSection
                    }
                    
                    // Performance indicator
                    performanceIndicator
                }
                .padding()
            }
            .navigationTitle("Apple Intelligence")
            .background(Color(.systemGroupedBackground))
        }
    }
    
    private var featureSelector: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(IntelligenceFeature.allCases, id: \.self) { feature in
                    FeatureCard(
                        feature: feature,
                        isSelected: selectedFeature == feature
                    ) {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                            selectedFeature = feature
                        }
                    }
                }
            }
            .padding(.horizontal, 4)
        }
    }
    
    private var inputSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Input")
                .font(.headline)
                .foregroundStyle(.secondary)
            
            TextEditor(text: $inputText)
                .frame(minHeight: 120)
                .padding(12)
                .background(.ultraThinMaterial)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Color.accentColor.opacity(0.2), lineWidth: 1)
                )
        }
    }
    
    private var generateButton: some View {
        Button {
            Task {
                await processInput()
            }
        } label: {
            HStack {
                if intelligenceManager.isProcessing {
                    ProgressView()
                        .tint(.white)
                } else {
                    Image(systemName: selectedFeature.icon)
                }
                Text(selectedFeature.rawValue)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(
                LinearGradient(
                    colors: [.blue, .purple],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .shadow(color: .blue.opacity(0.3), radius: 8, y: 4)
        }
        .disabled(inputText.isEmpty || intelligenceManager.isProcessing)
    }
    
    private var outputSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Output")
                .font(.headline)
                .foregroundStyle(.secondary)
            
            Text(outputText)
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.ultraThinMaterial)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .contextMenu {
                    Button {
                        UIPasteboard.general.string = outputText
                    } label: {
                        Label("Copy", systemImage: "doc.on.doc")
                    }
                }
        }
        .transition(.opacity.combined(with: .scale))
    }
    
    private var performanceIndicator: some View {
        HStack {
            Image(systemName: "cpu.fill")
            Text("Optimized for A19 Pro Neural Engine")
                .font(.caption)
            Spacer()
            Image(systemName: "bolt.fill")
                .foregroundStyle(.yellow)
        }
        .foregroundStyle(.secondary)
        .padding()
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
    
    private func processInput() async {
        do {
            let result: String
            
            switch selectedFeature {
            case .generate:
                result = try await intelligenceManager.generateText(prompt: inputText)
            case .summarize:
                result = try await intelligenceManager.summarizeContent(inputText)
            case .extract:
                let data = try await intelligenceManager.extractStructuredData(
                    from: inputText,
                    schema: "{ name: string, date: string, category: string }"
                )
                result = data.description
            case .creative:
                result = try await intelligenceManager.generateText(
                    prompt: "Write a creative story based on: \(inputText)"
                )
            }
            
            withAnimation {
                outputText = result
            }
        } catch {
            outputText = "Error: \(error.localizedDescription)"
        }
    }
}

struct FeatureCard: View {
    let feature: IntelligenceView.IntelligenceFeature
    let isSelected: Bool
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: feature.icon)
                    .font(.title2)
                    .foregroundStyle(isSelected ? .white : .primary)
                
                Text(feature.rawValue)
                    .font(.caption)
                    .foregroundStyle(isSelected ? .white : .secondary)
            }
            .frame(width: 100, height: 80)
            .background(
                isSelected ?
                    AnyShapeStyle(.linearGradient(
                        colors: [.blue, .purple],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )) :
                    AnyShapeStyle(.ultraThinMaterial)
            )
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(isSelected ? Color.clear : Color.gray.opacity(0.2), lineWidth: 1)
            )
        }
    }
}

#Preview {
    IntelligenceView()
        .environmentObject(IntelligenceManager())
}
