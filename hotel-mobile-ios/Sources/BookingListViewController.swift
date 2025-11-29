import UIKit

class BookingListViewController: UIViewController {

    private let tableView = UITableView()
    private var bookings: [BookingWithDetails] = []

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Bookings"
        setupUI()
        loadBookings()
    }

    private func setupUI() {
        view.backgroundColor = .systemBackground

        tableView.translatesAutoresizingMaskIntoConstraints = false
        tableView.register(BookingCell.self, forCellReuseIdentifier: "BookingCell")
        tableView.dataSource = self

        view.addSubview(tableView)

        NSLayoutConstraint.activate([
            tableView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
    }

    private func loadBookings() {
        Task {
            do {
                self.bookings = try await HotelAPIService.shared.getAllBookings()
                await MainActor.run {
                    tableView.reloadData()
                }
            } catch {
                await MainActor.run {
                    showError("Failed to load bookings: \(error.localizedDescription)")
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

extension BookingListViewController: UITableViewDataSource {
    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        return bookings.count
    }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "BookingCell", for: indexPath) as! BookingCell
        let booking = bookings[indexPath.row]
        cell.configure(with: booking)
        return cell
    }
}

class BookingCell: UITableViewCell {
    private let roomLabel = UILabel()
    private let datesLabel = UILabel()
    private let guestLabel = UILabel()

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        setupUI()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private func setupUI() {
        let stack = UIStackView(arrangedSubviews: [roomLabel, guestLabel, datesLabel])
        stack.axis = .vertical
        stack.spacing = 4
        stack.translatesAutoresizingMaskIntoConstraints = false

        contentView.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            stack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 12),
            stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -12)
        ])
    }

    func configure(with booking: BookingWithDetails) {
        roomLabel.text = "Room \(booking.room_number) - \(booking.room_type)"
        roomLabel.font = .systemFont(ofSize: 18, weight: .semibold)

        guestLabel.text = "\(booking.guest_name) (\(booking.guest_email))"
        guestLabel.font = .systemFont(ofSize: 14)

        datesLabel.text = "\(booking.checkInDate) to \(booking.checkOutDate)"
        datesLabel.font = .systemFont(ofSize: 14)
    }
}
