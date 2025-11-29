import UIKit

class GuestListViewController: UIViewController {

    private let tableView = UITableView()
    private var guests: [Guest] = []

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Guests"
        setupUI()
        loadGuests()
    }

    private func setupUI() {
        view.backgroundColor = .systemBackground

        tableView.translatesAutoresizingMaskIntoConstraints = false
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "GuestCell")
        tableView.dataSource = self

        view.addSubview(tableView)

        NSLayoutConstraint.activate([
            tableView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
    }

    private func loadGuests() {
        Task {
            do {
                self.guests = try await HotelAPIService.shared.getAllGuests()
                await MainActor.run {
                    tableView.reloadData()
                }
            } catch {
                await MainActor.run {
                    showError("Failed to load guests: \(error.localizedDescription)")
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
        cell.textLabel?.text = "\(guest.name) - \(guest.email)"
        return cell
    }
}
