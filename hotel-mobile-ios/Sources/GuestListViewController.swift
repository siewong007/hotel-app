import UIKit

class GuestListViewController: UIViewController {

    private let tableView = UITableView()
    private var guests: [Guest] = []
    private let refreshControl = UIRefreshControl()

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Guests"
        setupUI()
        loadGuests()
    }
    
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        loadGuests()
    }

    private func setupUI() {
        view.backgroundColor = .systemBackground

        // Add button
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .add,
            target: self,
            action: #selector(addGuestTapped)
        )

        tableView.translatesAutoresizingMaskIntoConstraints = false
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "GuestCell")
        tableView.dataSource = self
        tableView.delegate = self
        tableView.refreshControl = refreshControl
        
        refreshControl.addTarget(self, action: #selector(refreshGuests), for: .valueChanged)

        view.addSubview(tableView)

        NSLayoutConstraint.activate([
            tableView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
    }
    
    @objc private func refreshGuests() {
        loadGuests()
    }
    
    @objc private func addGuestTapped() {
        showGuestForm(guest: nil)
    }

    private func loadGuests() {
        Task {
            do {
                self.guests = try await HotelAPIService.shared.getAllGuests()
                await MainActor.run {
                    tableView.reloadData()
                    refreshControl.endRefreshing()
                }
            } catch {
                await MainActor.run {
                    refreshControl.endRefreshing()
                    showError("Failed to load guests: \(error.localizedDescription)")
                }
            }
        }
    }
    
    private func showGuestForm(guest: Guest?) {
        let alert = UIAlertController(
            title: guest == nil ? "Add Guest" : "Edit Guest",
            message: nil,
            preferredStyle: .alert
        )
        
        alert.addTextField { textField in
            textField.placeholder = "Name"
            textField.text = guest?.name
        }
        alert.addTextField { textField in
            textField.placeholder = "Email"
            textField.keyboardType = .emailAddress
            textField.text = guest?.email
        }
        alert.addTextField { textField in
            textField.placeholder = "Phone (optional)"
            textField.keyboardType = .phonePad
            textField.text = guest?.phone
        }
        alert.addTextField { textField in
            textField.placeholder = "Address (optional)"
            textField.text = guest?.address
        }
        
        let saveAction = UIAlertAction(title: "Save", style: .default) { [weak self, weak alert] _ in
            guard let name = alert?.textFields?[0].text, !name.isEmpty,
                  let email = alert?.textFields?[1].text, !email.isEmpty else {
                self?.showError("Name and email are required")
                return
            }
            
            let phone = alert?.textFields?[2].text
            let address = alert?.textFields?[3].text
            
            if let guest = guest {
                self?.updateGuest(id: guest.id, name: name, email: email, phone: phone, address: address)
            } else {
                self?.createGuest(name: name, email: email, phone: phone, address: address)
            }
        }
        
        alert.addAction(saveAction)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        
        present(alert, animated: true)
    }
    
    private func createGuest(name: String, email: String, phone: String?, address: String?) {
        Task {
            do {
                _ = try await HotelAPIService.shared.createGuest(
                    name: name,
                    email: email,
                    phone: phone,
                    address: address
                )
                await MainActor.run {
                    loadGuests()
                }
            } catch {
                await MainActor.run {
                    showError("Failed to create guest: \(error.localizedDescription)")
                }
            }
        }
    }
    
    private func updateGuest(id: String, name: String, email: String, phone: String?, address: String?) {
        Task {
            do {
                _ = try await HotelAPIService.shared.updateGuest(
                    id: id,
                    name: name,
                    email: email,
                    phone: phone,
                    address: address
                )
                await MainActor.run {
                    loadGuests()
                }
            } catch {
                await MainActor.run {
                    showError("Failed to update guest: \(error.localizedDescription)")
                }
            }
        }
    }
    
    private func deleteGuest(id: String) {
        Task {
            do {
                try await HotelAPIService.shared.deleteGuest(id: id)
                await MainActor.run {
                    loadGuests()
                }
            } catch {
                await MainActor.run {
                    showError("Failed to delete guest: \(error.localizedDescription)")
                }
            }
        }
    }

    private func showError(_ message: String) {
        let alert = UIAlertController(title: "Error", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}

extension GuestListViewController: UITableViewDataSource {
    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        return guests.count
    }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "GuestCell", for: indexPath)
        let guest = guests[indexPath.row]
        
        var content = cell.defaultContentConfiguration()
        content.text = guest.name
        content.secondaryText = guest.email
        cell.contentConfiguration = content
        cell.accessoryType = .detailButton
        
        return cell
    }
}

extension GuestListViewController: UITableViewDelegate {
    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        let guest = guests[indexPath.row]
        showGuestForm(guest: guest)
    }
    
    func tableView(_ tableView: UITableView, trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        let guest = guests[indexPath.row]
        
        let deleteAction = UIContextualAction(style: .destructive, title: "Delete") { [weak self] _, _, completion in
            let alert = UIAlertController(
                title: "Delete Guest",
                message: "Are you sure you want to delete \(guest.name)?",
                preferredStyle: .alert
            )
            
            alert.addAction(UIAlertAction(title: "Delete", style: .destructive) { _ in
                self?.deleteGuest(id: guest.id)
                completion(true)
            })
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in
                completion(false)
            })
            
            self?.present(alert, animated: true)
        }
        
        return UISwipeActionsConfiguration(actions: [deleteAction])
    }
    
    func tableView(_ tableView: UITableView, accessoryButtonTappedForRowWith indexPath: IndexPath) {
        let guest = guests[indexPath.row]
        showGuestDetails(guest)
    }
    
    private func showGuestDetails(_ guest: Guest) {
        let details = """
        Name: \(guest.name)
        Email: \(guest.email)
        Phone: \(guest.phone ?? "N/A")
        Address: \(guest.address ?? "N/A")
        """
        
        let alert = UIAlertController(title: "Guest Details", message: details, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Edit", style: .default) { [weak self] _ in
            self?.showGuestForm(guest: guest)
        })
        alert.addAction(UIAlertAction(title: "Close", style: .cancel))
        present(alert, animated: true)
    }
}
