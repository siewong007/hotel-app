import UIKit

/// View controller to display user's bookings
class MyBookingsViewController: UIViewController {
    
    private var bookings: [Booking] = []
    private let tableView = UITableView()
    private let activityIndicator = UIActivityIndicatorView(style: .large)
    private let emptyStateLabel = UILabel()
    
    override func viewDidLoad() {
        super.viewDidLoad()
        
        setupUI()
        setupConstraints()
    }
    
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        loadBookings()
    }
    
    private func setupUI() {
        view.backgroundColor = .systemBackground
        title = "My Bookings"
        
        // Table View
        tableView.delegate = self
        tableView.dataSource = self
        tableView.register(BookingTableViewCell.self, forCellReuseIdentifier: "BookingCell")
        tableView.rowHeight = UITableView.automaticDimension
        tableView.estimatedRowHeight = 150
        tableView.translatesAutoresizingMaskIntoConstraints = false
        
        // Activity Indicator
        activityIndicator.hidesWhenStopped = true
        activityIndicator.translatesAutoresizingMaskIntoConstraints = false
        
        // Empty State
        emptyStateLabel.text = "No bookings yet.\nStart exploring available rooms!"
        emptyStateLabel.textAlignment = .center
        emptyStateLabel.textColor = .secondaryLabel
        emptyStateLabel.font = .systemFont(ofSize: 16)
        emptyStateLabel.numberOfLines = 0
        emptyStateLabel.isHidden = true
        emptyStateLabel.translatesAutoresizingMaskIntoConstraints = false
        
        view.addSubview(tableView)
        view.addSubview(activityIndicator)
        view.addSubview(emptyStateLabel)
    }
    
    private func setupConstraints() {
        NSLayoutConstraint.activate([
            tableView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            
            activityIndicator.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            activityIndicator.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            
            emptyStateLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            emptyStateLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            emptyStateLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 40),
            emptyStateLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -40)
        ])
    }
    
    private func loadBookings() {
        guard let user = AuthManager.shared.currentUser,
              let guest = user.guest else {
            showEmptyState()
            return
        }
        
        activityIndicator.startAnimating()
        emptyStateLabel.isHidden = true
        
        Task {
            do {
                let bookings = try await APIManager.shared.getMyBookings(guestId: guest.id)
                
                await MainActor.run {
                    self.bookings = bookings.sorted { $0.checkInDate > $1.checkInDate }
                    tableView.reloadData()
                    activityIndicator.stopAnimating()
                    
                    if bookings.isEmpty {
                        showEmptyState()
                    }
                }
            } catch {
                await MainActor.run {
                    activityIndicator.stopAnimating()
                    showAlert(title: "Error", message: "Failed to load bookings: \(error.localizedDescription)")
                }
            }
        }
    }
    
    private func showEmptyState() {
        emptyStateLabel.isHidden = false
        tableView.isHidden = true
    }
    
    private func showAlert(title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}

// MARK: - UITableViewDelegate & DataSource
extension MyBookingsViewController: UITableViewDelegate, UITableViewDataSource {
    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        return bookings.count
    }
    
    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "BookingCell", for: indexPath) as! BookingTableViewCell
        cell.configure(with: bookings[indexPath.row])
        return cell
    }
    
    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        
        let booking = bookings[indexPath.row]
        let detailVC = BookingDetailViewController(bookingId: booking.id)
        navigationController?.pushViewController(detailVC, animated: true)
    }
    
    func tableView(_ tableView: UITableView, trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        let booking = bookings[indexPath.row]
        
        // Only allow cancellation for pending or confirmed bookings
        guard booking.status == .pending || booking.status == .confirmed else {
            return nil
        }
        
        let cancelAction = UIContextualAction(style: .destructive, title: "Cancel") { [weak self] _, _, completion in
            self?.cancelBooking(at: indexPath)
            completion(true)
        }
        
        cancelAction.backgroundColor = .systemRed
        
        return UISwipeActionsConfiguration(actions: [cancelAction])
    }
    
    private func cancelBooking(at indexPath: IndexPath) {
        let booking = bookings[indexPath.row]
        
        let alert = UIAlertController(
            title: "Cancel Booking",
            message: "Are you sure you want to cancel this booking?",
            preferredStyle: .alert
        )
        
        alert.addAction(UIAlertAction(title: "Cancel Booking", style: .destructive) { [weak self] _ in
            self?.performCancellation(bookingId: booking.id, at: indexPath)
        })
        
        alert.addAction(UIAlertAction(title: "Keep Booking", style: .cancel))
        
        present(alert, animated: true)
    }
    
    private func performCancellation(bookingId: String, at indexPath: IndexPath) {
        Task {
            do {
                _ = try await APIManager.shared.cancelBooking(bookingId: bookingId)
                
                await MainActor.run {
                    loadBookings() // Reload to get updated status
                    showAlert(title: "Success", message: "Booking cancelled successfully")
                }
            } catch {
                await MainActor.run {
                    showAlert(title: "Error", message: "Failed to cancel booking: \(error.localizedDescription)")
                }
            }
        }
    }
}

// MARK: - Booking Table View Cell
class BookingTableViewCell: UITableViewCell {
    private let statusBadge = UIView()
    private let statusLabel = UILabel()
    private let bookingIdLabel = UILabel()
    private let datesLabel = UILabel()
    private let amountLabel = UILabel()
    
    private let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter
    }()
    
    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        setupUI()
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    private func setupUI() {
        // Status Badge
        statusBadge.layer.cornerRadius = 4
        statusBadge.translatesAutoresizingMaskIntoConstraints = false
        
        statusLabel.font = .systemFont(ofSize: 12, weight: .semibold)
        statusLabel.textColor = .white
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        
        // Booking ID
        bookingIdLabel.font = .systemFont(ofSize: 16, weight: .semibold)
        bookingIdLabel.translatesAutoresizingMaskIntoConstraints = false
        
        // Dates
        datesLabel.font = .systemFont(ofSize: 14)
        datesLabel.textColor = .secondaryLabel
        datesLabel.numberOfLines = 2
        datesLabel.translatesAutoresizingMaskIntoConstraints = false
        
        // Amount
        amountLabel.font = .systemFont(ofSize: 18, weight: .bold)
        amountLabel.textColor = .systemBlue
        amountLabel.translatesAutoresizingMaskIntoConstraints = false
        
        statusBadge.addSubview(statusLabel)
        contentView.addSubview(statusBadge)
        contentView.addSubview(bookingIdLabel)
        contentView.addSubview(datesLabel)
        contentView.addSubview(amountLabel)
        
        NSLayoutConstraint.activate([
            statusBadge.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 12),
            statusBadge.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            
            statusLabel.topAnchor.constraint(equalTo: statusBadge.topAnchor, constant: 4),
            statusLabel.leadingAnchor.constraint(equalTo: statusBadge.leadingAnchor, constant: 8),
            statusLabel.trailingAnchor.constraint(equalTo: statusBadge.trailingAnchor, constant: -8),
            statusLabel.bottomAnchor.constraint(equalTo: statusBadge.bottomAnchor, constant: -4),
            
            bookingIdLabel.topAnchor.constraint(equalTo: statusBadge.bottomAnchor, constant: 8),
            bookingIdLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            bookingIdLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            
            datesLabel.topAnchor.constraint(equalTo: bookingIdLabel.bottomAnchor, constant: 4),
            datesLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            datesLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            
            amountLabel.topAnchor.constraint(equalTo: datesLabel.bottomAnchor, constant: 8),
            amountLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            amountLabel.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -12)
        ])
    }
    
    func configure(with booking: Booking) {
        bookingIdLabel.text = "Booking #\(booking.id.prefix(8))"
        datesLabel.text = "Check-in: \(dateFormatter.string(from: booking.checkInDate))\nCheck-out: \(dateFormatter.string(from: booking.checkOutDate))"
        amountLabel.text = "$\(booking.totalAmount)"
        
        // Configure status
        statusLabel.text = booking.status.rawValue.uppercased()
        
        switch booking.status {
        case .pending:
            statusBadge.backgroundColor = .systemOrange
        case .confirmed:
            statusBadge.backgroundColor = .systemGreen
        case .checkedIn:
            statusBadge.backgroundColor = .systemBlue
        case .checkedOut:
            statusBadge.backgroundColor = .systemGray
        case .cancelled:
            statusBadge.backgroundColor = .systemRed
        }
    }
}
