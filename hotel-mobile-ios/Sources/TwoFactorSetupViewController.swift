import UIKit

/// View controller for setting up two-factor authentication
class TwoFactorSetupViewController: UIViewController {
    
    private let setup: TwoFactorSetup
    
    private let scrollView = UIScrollView()
    private let contentView = UIView()
    
    private let titleLabel = UILabel()
    private let instructionsLabel = UILabel()
    private let qrImageView = UIImageView()
    private let secretLabel = UILabel()
    private let secretValueLabel = UILabel()
    private let codeTextField = UITextField()
    private let verifyButton = UIButton(type: .system)
    private let backupCodesLabel = UILabel()
    private let backupCodesTextView = UITextView()
    private let activityIndicator = UIActivityIndicatorView(style: .medium)
    
    init(setup: TwoFactorSetup) {
        self.setup = setup
        super.init(nibName: nil, bundle: nil)
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    override func viewDidLoad() {
        super.viewDidLoad()
        
        setupUI()
        setupConstraints()
        loadQRCode()
    }
    
    private func setupUI() {
        view.backgroundColor = .systemBackground
        title = "Setup 2FA"
        
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        contentView.translatesAutoresizingMaskIntoConstraints = false
        
        // Title
        titleLabel.text = "Enable Two-Factor Authentication"
        titleLabel.font = .systemFont(ofSize: 24, weight: .bold)
        titleLabel.textAlignment = .center
        titleLabel.numberOfLines = 0
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        
        // Instructions
        instructionsLabel.text = "Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.) or manually enter the secret key below."
        instructionsLabel.font = .systemFont(ofSize: 14)
        instructionsLabel.textColor = .secondaryLabel
        instructionsLabel.numberOfLines = 0
        instructionsLabel.textAlignment = .center
        instructionsLabel.translatesAutoresizingMaskIntoConstraints = false
        
        // QR Code
        qrImageView.contentMode = .scaleAspectFit
        qrImageView.backgroundColor = .white
        qrImageView.layer.cornerRadius = 12
        qrImageView.layer.borderWidth = 1
        qrImageView.layer.borderColor = UIColor.systemGray4.cgColor
        qrImageView.translatesAutoresizingMaskIntoConstraints = false
        
        // Secret Label
        secretLabel.text = "Secret Key:"
        secretLabel.font = .systemFont(ofSize: 14, weight: .semibold)
        secretLabel.translatesAutoresizingMaskIntoConstraints = false
        
        secretValueLabel.text = setup.secret
        secretValueLabel.font = .systemFont(ofSize: 12, weight: .medium)
        secretValueLabel.textColor = .systemBlue
        secretValueLabel.numberOfLines = 0
        secretValueLabel.textAlignment = .center
        secretValueLabel.isUserInteractionEnabled = true
        secretValueLabel.translatesAutoresizingMaskIntoConstraints = false
        
        let tapGesture = UITapGestureRecognizer(target: self, action: #selector(copySecret))
        secretValueLabel.addGestureRecognizer(tapGesture)
        
        // Code TextField
        codeTextField.placeholder = "Enter 6-digit code"
        codeTextField.borderStyle = .roundedRect
        codeTextField.keyboardType = .numberPad
        codeTextField.textAlignment = .center
        codeTextField.font = .systemFont(ofSize: 18, weight: .medium)
        codeTextField.translatesAutoresizingMaskIntoConstraints = false
        
        // Verify Button
        verifyButton.setTitle("Verify and Enable", for: .normal)
        verifyButton.titleLabel?.font = .systemFont(ofSize: 18, weight: .semibold)
        verifyButton.backgroundColor = .systemBlue
        verifyButton.setTitleColor(.white, for: .normal)
        verifyButton.layer.cornerRadius = 12
        verifyButton.translatesAutoresizingMaskIntoConstraints = false
        verifyButton.addTarget(self, action: #selector(verifyTapped), for: .touchUpInside)
        
        // Backup Codes
        backupCodesLabel.text = "Backup Codes (Save these in a safe place):"
        backupCodesLabel.font = .systemFont(ofSize: 14, weight: .semibold)
        backupCodesLabel.numberOfLines = 0
        backupCodesLabel.translatesAutoresizingMaskIntoConstraints = false
        
        backupCodesTextView.text = setup.backupCodes.joined(separator: "\n")
        backupCodesTextView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        backupCodesTextView.backgroundColor = .systemGray6
        backupCodesTextView.layer.cornerRadius = 8
        backupCodesTextView.isEditable = false
        backupCodesTextView.textContainerInset = UIEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)
        backupCodesTextView.translatesAutoresizingMaskIntoConstraints = false
        
        // Activity Indicator
        activityIndicator.hidesWhenStopped = true
        activityIndicator.translatesAutoresizingMaskIntoConstraints = false
        
        // Add to view hierarchy
        view.addSubview(scrollView)
        scrollView.addSubview(contentView)
        
        contentView.addSubview(titleLabel)
        contentView.addSubview(instructionsLabel)
        contentView.addSubview(qrImageView)
        contentView.addSubview(secretLabel)
        contentView.addSubview(secretValueLabel)
        contentView.addSubview(codeTextField)
        contentView.addSubview(verifyButton)
        contentView.addSubview(backupCodesLabel)
        contentView.addSubview(backupCodesTextView)
        contentView.addSubview(activityIndicator)
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
            
            qrImageView.topAnchor.constraint(equalTo: instructionsLabel.bottomAnchor, constant: 24),
            qrImageView.centerXAnchor.constraint(equalTo: contentView.centerXAnchor),
            qrImageView.widthAnchor.constraint(equalToConstant: 200),
            qrImageView.heightAnchor.constraint(equalToConstant: 200),
            
            secretLabel.topAnchor.constraint(equalTo: qrImageView.bottomAnchor, constant: 20),
            secretLabel.centerXAnchor.constraint(equalTo: contentView.centerXAnchor),
            
            secretValueLabel.topAnchor.constraint(equalTo: secretLabel.bottomAnchor, constant: 8),
            secretValueLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            secretValueLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            
            codeTextField.topAnchor.constraint(equalTo: secretValueLabel.bottomAnchor, constant: 24),
            codeTextField.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 40),
            codeTextField.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -40),
            codeTextField.heightAnchor.constraint(equalToConstant: 50),
            
            verifyButton.topAnchor.constraint(equalTo: codeTextField.bottomAnchor, constant: 16),
            verifyButton.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 40),
            verifyButton.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -40),
            verifyButton.heightAnchor.constraint(equalToConstant: 50),
            
            backupCodesLabel.topAnchor.constraint(equalTo: verifyButton.bottomAnchor, constant: 32),
            backupCodesLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            backupCodesLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            
            backupCodesTextView.topAnchor.constraint(equalTo: backupCodesLabel.bottomAnchor, constant: 12),
            backupCodesTextView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            backupCodesTextView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            backupCodesTextView.heightAnchor.constraint(equalToConstant: 120),
            backupCodesTextView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -30),
            
            activityIndicator.centerXAnchor.constraint(equalTo: verifyButton.centerXAnchor),
            activityIndicator.centerYAnchor.constraint(equalTo: verifyButton.centerYAnchor)
        ])
    }
    
    private func loadQRCode() {
        guard let url = URL(string: setup.qrCodeURL) else { return }
        
        Task {
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                if let image = UIImage(data: data) {
                    await MainActor.run {
                        qrImageView.image = image
                    }
                }
            } catch {
                // Could also generate QR code locally
                print("Failed to load QR code: \(error)")
            }
        }
    }
    
    @objc private func copySecret() {
        UIPasteboard.general.string = setup.secret
        
        let alert = UIAlertController(title: "Copied", message: "Secret key copied to clipboard", preferredStyle: .alert)
        present(alert, animated: true)
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            alert.dismiss(animated: true)
        }
    }
    
    @objc private func verifyTapped() {
        guard let code = codeTextField.text, code.count == 6 else {
            showAlert(title: "Invalid Code", message: "Please enter a 6-digit code")
            return
        }
        
        activityIndicator.startAnimating()
        verifyButton.isEnabled = false
        
        Task {
            do {
                let verified = try await AuthManager.shared.verify2FA(code: code)
                
                await MainActor.run {
                    activityIndicator.stopAnimating()
                    verifyButton.isEnabled = true
                    
                    if verified {
                        showSuccessAlert()
                    } else {
                        showAlert(title: "Verification Failed", message: "Invalid code. Please try again.")
                    }
                }
            } catch {
                await MainActor.run {
                    activityIndicator.stopAnimating()
                    verifyButton.isEnabled = true
                    showAlert(title: "Error", message: error.localizedDescription)
                }
            }
        }
    }
    
    private func showSuccessAlert() {
        let alert = UIAlertController(
            title: "2FA Enabled",
            message: "Two-factor authentication has been successfully enabled for your account.",
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
