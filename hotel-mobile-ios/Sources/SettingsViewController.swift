import UIKit

class SettingsViewController: UIViewController {
    
    private let scrollView = UIScrollView()
    private let contentView = UIView()
    private let userInfoLabel = UILabel()
    private let logoutButton = UIButton(type: .system)
    private let serverURLLabel = UILabel()
    private let serverURLTextField = UITextField()
    private let saveButton = UIButton(type: .system)
    private let connectionStatusLabel = UILabel()
    private let testConnectionButton = UIButton(type: .system)

    private let userDefaults = UserDefaults.standard
    private let serverURLKey = "serverURL"
    private let authManager = AuthManager.shared

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Settings"
        setupUI()
        loadSettings()
        updateUserInfo()
        
        // Listen for login notifications
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(updateUserInfo),
            name: NSNotification.Name("UserDidLogin"),
            object: nil
        )
    }
    
    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    private func setupUI() {
        view.backgroundColor = .systemBackground
        
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        contentView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scrollView)
        scrollView.addSubview(contentView)
        
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 20
        stack.translatesAutoresizingMaskIntoConstraints = false

        // User Info Section
        let userSectionLabel = UILabel()
        userSectionLabel.text = "User Information"
        userSectionLabel.font = .systemFont(ofSize: 18, weight: .bold)
        
        userInfoLabel.text = "Not logged in"
        userInfoLabel.font = .systemFont(ofSize: 14)
        userInfoLabel.numberOfLines = 0
        
        logoutButton.setTitle("Logout", for: .normal)
        logoutButton.backgroundColor = .systemRed
        logoutButton.setTitleColor(.white, for: .normal)
        logoutButton.layer.cornerRadius = 8
        logoutButton.addTarget(self, action: #selector(logoutTapped), for: .touchUpInside)
        
        // Server Settings Section
        let serverSectionLabel = UILabel()
        serverSectionLabel.text = "Server Settings"
        serverSectionLabel.font = .systemFont(ofSize: 18, weight: .bold)

        serverURLLabel.text = "Server URL:"
        serverURLLabel.font = .systemFont(ofSize: 16, weight: .semibold)

        serverURLTextField.borderStyle = .roundedRect
        serverURLTextField.placeholder = "http://localhost:3030"
        serverURLTextField.keyboardType = .URL

        saveButton.setTitle("Save Settings", for: .normal)
        saveButton.backgroundColor = .systemBlue
        saveButton.setTitleColor(.white, for: .normal)
        saveButton.layer.cornerRadius = 8
        saveButton.addTarget(self, action: #selector(saveSettings), for: .touchUpInside)

        connectionStatusLabel.text = "Connection Status: Not Tested"
        connectionStatusLabel.font = .systemFont(ofSize: 14)
        connectionStatusLabel.textColor = .systemGray

        testConnectionButton.setTitle("Test Connection", for: .normal)
        testConnectionButton.backgroundColor = .systemGreen
        testConnectionButton.setTitleColor(.white, for: .normal)
        testConnectionButton.layer.cornerRadius = 8
        testConnectionButton.addTarget(self, action: #selector(testConnection), for: .touchUpInside)

        stack.addArrangedSubview(userSectionLabel)
        stack.addArrangedSubview(userInfoLabel)
        stack.addArrangedSubview(logoutButton)
        stack.addArrangedSubview(UIView()) // Spacer
        stack.addArrangedSubview(serverSectionLabel)
        stack.addArrangedSubview(serverURLLabel)
        stack.addArrangedSubview(serverURLTextField)
        stack.addArrangedSubview(saveButton)
        stack.addArrangedSubview(connectionStatusLabel)
        stack.addArrangedSubview(testConnectionButton)

        // Info text
        let infoLabel = UILabel()
        infoLabel.text = "Note: Default URL is http://localhost:3030.\nWhen running on device, update to your computer's IP address."
        infoLabel.font = .systemFont(ofSize: 12)
        infoLabel.textColor = .systemGray
        infoLabel.numberOfLines = 0
        infoLabel.textAlignment = .center
        stack.addArrangedSubview(infoLabel)

        contentView.addSubview(stack)

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
            
            stack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 20),
            stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -20),
            
            logoutButton.heightAnchor.constraint(equalToConstant: 44),
            serverURLTextField.heightAnchor.constraint(equalToConstant: 44),
            saveButton.heightAnchor.constraint(equalToConstant: 44),
            testConnectionButton.heightAnchor.constraint(equalToConstant: 44)
        ])
    }
    
    @objc private func updateUserInfo() {
        if let user = authManager.currentUser {
            let rolesText = authManager.roles.isEmpty ? "No roles" : authManager.roles.joined(separator: ", ")
            userInfoLabel.text = """
            Username: \(user.username)
            Email: \(user.email)
            Full Name: \(user.full_name ?? "N/A")
            Roles: \(rolesText)
            """
            logoutButton.isEnabled = true
        } else {
            userInfoLabel.text = "Not logged in"
            logoutButton.isEnabled = false
        }
    }

    private func loadSettings() {
        let savedURL = userDefaults.string(forKey: serverURLKey)
        serverURLTextField.text = savedURL ?? "http://localhost:3030"
    }

    @objc private func saveSettings() {
        guard let urlText = serverURLTextField.text, !urlText.isEmpty else {
            showError("Please enter a server URL")
            return
        }

        userDefaults.set(urlText, forKey: serverURLKey)

        let alert = UIAlertController(title: "Settings Saved", message: "Server URL has been updated.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }

    @objc private func testConnection() {
        Task {
            do {
                await MainActor.run {
                    connectionStatusLabel.text = "Testing connection..."
                    connectionStatusLabel.textColor = .systemOrange
                }

                let _ = try await HotelAPIService.shared.getAllRooms()

                await MainActor.run {
                    connectionStatusLabel.text = "✓ Connection Successful"
                    connectionStatusLabel.textColor = .systemGreen
                }
            } catch {
                await MainActor.run {
                    connectionStatusLabel.text = "✗ Connection Failed"
                    connectionStatusLabel.textColor = .systemRed
                    showError("Connection failed: \(error.localizedDescription)")
                }
            }
        }
    }
    
    @objc private func logoutTapped() {
        let alert = UIAlertController(title: "Logout", message: "Are you sure you want to logout?", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Logout", style: .destructive) { [weak self] _ in
            AuthManager.shared.logout()
            NotificationCenter.default.post(name: NSNotification.Name("UserDidLogout"), object: nil)
        })
        present(alert, animated: true)
    }

    private func showError(_ message: String) {
        let alert = UIAlertController(title: "Error", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}
