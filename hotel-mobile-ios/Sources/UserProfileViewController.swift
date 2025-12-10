import UIKit

class UserProfileViewController: UIViewController {

    private let apiService = HotelAPIService.shared
    private var profile: UserProfile?
    private var passkeys: [PasskeyInfo] = []
    private var isLoading = false
    private var isEditingProfile = false

    private let scrollView: UIScrollView = {
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        return scroll
    }()

    private let contentStackView: UIStackView = {
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 20
        stack.translatesAutoresizingMaskIntoConstraints = false
        return stack
    }()

    private let loadingIndicator: UIActivityIndicatorView = {
        let indicator = UIActivityIndicatorView(style: .large)
        indicator.hidesWhenStopped = true
        indicator.translatesAutoresizingMaskIntoConstraints = false
        return indicator
    }()

    // Profile Fields
    private let fullNameField = UITextField()
    private let emailField = UITextField()
    private let phoneField = UITextField()
    private let addressField = UITextField()
    private let cityField = UITextField()
    private let countryField = UITextField()

    // Password Fields
    private let currentPasswordField = UITextField()
    private let newPasswordField = UITextField()
    private let confirmPasswordField = UITextField()

    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
        loadProfile()
        loadPasskeys()
    }

    private func setupUI() {
        title = "Profile"
        view.backgroundColor = .systemGroupedBackground

        view.addSubview(scrollView)
        view.addSubview(loadingIndicator)
        scrollView.addSubview(contentStackView)

        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            contentStackView.topAnchor.constraint(equalTo: scrollView.topAnchor, constant: 20),
            contentStackView.leadingAnchor.constraint(equalTo: scrollView.leadingAnchor, constant: 20),
            contentStackView.trailingAnchor.constraint(equalTo: scrollView.trailingAnchor, constant: -20),
            contentStackView.bottomAnchor.constraint(equalTo: scrollView.bottomAnchor, constant: -20),
            contentStackView.widthAnchor.constraint(equalTo: scrollView.widthAnchor, constant: -40),

            loadingIndicator.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            loadingIndicator.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
    }

    private func loadProfile() {
        guard !isLoading else { return }
        isLoading = true
        loadingIndicator.startAnimating()

        Task {
            do {
                let userProfile = try await apiService.getUserProfile()
                await MainActor.run {
                    self.profile = userProfile
                    self.displayProfile()
                    self.isLoading = false
                    self.loadingIndicator.stopAnimating()
                }
            } catch {
                await MainActor.run {
                    self.isLoading = false
                    self.loadingIndicator.stopAnimating()
                    self.showError(error)
                }
            }
        }
    }

    private func loadPasskeys() {
        Task {
            do {
                let passkeyList = try await apiService.listPasskeys()
                await MainActor.run {
                    self.passkeys = passkeyList
                    self.updatePasskeysSection()
                }
            } catch {
                print("Failed to load passkeys: \(error)")
            }
        }
    }

    private func displayProfile() {
        contentStackView.arrangedSubviews.forEach { $0.removeFromSuperview() }

        guard let profile = profile else { return }

        // Avatar and Header
        let headerSection = createHeaderSection(profile: profile)
        contentStackView.addArrangedSubview(headerSection)

        // Profile Form Section
        let profileSection = createProfileSection(profile: profile)
        contentStackView.addArrangedSubview(profileSection)

        // Security Section
        let securitySection = createSecuritySection()
        contentStackView.addArrangedSubview(securitySection)

        // Passkeys Section
        let passkeysSection = createPasskeysSection()
        contentStackView.addArrangedSubview(passkeysSection)
    }

    private func createHeaderSection(profile: UserProfile) -> UIView {
        let card = createCard()

        let avatarView = createAvatar(profile: profile)
        let nameLabel = UILabel()
        nameLabel.text = profile.full_name ?? profile.username
        nameLabel.font = .systemFont(ofSize: 24, weight: .bold)
        nameLabel.textAlignment = .center
        nameLabel.translatesAutoresizingMaskIntoConstraints = false

        let usernameLabel = UILabel()
        usernameLabel.text = "@\(profile.username)"
        usernameLabel.font = .systemFont(ofSize: 14)
        usernameLabel.textColor = .secondaryLabel
        usernameLabel.textAlignment = .center
        usernameLabel.translatesAutoresizingMaskIntoConstraints = false

        let editButton = UIButton(type: .system)
        editButton.setTitle("Edit Profile", for: .normal)
        editButton.backgroundColor = .systemBlue
        editButton.setTitleColor(.white, for: .normal)
        editButton.layer.cornerRadius = 8
        editButton.addTarget(self, action: #selector(toggleEdit), for: .touchUpInside)
        editButton.translatesAutoresizingMaskIntoConstraints = false

        card.addSubview(avatarView)
        card.addSubview(nameLabel)
        card.addSubview(usernameLabel)
        card.addSubview(editButton)

        NSLayoutConstraint.activate([
            avatarView.topAnchor.constraint(equalTo: card.topAnchor, constant: 20),
            avatarView.centerXAnchor.constraint(equalTo: card.centerXAnchor),

            nameLabel.topAnchor.constraint(equalTo: avatarView.bottomAnchor, constant: 12),
            nameLabel.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            nameLabel.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),

            usernameLabel.topAnchor.constraint(equalTo: nameLabel.bottomAnchor, constant: 4),
            usernameLabel.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            usernameLabel.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),

            editButton.topAnchor.constraint(equalTo: usernameLabel.bottomAnchor, constant: 16),
            editButton.centerXAnchor.constraint(equalTo: card.centerXAnchor),
            editButton.widthAnchor.constraint(equalToConstant: 120),
            editButton.heightAnchor.constraint(equalToConstant: 40),
            editButton.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -20)
        ])

        return card
    }

    private func createAvatar(profile: UserProfile) -> UIView {
        let avatarView = UIView()
        avatarView.backgroundColor = .systemBlue
        avatarView.layer.cornerRadius = 40
        avatarView.translatesAutoresizingMaskIntoConstraints = false

        let initial = String(profile.full_name?.prefix(1) ?? profile.username.prefix(1)).uppercased()
        let label = UILabel()
        label.text = initial
        label.font = .systemFont(ofSize: 32, weight: .bold)
        label.textColor = .white
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false

        avatarView.addSubview(label)

        NSLayoutConstraint.activate([
            avatarView.widthAnchor.constraint(equalToConstant: 80),
            avatarView.heightAnchor.constraint(equalToConstant: 80),
            label.centerXAnchor.constraint(equalTo: avatarView.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: avatarView.centerYAnchor)
        ])

        return avatarView
    }

    private func createProfileSection(profile: UserProfile) -> UIView {
        let card = createCard()
        let titleLabel = createSectionTitle("Personal Information")

        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false

        setupTextField(fullNameField, placeholder: "Full Name", value: profile.full_name)
        setupTextField(emailField, placeholder: "Email", value: profile.email)
        emailField.keyboardType = .emailAddress
        setupTextField(phoneField, placeholder: "Phone", value: profile.phone)
        phoneField.keyboardType = .phonePad
        setupTextField(addressField, placeholder: "Address", value: profile.address)
        setupTextField(cityField, placeholder: "City", value: profile.city)
        setupTextField(countryField, placeholder: "Country", value: profile.country)

        stack.addArrangedSubview(fullNameField)
        stack.addArrangedSubview(emailField)
        stack.addArrangedSubview(phoneField)
        stack.addArrangedSubview(addressField)
        stack.addArrangedSubview(cityField)
        stack.addArrangedSubview(countryField)

        let saveButton = UIButton(type: .system)
        saveButton.setTitle("Save Changes", for: .normal)
        saveButton.backgroundColor = .systemGreen
        saveButton.setTitleColor(.white, for: .normal)
        saveButton.layer.cornerRadius = 8
        saveButton.addTarget(self, action: #selector(saveProfile), for: .touchUpInside)
        saveButton.translatesAutoresizingMaskIntoConstraints = false
        saveButton.heightAnchor.constraint(equalToConstant: 44).isActive = true

        stack.addArrangedSubview(saveButton)

        card.addSubview(titleLabel)
        card.addSubview(stack)

        NSLayoutConstraint.activate([
            titleLabel.topAnchor.constraint(equalTo: card.topAnchor, constant: 16),
            titleLabel.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),

            stack.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 16),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -16)
        ])

        return card
    }

    private func createSecuritySection() -> UIView {
        let card = createCard()
        let titleLabel = createSectionTitle("Change Password")

        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false

        setupTextField(currentPasswordField, placeholder: "Current Password", value: nil)
        currentPasswordField.isSecureTextEntry = true

        setupTextField(newPasswordField, placeholder: "New Password", value: nil)
        newPasswordField.isSecureTextEntry = true

        setupTextField(confirmPasswordField, placeholder: "Confirm New Password", value: nil)
        confirmPasswordField.isSecureTextEntry = true

        let helperLabel = UILabel()
        helperLabel.text = "Minimum 8 characters"
        helperLabel.font = .systemFont(ofSize: 12)
        helperLabel.textColor = .secondaryLabel

        stack.addArrangedSubview(currentPasswordField)
        stack.addArrangedSubview(newPasswordField)
        stack.addArrangedSubview(confirmPasswordField)
        stack.addArrangedSubview(helperLabel)

        let changeButton = UIButton(type: .system)
        changeButton.setTitle("Update Password", for: .normal)
        changeButton.backgroundColor = .systemOrange
        changeButton.setTitleColor(.white, for: .normal)
        changeButton.layer.cornerRadius = 8
        changeButton.addTarget(self, action: #selector(changePassword), for: .touchUpInside)
        changeButton.translatesAutoresizingMaskIntoConstraints = false
        changeButton.heightAnchor.constraint(equalToConstant: 44).isActive = true

        stack.addArrangedSubview(changeButton)

        card.addSubview(titleLabel)
        card.addSubview(stack)

        NSLayoutConstraint.activate([
            titleLabel.topAnchor.constraint(equalTo: card.topAnchor, constant: 16),
            titleLabel.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),

            stack.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 16),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -16)
        ])

        return card
    }

    private func createPasskeysSection() -> UIView {
        let card = createCard()

        let headerStack = UIStackView()
        headerStack.axis = .horizontal
        headerStack.distribution = .equalSpacing
        headerStack.translatesAutoresizingMaskIntoConstraints = false

        let titleLabel = createSectionTitle("Passkeys (\(passkeys.count)/3)")

        let addButton = UIButton(type: .system)
        addButton.setTitle("+ Add", for: .normal)
        addButton.backgroundColor = passkeys.count >= 3 ? .systemGray4 : .systemBlue
        addButton.setTitleColor(.white, for: .normal)
        addButton.layer.cornerRadius = 8
        addButton.isEnabled = passkeys.count < 3
        addButton.addTarget(self, action: #selector(addPasskey), for: .touchUpInside)
        addButton.translatesAutoresizingMaskIntoConstraints = false
        addButton.widthAnchor.constraint(equalToConstant: 80).isActive = true
        addButton.heightAnchor.constraint(equalToConstant: 36).isActive = true

        headerStack.addArrangedSubview(titleLabel)
        headerStack.addArrangedSubview(addButton)

        card.addSubview(headerStack)

        NSLayoutConstraint.activate([
            headerStack.topAnchor.constraint(equalTo: card.topAnchor, constant: 16),
            headerStack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            headerStack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16)
        ])

        if passkeys.isEmpty {
            let emptyLabel = UILabel()
            emptyLabel.text = "No passkeys registered\nAdd a passkey for secure, passwordless login"
            emptyLabel.numberOfLines = 0
            emptyLabel.textAlignment = .center
            emptyLabel.font = .systemFont(ofSize: 14)
            emptyLabel.textColor = .secondaryLabel
            emptyLabel.translatesAutoresizingMaskIntoConstraints = false

            card.addSubview(emptyLabel)

            NSLayoutConstraint.activate([
                emptyLabel.topAnchor.constraint(equalTo: headerStack.bottomAnchor, constant: 40),
                emptyLabel.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
                emptyLabel.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
                emptyLabel.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -40)
            ])
        } else {
            let passkeyStack = UIStackView()
            passkeyStack.axis = .vertical
            passkeyStack.spacing = 12
            passkeyStack.translatesAutoresizingMaskIntoConstraints = false

            for passkey in passkeys {
                let passkeyRow = createPasskeyRow(passkey: passkey)
                passkeyStack.addArrangedSubview(passkeyRow)
            }

            card.addSubview(passkeyStack)

            NSLayoutConstraint.activate([
                passkeyStack.topAnchor.constraint(equalTo: headerStack.bottomAnchor, constant: 16),
                passkeyStack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
                passkeyStack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
                passkeyStack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -16)
            ])

            // Show limit reached message
            if passkeys.count >= 3 {
                let infoLabel = UILabel()
                infoLabel.text = "Maximum number of passkeys reached (3/3)"
                infoLabel.font = .systemFont(ofSize: 12)
                infoLabel.textColor = .systemBlue
                infoLabel.backgroundColor = UIColor.systemBlue.withAlphaComponent(0.1)
                infoLabel.textAlignment = .center
                infoLabel.layer.cornerRadius = 6
                infoLabel.clipsToBounds = true
                infoLabel.translatesAutoresizingMaskIntoConstraints = false
                infoLabel.heightAnchor.constraint(equalToConstant: 30).isActive = true

                passkeyStack.addArrangedSubview(infoLabel)
            }
        }

        return card
    }

    private func createPasskeyRow(passkey: PasskeyInfo) -> UIView {
        let row = UIView()
        row.backgroundColor = .systemGray6
        row.layer.cornerRadius = 8
        row.translatesAutoresizingMaskIntoConstraints = false
        row.heightAnchor.constraint(greaterThanOrEqualToConstant: 70).isActive = true

        let nameLabel = UILabel()
        nameLabel.text = passkey.device_name ?? "Unnamed Device"
        nameLabel.font = .systemFont(ofSize: 15, weight: .medium)
        nameLabel.translatesAutoresizingMaskIntoConstraints = false

        let dateFormatter = DateFormatter()
        dateFormatter.dateStyle = .medium
        dateFormatter.timeStyle = .none

        let createdLabel = UILabel()
        createdLabel.text = "Added: \(formatDate(passkey.created_at))"
        createdLabel.font = .systemFont(ofSize: 12)
        createdLabel.textColor = .secondaryLabel
        createdLabel.translatesAutoresizingMaskIntoConstraints = false

        let deleteButton = UIButton(type: .system)
        deleteButton.setImage(UIImage(systemName: "trash"), for: .normal)
        deleteButton.tintColor = .systemRed
        deleteButton.addTarget(self, action: #selector(deletePasskeyTapped(_:)), for: .touchUpInside)
        deleteButton.tag = passkey.id
        deleteButton.translatesAutoresizingMaskIntoConstraints = false

        row.addSubview(nameLabel)
        row.addSubview(createdLabel)
        row.addSubview(deleteButton)

        NSLayoutConstraint.activate([
            nameLabel.topAnchor.constraint(equalTo: row.topAnchor, constant: 12),
            nameLabel.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 12),
            nameLabel.trailingAnchor.constraint(equalTo: deleteButton.leadingAnchor, constant: -8),

            createdLabel.topAnchor.constraint(equalTo: nameLabel.bottomAnchor, constant: 4),
            createdLabel.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 12),
            createdLabel.bottomAnchor.constraint(lessThanOrEqualTo: row.bottomAnchor, constant: -12),

            deleteButton.trailingAnchor.constraint(equalTo: row.trailingAnchor, constant: -12),
            deleteButton.centerYAnchor.constraint(equalTo: row.centerYAnchor),
            deleteButton.widthAnchor.constraint(equalToConstant: 44),
            deleteButton.heightAnchor.constraint(equalToConstant: 44)
        ])

        return row
    }

    private func updatePasskeysSection() {
        if profile != nil {
            displayProfile()
        }
    }

    private func setupTextField(_ textField: UITextField, placeholder: String, value: String?) {
        textField.placeholder = placeholder
        textField.text = value
        textField.borderStyle = .roundedRect
        textField.font = .systemFont(ofSize: 15)
        textField.isEnabled = isEditingProfile
        textField.translatesAutoresizingMaskIntoConstraints = false
        textField.heightAnchor.constraint(equalToConstant: 44).isActive = true
    }

    private func createCard() -> UIView {
        let card = UIView()
        card.backgroundColor = .systemBackground
        card.layer.cornerRadius = 12
        card.layer.shadowColor = UIColor.black.cgColor
        card.layer.shadowOpacity = 0.1
        card.layer.shadowOffset = CGSize(width: 0, height: 2)
        card.layer.shadowRadius = 4
        card.translatesAutoresizingMaskIntoConstraints = false
        return card
    }

    private func createSectionTitle(_ text: String) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = .systemFont(ofSize: 18, weight: .bold)
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }

    private func formatDate(_ dateString: String) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        if let date = formatter.date(from: dateString) {
            formatter.dateStyle = .medium
            formatter.timeStyle = .none
            return formatter.string(from: date)
        }
        return dateString
    }

    @objc private func toggleEdit() {
        isEditingProfile.toggle()
        fullNameField.isEnabled = isEditingProfile
        emailField.isEnabled = isEditingProfile
        phoneField.isEnabled = isEditingProfile
        addressField.isEnabled = isEditingProfile
        cityField.isEnabled = isEditingProfile
        countryField.isEnabled = isEditingProfile
    }

    @objc private func saveProfile() {
        guard isEditing else { return }

        Task {
            do {
                _ = try await apiService.updateUserProfile(
                    fullName: fullNameField.text,
                    email: emailField.text,
                    phone: phoneField.text,
                    address: addressField.text,
                    city: cityField.text,
                    country: countryField.text
                )
                await MainActor.run {
                    self.isEditingProfile = false
                    self.loadProfile()
                    self.showSuccess("Profile updated successfully")
                }
            } catch {
                await MainActor.run {
                    self.showError(error)
                }
            }
        }
    }

    @objc private func changePassword() {
        guard let current = currentPasswordField.text, !current.isEmpty,
              let new = newPasswordField.text, !new.isEmpty,
              let confirm = confirmPasswordField.text, !confirm.isEmpty else {
            showAlert("Error", "Please fill in all password fields")
            return
        }

        guard new == confirm else {
            showAlert("Error", "New passwords do not match")
            return
        }

        guard new.count >= 8 else {
            showAlert("Error", "Password must be at least 8 characters long")
            return
        }

        Task {
            do {
                try await apiService.updatePassword(currentPassword: current, newPassword: new)
                await MainActor.run {
                    self.currentPasswordField.text = ""
                    self.newPasswordField.text = ""
                    self.confirmPasswordField.text = ""
                    self.showSuccess("Password updated successfully")
                }
            } catch {
                await MainActor.run {
                    self.showError(error)
                }
            }
        }
    }

    @objc private func addPasskey() {
        // Check 3-passkey limit
        guard passkeys.count < 3 else {
            showAlert("Limit Reached", "Maximum of 3 passkeys allowed per user")
            return
        }

        showAlert("Not Implemented", "Passkey registration requires WebAuthn implementation. This feature should be implemented using iOS Authentication Services framework.")
    }

    @objc private func deletePasskeyTapped(_ sender: UIButton) {
        let passkeyId = sender.tag

        let alert = UIAlertController(
            title: "Delete Passkey",
            message: "Are you sure you want to delete this passkey?",
            preferredStyle: .alert
        )

        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Delete", style: .destructive) { [weak self] _ in
            self?.deletePasskey(id: passkeyId)
        })

        present(alert, animated: true)
    }

    private func deletePasskey(id: Int) {
        Task {
            do {
                try await apiService.deletePasskey(passkeyId: id)
                await MainActor.run {
                    self.loadPasskeys()
                    self.showSuccess("Passkey deleted successfully")
                }
            } catch {
                await MainActor.run {
                    self.showError(error)
                }
            }
        }
    }

    private func showError(_ error: Error) {
        let alert = UIAlertController(
            title: "Error",
            message: error.localizedDescription,
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }

    private func showSuccess(_ message: String) {
        let alert = UIAlertController(
            title: "Success",
            message: message,
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }

    private func showAlert(_ title: String, _ message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}
