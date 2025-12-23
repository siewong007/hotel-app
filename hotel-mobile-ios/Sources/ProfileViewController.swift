import UIKit

/// Profile view controller with security settings
class ProfileViewController: UIViewController {
    
    private let scrollView = UIScrollView()
    private let contentView = UIView()
    
    private let profileHeaderView = UIView()
    private let profileImageView = UIImageView()
    private let nameLabel = UILabel()
    private let emailLabel = UILabel()
    
    private let sectionsStackView = UIStackView()
    
    override func viewDidLoad() {
        super.viewDidLoad()
        
        setupUI()
        setupConstraints()
        configureProfile()
    }
    
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        updateSecurityStatus()
    }
    
    private func setupUI() {
        view.backgroundColor = .systemBackground
        title = "Profile"
        
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        contentView.translatesAutoresizingMaskIntoConstraints = false
        
        // Profile Header
        profileHeaderView.backgroundColor = .systemGroupedBackground
        profileHeaderView.layer.cornerRadius = 12
        profileHeaderView.translatesAutoresizingMaskIntoConstraints = false
        
        profileImageView.image = UIImage(systemName: "person.circle.fill")
        profileImageView.tintColor = .systemBlue
        profileImageView.contentMode = .scaleAspectFit
        profileImageView.translatesAutoresizingMaskIntoConstraints = false
        
        nameLabel.font = .systemFont(ofSize: 24, weight: .bold)
        nameLabel.textAlignment = .center
        nameLabel.translatesAutoresizingMaskIntoConstraints = false
        
        emailLabel.font = .systemFont(ofSize: 16)
        emailLabel.textColor = .secondaryLabel
        emailLabel.textAlignment = .center
        emailLabel.translatesAutoresizingMaskIntoConstraints = false
        
        profileHeaderView.addSubview(profileImageView)
        profileHeaderView.addSubview(nameLabel)
        profileHeaderView.addSubview(emailLabel)
        
        // Sections Stack View
        sectionsStackView.axis = .vertical
        sectionsStackView.spacing = 20
        sectionsStackView.translatesAutoresizingMaskIntoConstraints = false
        
        // Add sections
        sectionsStackView.addArrangedSubview(createSecuritySection())
        sectionsStackView.addArrangedSubview(createVerificationSection())
        sectionsStackView.addArrangedSubview(createAccountSection())
        
        view.addSubview(scrollView)
        scrollView.addSubview(contentView)
        contentView.addSubview(profileHeaderView)
        contentView.addSubview(sectionsStackView)
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
            
            profileHeaderView.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 20),
            profileHeaderView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            profileHeaderView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            
            profileImageView.topAnchor.constraint(equalTo: profileHeaderView.topAnchor, constant: 20),
            profileImageView.centerXAnchor.constraint(equalTo: profileHeaderView.centerXAnchor),
            profileImageView.widthAnchor.constraint(equalToConstant: 80),
            profileImageView.heightAnchor.constraint(equalToConstant: 80),
            
            nameLabel.topAnchor.constraint(equalTo: profileImageView.bottomAnchor, constant: 12),
            nameLabel.leadingAnchor.constraint(equalTo: profileHeaderView.leadingAnchor, constant: 20),
            nameLabel.trailingAnchor.constraint(equalTo: profileHeaderView.trailingAnchor, constant: -20),
            
            emailLabel.topAnchor.constraint(equalTo: nameLabel.bottomAnchor, constant: 4),
            emailLabel.leadingAnchor.constraint(equalTo: profileHeaderView.leadingAnchor, constant: 20),
            emailLabel.trailingAnchor.constraint(equalTo: profileHeaderView.trailingAnchor, constant: -20),
            emailLabel.bottomAnchor.constraint(equalTo: profileHeaderView.bottomAnchor, constant: -20),
            
            sectionsStackView.topAnchor.constraint(equalTo: profileHeaderView.bottomAnchor, constant: 20),
            sectionsStackView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            sectionsStackView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            sectionsStackView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -20)
        ])
    }
    
    private func createSecuritySection() -> UIView {
        let section = createSectionView(title: "Security")
        
        let twoFAButton = createSettingButton(
            title: "Two-Factor Authentication",
            subtitle: "Add extra security to your account",
            icon: "lock.shield.fill",
            tag: 1
        )
        
        let passkeyButton = createSettingButton(
            title: "Passkey",
            subtitle: "Sign in with Face ID or Touch ID",
            icon: "key.fill",
            tag: 2
        )
        
        section.addArrangedSubview(twoFAButton)
        section.addArrangedSubview(passkeyButton)
        
        return section
    }
    
    private func createVerificationSection() -> UIView {
        let section = createSectionView(title: "Verification")
        
        let ekycButton = createSettingButton(
            title: "Identity Verification (eKYC)",
            subtitle: "Required for booking rooms",
            icon: "checkmark.shield.fill",
            tag: 3
        )
        
        section.addArrangedSubview(ekycButton)
        
        return section
    }
    
    private func createAccountSection() -> UIView {
        let section = createSectionView(title: "Account")
        
        let editProfileButton = createSettingButton(
            title: "Edit Profile",
            subtitle: "Update your personal information",
            icon: "person.fill",
            tag: 4
        )
        
        let logoutButton = createSettingButton(
            title: "Logout",
            subtitle: "Sign out of your account",
            icon: "arrow.right.square.fill",
            tag: 5
        )
        
        section.addArrangedSubview(editProfileButton)
        section.addArrangedSubview(logoutButton)
        
        return section
    }
    
    private func createSectionView(title: String) -> UIStackView {
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 8
        
        let titleLabel = UILabel()
        titleLabel.text = title
        titleLabel.font = .systemFont(ofSize: 18, weight: .semibold)
        titleLabel.textColor = .secondaryLabel
        
        stack.addArrangedSubview(titleLabel)
        
        return stack
    }
    
    private func createSettingButton(title: String, subtitle: String, icon: String, tag: Int) -> UIButton {
        let button = UIButton(type: .system)
        button.tag = tag
        button.backgroundColor = .systemBackground
        button.layer.cornerRadius = 12
        button.layer.borderWidth = 1
        button.layer.borderColor = UIColor.systemGray5.cgColor
        button.addTarget(self, action: #selector(settingButtonTapped), for: .touchUpInside)
        
        let iconView = UIImageView(image: UIImage(systemName: icon))
        iconView.tintColor = .systemBlue
        iconView.contentMode = .scaleAspectFit
        iconView.translatesAutoresizingMaskIntoConstraints = false
        
        let titleLabel = UILabel()
        titleLabel.text = title
        titleLabel.font = .systemFont(ofSize: 16, weight: .medium)
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        
        let subtitleLabel = UILabel()
        subtitleLabel.text = subtitle
        subtitleLabel.font = .systemFont(ofSize: 13)
        subtitleLabel.textColor = .secondaryLabel
        subtitleLabel.translatesAutoresizingMaskIntoConstraints = false
        
        let chevron = UIImageView(image: UIImage(systemName: "chevron.right"))
        chevron.tintColor = .systemGray3
        chevron.contentMode = .scaleAspectFit
        chevron.translatesAutoresizingMaskIntoConstraints = false
        
        button.addSubview(iconView)
        button.addSubview(titleLabel)
        button.addSubview(subtitleLabel)
        button.addSubview(chevron)
        
        NSLayoutConstraint.activate([
            button.heightAnchor.constraint(greaterThanOrEqualToConstant: 70),
            
            iconView.leadingAnchor.constraint(equalTo: button.leadingAnchor, constant: 16),
            iconView.centerYAnchor.constraint(equalTo: button.centerYAnchor),
            iconView.widthAnchor.constraint(equalToConstant: 30),
            iconView.heightAnchor.constraint(equalToConstant: 30),
            
            titleLabel.leadingAnchor.constraint(equalTo: iconView.trailingAnchor, constant: 16),
            titleLabel.topAnchor.constraint(equalTo: button.topAnchor, constant: 16),
            titleLabel.trailingAnchor.constraint(equalTo: chevron.leadingAnchor, constant: -16),
            
            subtitleLabel.leadingAnchor.constraint(equalTo: iconView.trailingAnchor, constant: 16),
            subtitleLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 2),
            subtitleLabel.trailingAnchor.constraint(equalTo: chevron.leadingAnchor, constant: -16),
            subtitleLabel.bottomAnchor.constraint(equalTo: button.bottomAnchor, constant: -16),
            
            chevron.trailingAnchor.constraint(equalTo: button.trailingAnchor, constant: -16),
            chevron.centerYAnchor.constraint(equalTo: button.centerYAnchor),
            chevron.widthAnchor.constraint(equalToConstant: 12),
            chevron.heightAnchor.constraint(equalToConstant: 20)
        ])
        
        return button
    }
    
    private func configureProfile() {
        guard let user = AuthManager.shared.currentUser else { return }
        
        emailLabel.text = user.email
        
        if let guest = user.guest {
            nameLabel.text = guest.fullName
        } else {
            nameLabel.text = "Guest User"
        }
    }
    
    private func updateSecurityStatus() {
        guard let user = AuthManager.shared.currentUser else { return }
        
        // Update 2FA status display
        // Update Passkey status display
        // Update eKYC status display
    }
    
    @objc private func settingButtonTapped(_ sender: UIButton) {
        switch sender.tag {
        case 1: // Two-Factor Authentication
            showTwoFactorOptions()
        case 2: // Passkey
            showPasskeyOptions()
        case 3: // eKYC
            navigateToEKYC()
        case 4: // Edit Profile
            showEditProfile()
        case 5: // Logout
            confirmLogout()
        default:
            break
        }
    }
    
    private func showTwoFactorOptions() {
        guard let user = AuthManager.shared.currentUser else { return }
        
        if user.twoFactorEnabled {
            showDisable2FAConfirmation()
        } else {
            showEnable2FAFlow()
        }
    }
    
    private func showEnable2FAFlow() {
        Task {
            do {
                let setup = try await AuthManager.shared.enable2FA()
                
                await MainActor.run {
                    let twoFASetupVC = TwoFactorSetupViewController(setup: setup)
                    navigationController?.pushViewController(twoFASetupVC, animated: true)
                }
            } catch {
                await MainActor.run {
                    showAlert(title: "Error", message: error.localizedDescription)
                }
            }
        }
    }
    
    private func showDisable2FAConfirmation() {
        let alert = UIAlertController(
            title: "Disable Two-Factor Authentication",
            message: "Enter your authentication code to disable 2FA",
            preferredStyle: .alert
        )
        
        alert.addTextField { textField in
            textField.placeholder = "000000"
            textField.keyboardType = .numberPad
        }
        
        alert.addAction(UIAlertAction(title: "Disable", style: .destructive) { [weak self] _ in
            guard let code = alert.textFields?.first?.text else { return }
            self?.disable2FA(code: code)
        })
        
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        
        present(alert, animated: true)
    }
    
    private func disable2FA(code: String) {
        Task {
            do {
                _ = try await AuthManager.shared.disable2FA(code: code)
                await MainActor.run {
                    showAlert(title: "Success", message: "Two-factor authentication has been disabled")
                    updateSecurityStatus()
                }
            } catch {
                await MainActor.run {
                    showAlert(title: "Error", message: error.localizedDescription)
                }
            }
        }
    }
    
    private func showPasskeyOptions() {
        guard #available(iOS 16.0, *) else {
            showAlert(title: "Not Supported", message: "Passkey is not supported on this device")
            return
        }
        
        guard let user = AuthManager.shared.currentUser else { return }
        
        if user.hasPasskey {
            showAlert(title: "Passkey Active", message: "You already have a passkey registered")
        } else {
            registerPasskey()
        }
    }
    
    private func registerPasskey() {
        guard let user = AuthManager.shared.currentUser else { return }
        
        Task {
            do {
                try await AuthManager.shared.registerPasskey(for: user)
                await MainActor.run {
                    showAlert(title: "Success", message: "Passkey has been registered")
                    updateSecurityStatus()
                }
            } catch {
                await MainActor.run {
                    showAlert(title: "Error", message: error.localizedDescription)
                }
            }
        }
    }
    
    private func navigateToEKYC() {
        let ekycVC = EKYCViewController()
        navigationController?.pushViewController(ekycVC, animated: true)
    }
    
    private func showEditProfile() {
        showAlert(title: "Coming Soon", message: "Profile editing will be available soon")
    }
    
    private func confirmLogout() {
        let alert = UIAlertController(
            title: "Logout",
            message: "Are you sure you want to logout?",
            preferredStyle: .alert
        )
        
        alert.addAction(UIAlertAction(title: "Logout", style: .destructive) { [weak self] _ in
            self?.performLogout()
        })
        
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        
        present(alert, animated: true)
    }
    
    private func performLogout() {
        AuthManager.shared.logout()
    }
    
    private func showAlert(title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}
