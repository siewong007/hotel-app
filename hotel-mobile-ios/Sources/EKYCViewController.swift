import UIKit
import AVFoundation

/// eKYC verification view controller
class EKYCViewController: UIViewController {
    
    private let scrollView = UIScrollView()
    private let contentView = UIView()
    private let titleLabel = UILabel()
    private let instructionsLabel = UILabel()
    
    private let documentTypeSegment = UISegmentedControl(items: ["Passport", "National ID", "Driver License"])
    
    private let frontImageView = UIImageView()
    private let backImageView = UIImageView()
    private let selfieImageView = UIImageView()
    
    private let uploadFrontButton = UIButton(type: .system)
    private let uploadBackButton = UIButton(type: .system)
    private let uploadSelfieButton = UIButton(type: .system)
    private let submitButton = UIButton(type: .system)
    
    private let activityIndicator = UIActivityIndicatorView(style: .large)
    
    private var frontImageData: Data?
    private var backImageData: Data?
    private var selfieImageData: Data?
    
    private var currentImageTarget: ImageTarget = .front
    
    enum ImageTarget {
        case front, back, selfie
    }
    
    override func viewDidLoad() {
        super.viewDidLoad()
        
        setupUI()
        setupConstraints()
        checkCameraPermission()
    }
    
    private func setupUI() {
        view.backgroundColor = .systemBackground
        title = "Identity Verification"
        
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        contentView.translatesAutoresizingMaskIntoConstraints = false
        
        // Title
        titleLabel.text = "Verify Your Identity"
        titleLabel.font = .systemFont(ofSize: 24, weight: .bold)
        titleLabel.textAlignment = .center
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        
        // Instructions
        instructionsLabel.text = "Please upload clear photos of your identification document and a selfie to verify your identity. This is required for booking rooms."
        instructionsLabel.font = .systemFont(ofSize: 14)
        instructionsLabel.textColor = .secondaryLabel
        instructionsLabel.numberOfLines = 0
        instructionsLabel.textAlignment = .center
        instructionsLabel.translatesAutoresizingMaskIntoConstraints = false
        
        // Document Type Selector
        documentTypeSegment.selectedSegmentIndex = 0
        documentTypeSegment.translatesAutoresizingMaskIntoConstraints = false
        documentTypeSegment.addTarget(self, action: #selector(documentTypeChanged), for: .valueChanged)
        
        // Image Views
        setupImageView(frontImageView, placeholder: "doc.fill")
        setupImageView(backImageView, placeholder: "doc.fill")
        setupImageView(selfieImageView, placeholder: "person.crop.square.fill")
        
        // Upload Buttons
        setupButton(uploadFrontButton, title: "Upload Front", action: #selector(uploadFrontTapped))
        setupButton(uploadBackButton, title: "Upload Back", action: #selector(uploadBackTapped))
        setupButton(uploadSelfieButton, title: "Upload Selfie", action: #selector(uploadSelfieTapped))
        
        // Submit Button
        submitButton.setTitle("Submit for Verification", for: .normal)
        submitButton.titleLabel?.font = .systemFont(ofSize: 18, weight: .semibold)
        submitButton.backgroundColor = .systemBlue
        submitButton.setTitleColor(.white, for: .normal)
        submitButton.layer.cornerRadius = 12
        submitButton.isEnabled = false
        submitButton.alpha = 0.5
        submitButton.translatesAutoresizingMaskIntoConstraints = false
        submitButton.addTarget(self, action: #selector(submitTapped), for: .touchUpInside)
        
        // Activity Indicator
        activityIndicator.hidesWhenStopped = true
        activityIndicator.translatesAutoresizingMaskIntoConstraints = false
        
        // Add to view hierarchy
        view.addSubview(scrollView)
        scrollView.addSubview(contentView)
        
        contentView.addSubview(titleLabel)
        contentView.addSubview(instructionsLabel)
        contentView.addSubview(documentTypeSegment)
        contentView.addSubview(frontImageView)
        contentView.addSubview(uploadFrontButton)
        contentView.addSubview(backImageView)
        contentView.addSubview(uploadBackButton)
        contentView.addSubview(selfieImageView)
        contentView.addSubview(uploadSelfieButton)
        contentView.addSubview(submitButton)
        view.addSubview(activityIndicator)
    }
    
    private func setupImageView(_ imageView: UIImageView, placeholder: String) {
        imageView.contentMode = .scaleAspectFill
        imageView.clipsToBounds = true
        imageView.backgroundColor = .systemGray6
        imageView.layer.cornerRadius = 8
        imageView.layer.borderWidth = 2
        imageView.layer.borderColor = UIColor.systemGray4.cgColor
        imageView.image = UIImage(systemName: placeholder)
        imageView.tintColor = .systemGray3
        imageView.translatesAutoresizingMaskIntoConstraints = false
    }
    
    private func setupButton(_ button: UIButton, title: String, action: Selector) {
        button.setTitle(title, for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 16, weight: .medium)
        button.backgroundColor = .systemBlue
        button.setTitleColor(.white, for: .normal)
        button.layer.cornerRadius = 8
        button.translatesAutoresizingMaskIntoConstraints = false
        button.addTarget(self, action: action, for: .touchUpInside)
    }
    
    private func setupConstraints() {
        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            
            contentView.topAnchor.constraint(equalTo: scrollView.topAnchor),
            contentView.leadingAnchor.constraint(equalTo: scrollView.leadingAnchor),
            contentView.trailingAnchor.constraint(equalTo: scrollView.trailingAnchor),
            contentView.bottomAnchor.constraint(equalTo: scrollView.bottomAnchor),
            contentView.widthAnchor.constraint(equalTo: scrollView.widthAnchor),
            
            titleLabel.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 20),
            titleLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            titleLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            
            instructionsLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 12),
            instructionsLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            instructionsLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            
            documentTypeSegment.topAnchor.constraint(equalTo: instructionsLabel.bottomAnchor, constant: 24),
            documentTypeSegment.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            documentTypeSegment.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            
            frontImageView.topAnchor.constraint(equalTo: documentTypeSegment.bottomAnchor, constant: 24),
            frontImageView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            frontImageView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            frontImageView.heightAnchor.constraint(equalToConstant: 150),
            
            uploadFrontButton.topAnchor.constraint(equalTo: frontImageView.bottomAnchor, constant: 12),
            uploadFrontButton.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            uploadFrontButton.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            uploadFrontButton.heightAnchor.constraint(equalToConstant: 44),
            
            backImageView.topAnchor.constraint(equalTo: uploadFrontButton.bottomAnchor, constant: 24),
            backImageView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            backImageView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            backImageView.heightAnchor.constraint(equalToConstant: 150),
            
            uploadBackButton.topAnchor.constraint(equalTo: backImageView.bottomAnchor, constant: 12),
            uploadBackButton.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            uploadBackButton.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            uploadBackButton.heightAnchor.constraint(equalToConstant: 44),
            
            selfieImageView.topAnchor.constraint(equalTo: uploadBackButton.bottomAnchor, constant: 24),
            selfieImageView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            selfieImageView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            selfieImageView.heightAnchor.constraint(equalToConstant: 150),
            
            uploadSelfieButton.topAnchor.constraint(equalTo: selfieImageView.bottomAnchor, constant: 12),
            uploadSelfieButton.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            uploadSelfieButton.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            uploadSelfieButton.heightAnchor.constraint(equalToConstant: 44),
            
            submitButton.topAnchor.constraint(equalTo: uploadSelfieButton.bottomAnchor, constant: 32),
            submitButton.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            submitButton.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            submitButton.heightAnchor.constraint(equalToConstant: 50),
            submitButton.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -30),
            
            activityIndicator.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            activityIndicator.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
    }
    
    @objc private func documentTypeChanged() {
        // Reset images when document type changes
    }
    
    @objc private func uploadFrontTapped() {
        currentImageTarget = .front
        showImageSourceSelector()
    }
    
    @objc private func uploadBackTapped() {
        currentImageTarget = .back
        showImageSourceSelector()
    }
    
    @objc private func uploadSelfieTapped() {
        currentImageTarget = .selfie
        showImageSourceSelector()
    }
    
    @objc private func submitTapped() {
        guard let frontData = frontImageData,
              let selfieData = selfieImageData else {
            return
        }
        
        let documentType = getSelectedDocumentType()
        
        activityIndicator.startAnimating()
        submitButton.isEnabled = false
        
        Task {
            do {
                _ = try await AuthManager.shared.submitEKYC(
                    documentType: documentType,
                    frontImage: frontData,
                    backImage: backImageData,
                    selfieImage: selfieData
                )
                
                await MainActor.run {
                    activityIndicator.stopAnimating()
                    showSuccessAlert()
                }
            } catch {
                await MainActor.run {
                    activityIndicator.stopAnimating()
                    submitButton.isEnabled = true
                    showAlert(title: "Submission Failed", message: error.localizedDescription)
                }
            }
        }
    }
    
    private func getSelectedDocumentType() -> DocumentType {
        switch documentTypeSegment.selectedSegmentIndex {
        case 0: return .passport
        case 1: return .nationalId
        case 2: return .driverLicense
        default: return .passport
        }
    }
    
    private func checkCameraPermission() {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        if status == .notDetermined {
            AVCaptureDevice.requestAccess(for: .video) { _ in }
        }
    }
    
    private func showImageSourceSelector() {
        let alert = UIAlertController(title: "Select Source", message: nil, preferredStyle: .actionSheet)
        
        alert.addAction(UIAlertAction(title: "Camera", style: .default) { [weak self] _ in
            self?.openCamera()
        })
        
        alert.addAction(UIAlertAction(title: "Photo Library", style: .default) { [weak self] _ in
            self?.openPhotoLibrary()
        })
        
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        
        if let popoverController = alert.popoverPresentationController {
            popoverController.sourceView = view
            popoverController.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
            popoverController.permittedArrowDirections = []
        }
        
        present(alert, animated: true)
    }
    
    private func openCamera() {
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            showAlert(title: "Error", message: "Camera not available")
            return
        }
        
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = self
        picker.allowsEditing = true
        present(picker, animated: true)
    }
    
    private func openPhotoLibrary() {
        let picker = UIImagePickerController()
        picker.sourceType = .photoLibrary
        picker.delegate = self
        picker.allowsEditing = true
        present(picker, animated: true)
    }
    
    private func updateSubmitButton() {
        let isValid = frontImageData != nil && selfieImageData != nil
        submitButton.isEnabled = isValid
        submitButton.alpha = isValid ? 1.0 : 0.5
    }
    
    private func showSuccessAlert() {
        let alert = UIAlertController(
            title: "Verification Submitted",
            message: "Your identity verification has been submitted successfully. We'll review it and notify you once it's approved.",
            preferredStyle: .alert
        )
        
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in
            self?.navigationController?.popViewController(animated: true)
        })
        
        present(alert, animated: true)
    }
    
    private func showAlert(title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}

// MARK: - UIImagePickerControllerDelegate
extension EKYCViewController: UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey : Any]) {
        picker.dismiss(animated: true)
        
        guard let image = info[.editedImage] as? UIImage ?? info[.originalImage] as? UIImage else {
            return
        }
        
        // Compress image
        guard let imageData = image.jpegData(compressionQuality: 0.7) else {
            return
        }
        
        switch currentImageTarget {
        case .front:
            frontImageView.image = image
            frontImageData = imageData
            frontImageView.layer.borderColor = UIColor.systemGreen.cgColor
        case .back:
            backImageView.image = image
            backImageData = imageData
            backImageView.layer.borderColor = UIColor.systemGreen.cgColor
        case .selfie:
            selfieImageView.image = image
            selfieImageData = imageData
            selfieImageView.layer.borderColor = UIColor.systemGreen.cgColor
        }
        
        updateSubmitButton()
    }
    
    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
    }
}
