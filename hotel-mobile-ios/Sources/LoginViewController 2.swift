import UIKit
import AuthenticationServices

/// Login view controller with support for email/password, passkey, and 2FA
class LoginViewController: UIViewController {
    
    private let scrollView = UIScrollView()
    private let contentView = UIView()
    
    private let logoImageView = UIImageView()
    private let titleLabel = UILabel()
    private let emailTextField = UITextField()
    private let passwordTextField = UITextField()
    private let loginButton = UIButton(type: .system)
    private let passkeyButton = UIButton(type: .system)
    private let registerButton = UIButton(type: .system)
    private let activityIndicator = UIActivityIndicatorView(style: .medium)
    
    private var twoFactorAlertController: UIAlertController?
    
    override func viewDidLoad() {
        super.viewDidLoad()
        
        setupUI()
        setupConstraints()
        setupKeyboardHandling()
    }
    
    private func setupUI() {
        view.backgroundColor = .systemBackground
        title = "Welcome"
        
        // Logo
        logoImageView.image = UIImage(systemName: "building.2.fill")
        logoImageView.tintColor = .systemBlue
        logoImageView.contentMode = .scaleAspectFit
        logoImageView.translatesAutoresizingMaskIntoConstraints = false
        
        // Title
        titleLabel.text = "Hotel Booking"
        titleLabel.font = .systemFont(ofSize: 32, weight: .bold)
        titleLabel.textAlignment = .center
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        
        // Email TextField
        emailTextField.placeholder = "Email"
        emailTextField.borderStyle = .roundedRect
        emailTextField.keyboardType = .emailAddress
        emailTextField.autocapitalizationType = .none
        emailTextField.autocorrectionType = .no
        emailTextField.translatesAutoresizingMaskIntoConstraints = false
        
        // Password TextField
        passwordTextField.placeholder = "Password"
        passwordTextField.borderStyle = .roundedRect
        passwordTextField.isSecureTextEntry = true
        passwordTextField.translatesAutoresizingMaskIntoConstraints = false
        
        // Login Button
        loginButton.setTitle("Login", for: .normal)
        loginButton.titleLabel?.font = .systemFont(ofSize: 18, weight: .semibold)
        loginButton.backgroundColor = .systemBlue
        loginButton.setTitleColor(.white, for: .normal)
        loginButton.layer.cornerRadius = 12
        loginButton.translatesAutoresizingMaskIntoConstraints = false
        loginButton.addTarget(self, action: #selector(loginTapped), for: .touchUpInside)
        
        // Passkey Button
        if #available(iOS 16.0, *) {
            passkeyButton.setTitle("Sign in with Passkey", for: .normal)
            passkeyButton.titleLabel?.font = .systemFont(ofSize: 16, weight: .medium)
            passkeyButton.setTitleColor(.systemBlue, for: .normal)
            passkeyButton.translatesAutoresizingMaskIntoConstraints = false
            passkeyButton.addTarget(self, action: #selector(passkeyTapped), for: .touchUpInside)
        }
        
        // Register Button
        registerButton.setTitle("Don't have an account? Register", for: .normal)
        registerButton.titleLabel?.font = .systemFont(ofSize: 14)
        registerButton.translatesAutoresizingMaskIntoConstraints = false
        registerButton.addTarget(self, action: #selector(registerTapped), for: .touchUpInside)
        
        // Activity Indicator
        activityIndicator.hidesWhenStopped = true
        activityIndicator.translatesAutoresizingMaskIntoConstraints = false
        
        // Add to view hierarchy
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        contentView.translatesAutoresizingMaskIntoConstraints = false
        
        view.addSubview(scrollView)
        scrollView.addSubview(contentView)
        
        contentView.addSubview(logoImageView)
        contentView.addSubview(titleLabel)
        contentView.addSubview(emailTextField)
        contentView.addSubview(passwordTextField)
        contentView.addSubview(loginButton)
        if #available(iOS 16.0, *) {
            contentView.addSubview(passkeyButton)
        }
        contentView.addSubview(registerButton)
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
            
            logoImageView.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 60),
            logoImageView.centerXAnchor.constraint(equalTo: contentView.centerXAnchor),
            logoImageView.widthAnchor.constraint(equalToConstant: 80),
            logoImageView.heightAnchor.constraint(equalToConstant: 80),
            
            titleLabel.topAnchor.constraint(equalTo: logoImageView.bottomAnchor, constant: 20),
            titleLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 40),
            titleLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -40),
            
            emailTextField.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 40),
            emailTextField.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 40),
            emailTextField.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -40),
            emailTextField.heightAnchor.constraint(equalToConstant: 50),
            
            passwordTextField.topAnchor.constraint(equalTo: emailTextField.bottomAnchor, constant: 16),
            passwordTextField.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 40),
            passwordTextField.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -40),
            passwordTextField.heightAnchor.constraint(equalToConstant: 50),
            
            loginButton.topAnchor.constraint(equalTo: passwordTextField.bottomAnchor, constant: 24),
            loginButton.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 40),
            loginButton.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -40),
            loginButton.heightAnchor.constraint(equalToConstant: 50),
            
            activityIndicator.centerXAnchor.constraint(equalTo: loginButton.centerXAnchor),
            activityIndicator.centerYAnchor.constraint(equalTo: loginButton.centerYAnchor)
        ])
        
        if #available(iOS 16.0, *) {
            NSLayoutConstraint.activate([
                passkeyButton.topAnchor.constraint(equalTo: loginButton.bottomAnchor, constant: 16),
                passkeyButton.centerXAnchor.constraint(equalTo: contentView.centerXAnchor),
                
                registerButton.topAnchor.constraint(equalTo: passkeyButton.bottomAnchor, constant: 24),
                registerButton.centerXAnchor.constraint(equalTo: contentView.centerXAnchor),
                registerButton.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -40)
            ])
        } else {
            NSLayoutConstraint.activate([
                registerButton.topAnchor.constraint(equalTo: loginButton.bottomAnchor, constant: 24),
                registerButton.centerXAnchor.constraint(equalTo: contentView.centerXAnchor),
                registerButton.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -40)
            ])
        }
    }
    
    private func setupKeyboardHandling() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardWillShow),
            name: UIResponder.keyboardWillShowNotification,
            object: nil
        )
        
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardWillHide),
            name: UIResponder.keyboardWillHideNotification,
            object: nil
        )
        
        let tapGesture = UITapGestureRecognizer(target: self, action: #selector(dismissKeyboard))
        view.addGestureRecognizer(tapGesture)
    }
    
    @objc private func loginTapped() {
        guard let email = emailTextField.text, !email.isEmpty,
              let password = passwordTextField.text, !password.isEmpty else {
            showAlert(title: "Error", message: "Please enter email and password")
            return
        }
        
        setLoading(true)
        
        Task {
            do {
                let user = try await AuthManager.shared.login(email: email, password: password)
                
                // Check if 2FA is enabled
                if user.twoFactorEnabled {
                    await MainActor.run {
                        setLoading(false)
                        show2FAPrompt()
                    }
                } else {
                    // Login successful, navigate to main app
                    await MainActor.run {
                        setLoading(false)
                        // The SceneDelegate will handle navigation via notification
                    }
                }
            } catch {
                await MainActor.run {
                    setLoading(false)
                    showAlert(title: "Login Failed", message: error.localizedDescription)
                }
            }
        }
    }
    
    @objc private func passkeyTapped() {
        guard #available(iOS 16.0, *) else { return }
        
        Task {
            do {
                _ = try await AuthManager.shared.loginWithPasskey()
                // Login will be handled by passkey flow
            } catch {
                await MainActor.run {
                    showAlert(title: "Passkey Login Failed", message: error.localizedDescription)
                }
            }
        }
    }
    
    @objc private func registerTapped() {
        let registerVC = RegisterViewController()
        navigationController?.pushViewController(registerVC, animated: true)
    }
    
    private func show2FAPrompt() {
        let alert = UIAlertController(
            title: "Two-Factor Authentication",
            message: "Enter the 6-digit code from your authenticator app",
            preferredStyle: .alert
        )
        
        alert.addTextField { textField in
            textField.placeholder = "000000"
            textField.keyboardType = .numberPad
            textField.textAlignment = .center
        }
        
        let verifyAction = UIAlertAction(title: "Verify", style: .default) { [weak self] _ in
            guard let code = alert.textFields?.first?.text else { return }
            self?.verify2FACode(code)
        }
        
        let cancelAction = UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in
            self?.logout()
        }
        
        alert.addAction(verifyAction)
        alert.addAction(cancelAction)
        
        present(alert, animated: true)
        twoFactorAlertController = alert
    }
    
    private func verify2FACode(_ code: String) {
        Task {
            do {
                let verified = try await AuthManager.shared.verify2FA(code: code)
                
                await MainActor.run {
                    if verified {
                        // 2FA successful, proceed to main app
                        // Navigation handled by SceneDelegate
                    } else {
                        showAlert(title: "Verification Failed", message: "Invalid code. Please try again.")
                        show2FAPrompt()
                    }
                }
            } catch {
                await MainActor.run {
                    showAlert(title: "Error", message: error.localizedDescription)
                }
            }
        }
    }
    
    private func logout() {
        AuthManager.shared.logout()
    }
    
    private func setLoading(_ loading: Bool) {
        loginButton.isEnabled = !loading
        emailTextField.isEnabled = !loading
        passwordTextField.isEnabled = !loading
        passkeyButton.isEnabled = !loading
        registerButton.isEnabled = !loading
        
        if loading {
            activityIndicator.startAnimating()
            loginButton.setTitle("", for: .normal)
        } else {
            activityIndicator.stopAnimating()
            loginButton.setTitle("Login", for: .normal)
        }
    }
    
    private func showAlert(title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
    
    @objc private func keyboardWillShow(notification: NSNotification) {
        guard let keyboardFrame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else {
            return
        }
        
        let contentInsets = UIEdgeInsets(top: 0, left: 0, bottom: keyboardFrame.height, right: 0)
        scrollView.contentInset = contentInsets
        scrollView.scrollIndicatorInsets = contentInsets
    }
    
    @objc private func keyboardWillHide(notification: NSNotification) {
        scrollView.contentInset = .zero
        scrollView.scrollIndicatorInsets = .zero
    }
    
    @objc private func dismissKeyboard() {
        view.endEditing(true)
    }
    
    deinit {
        NotificationCenter.default.removeObserver(self)
    }
}
