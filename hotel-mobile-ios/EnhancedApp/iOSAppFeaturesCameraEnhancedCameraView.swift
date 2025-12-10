import SwiftUI
import AVFoundation
import Vision
import VisualIntelligence

/// Enhanced camera view leveraging iPhone 17 Pro camera system
struct EnhancedCameraView: View {
    @StateObject private var cameraManager = ProCameraManager()
    @StateObject private var visualIntelligence = VisualIntelligenceManager()
    @State private var showingSettings = false
    
    var body: some View {
        NavigationStack {
            ZStack {
                // Camera preview
                CameraPreviewView(session: cameraManager.captureSession)
                    .ignoresSafeArea()
                
                // Camera controls overlay
                VStack {
                    Spacer()
                    
                    cameraControls
                        .padding()
                        .background(.ultraThinMaterial)
                        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                        .padding()
                }
                
                // Visual intelligence results
                if !visualIntelligence.detectedObjects.isEmpty {
                    VStack {
                        visualIntelligenceOverlay
                        Spacer()
                    }
                }
            }
            .navigationTitle("Pro Camera")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showingSettings.toggle()
                    } label: {
                        Image(systemName: "gear")
                    }
                }
            }
            .sheet(isPresented: $showingSettings) {
                CameraSettingsView(manager: cameraManager)
            }
            .task {
                await cameraManager.checkPermissionsAndStart()
            }
        }
    }
    
    private var cameraControls: some View {
        VStack(spacing: 20) {
            // Camera modes
            HStack(spacing: 16) {
                ForEach(ProCameraManager.CameraMode.allCases, id: \.self) { mode in
                    CameraModeButton(
                        mode: mode,
                        isSelected: cameraManager.currentMode == mode
                    ) {
                        cameraManager.switchMode(to: mode)
                    }
                }
            }
            
            // Capture button with Visual Intelligence
            HStack(spacing: 32) {
                // Toggle lens
                Button {
                    cameraManager.switchCamera()
                } label: {
                    Image(systemName: "arrow.triangle.2.circlepath.camera")
                        .font(.title2)
                        .foregroundStyle(.white)
                        .padding()
                        .background(.ultraThinMaterial)
                        .clipShape(Circle())
                }
                
                // Capture button
                Button {
                    Task {
                        await captureWithIntelligence()
                    }
                } label: {
                    Circle()
                        .fill(.white)
                        .frame(width: 70, height: 70)
                        .overlay(
                            Circle()
                                .stroke(.white, lineWidth: 3)
                                .padding(4)
                        )
                }
                
                // Visual Intelligence toggle
                Button {
                    visualIntelligence.isEnabled.toggle()
                } label: {
                    Image(systemName: visualIntelligence.isEnabled ? "eye.fill" : "eye.slash")
                        .font(.title2)
                        .foregroundStyle(visualIntelligence.isEnabled ? .blue : .white)
                        .padding()
                        .background(.ultraThinMaterial)
                        .clipShape(Circle())
                }
            }
        }
    }
    
    private var visualIntelligenceOverlay: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(visualIntelligence.detectedObjects) { object in
                    DetectedObjectCard(object: object)
                }
            }
            .padding()
        }
        .background(.ultraThinMaterial)
    }
    
    private func captureWithIntelligence() async {
        guard let image = await cameraManager.capturePhoto() else { return }
        
        if visualIntelligence.isEnabled {
            await visualIntelligence.analyzeImage(image)
        }
    }
}

// MARK: - Camera Manager

@MainActor
class ProCameraManager: ObservableObject {
    let captureSession = AVCaptureSession()
    @Published var currentMode: CameraMode = .photo
    @Published var currentCamera: CameraPosition = .back
    @Published var isSessionRunning = false
    
    // Pro camera features
    @Published var enableProRAW = false
    @Published var enableProRes = false
    @Published var enableMacroMode = false
    @Published var currentZoom: CGFloat = 1.0
    
    enum CameraMode: String, CaseIterable {
        case photo = "Photo"
        case video = "Video"
        case cinematic = "Cinematic"
        case macro = "Macro"
        case night = "Night"
        
        var icon: String {
            switch self {
            case .photo: return "camera"
            case .video: return "video"
            case .cinematic: return "film"
            case .macro: return "camera.macro"
            case .night: return "moon.stars"
            }
        }
    }
    
    enum CameraPosition {
        case front
        case back
        case ultraWide
        case telephoto
    }
    
    func checkPermissionsAndStart() async {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            await setupAndStartSession()
        case .notDetermined:
            if await AVCaptureDevice.requestAccess(for: .video) {
                await setupAndStartSession()
            }
        default:
            break
        }
    }
    
    private func setupAndStartSession() async {
        guard !isSessionRunning else { return }
        
        captureSession.sessionPreset = .photo
        
        // Configure for Pro camera system
        if let device = bestCameraDevice() {
            do {
                let input = try AVCaptureDeviceInput(device: device)
                if captureSession.canAddInput(input) {
                    captureSession.addInput(input)
                }
                
                // Configure device for Pro features
                try device.lockForConfiguration()
                
                // Enable max resolution
                if device.activeFormat.isHighestPhotoQualitySupported {
                    device.activeFormat.isHighestPhotoQualitySupported
                }
                
                device.unlockForConfiguration()
            } catch {
                print("Failed to configure camera: \(error)")
            }
        }
        
        captureSession.startRunning()
        isSessionRunning = true
    }
    
    private func bestCameraDevice() -> AVCaptureDevice? {
        // Prefer triple camera system on Pro models
        if let device = AVCaptureDevice.default(.builtInTripleCamera, for: .video, position: .back) {
            return device
        }
        
        // Fallback to wide angle
        return AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
    }
    
    func switchMode(to mode: CameraMode) {
        currentMode = mode
        
        // Configure session based on mode
        switch mode {
        case .macro:
            enableMacroMode = true
        case .cinematic:
            captureSession.sessionPreset = .high
        case .video:
            captureSession.sessionPreset = .high
        default:
            enableMacroMode = false
            captureSession.sessionPreset = .photo
        }
    }
    
    func switchCamera() {
        // Cycle through available cameras
        switch currentCamera {
        case .back:
            currentCamera = .ultraWide
        case .ultraWide:
            currentCamera = .telephoto
        case .telephoto:
            currentCamera = .front
        case .front:
            currentCamera = .back
        }
    }
    
    func capturePhoto() async -> UIImage? {
        // Implement photo capture
        // This is a placeholder - full implementation would use AVCapturePhotoOutput
        return nil
    }
}

// MARK: - Visual Intelligence Manager

@MainActor
class VisualIntelligenceManager: ObservableObject {
    @Published var isEnabled = true
    @Published var detectedObjects: [DetectedObject] = []
    @Published var isProcessing = false
    
    struct DetectedObject: Identifiable {
        let id = UUID()
        let label: String
        let confidence: Float
        let boundingBox: CGRect
        let category: String
    }
    
    func analyzeImage(_ image: UIImage) async {
        isProcessing = true
        defer { isProcessing = false }
        
        guard let cgImage = image.cgImage else { return }
        
        // Use Vision framework for object detection
        let request = VNRecognizeAnimalsRequest()
        request.revision = VNRecognizeAnimalsRequestRevision2
        
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        
        do {
            try handler.perform([request])
            
            if let results = request.results {
                detectedObjects = results.compactMap { observation in
                    guard let label = observation.labels.first else { return nil }
                    return DetectedObject(
                        label: label.identifier,
                        confidence: label.confidence,
                        boundingBox: observation.boundingBox,
                        category: "Animal"
                    )
                }
            }
        } catch {
            print("Failed to analyze image: \(error)")
        }
    }
}

// MARK: - Supporting Views

struct CameraPreviewView: UIViewRepresentable {
    let session: AVCaptureSession
    
    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        
        let previewLayer = AVCaptureVideoPreviewLayer(session: session)
        previewLayer.videoGravity = .resizeAspectFill
        view.layer.addSublayer(previewLayer)
        
        return view
    }
    
    func updateUIView(_ uiView: UIView, context: Context) {
        if let previewLayer = uiView.layer.sublayers?.first as? AVCaptureVideoPreviewLayer {
            previewLayer.frame = uiView.bounds
        }
    }
}

struct CameraModeButton: View {
    let mode: ProCameraManager.CameraMode
    let isSelected: Bool
    let action: () -> Void
    
    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: mode.icon)
                    .font(.title3)
                Text(mode.rawValue)
                    .font(.caption2)
            }
            .foregroundStyle(isSelected ? .blue : .white)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(isSelected ? Color.white.opacity(0.2) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
    }
}

struct DetectedObjectCard: View {
    let object: VisualIntelligenceManager.DetectedObject
    
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(object.label)
                .font(.headline)
            Text("\(Int(object.confidence * 100))% confidence")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding()
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

struct CameraSettingsView: View {
    @ObservedObject var manager: ProCameraManager
    @Environment(\.dismiss) var dismiss
    
    var body: some View {
        NavigationStack {
            Form {
                Section("Pro Features") {
                    Toggle("ProRAW", isOn: $manager.enableProRAW)
                    Toggle("ProRes Video", isOn: $manager.enableProRes)
                    Toggle("Macro Mode", isOn: $manager.enableMacroMode)
                }
                
                Section("Zoom") {
                    HStack {
                        Text("1x")
                        Slider(value: $manager.currentZoom, in: 1...5)
                        Text("5x")
                    }
                }
            }
            .navigationTitle("Camera Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }
}

#Preview {
    EnhancedCameraView()
}
