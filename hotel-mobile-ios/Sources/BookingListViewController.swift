import UIKit
import SwiftUI

class BookingListViewController: UIViewController {

    private let tableView = UITableView()
    private var bookings: [BookingWithDetails] = []
    private let refreshControl = UIRefreshControl()

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Bookings"
        setupUI()
        loadBookings()
    }
    
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        loadBookings()
    }

    private func setupUI() {
        view.backgroundColor = .systemBackground
        
        // Filter button
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            title: "Filter",
            style: .plain,
            target: self,
            action: #selector(filterTapped)
        )

        tableView.translatesAutoresizingMaskIntoConstraints = false
        tableView.register(BookingCell.self, forCellReuseIdentifier: "BookingCell")
        tableView.dataSource = self
        tableView.delegate = self
        tableView.refreshControl = refreshControl
        
        refreshControl.addTarget(self, action: #selector(refreshBookings), for: .valueChanged)

        view.addSubview(tableView)

        NSLayoutConstraint.activate([
            tableView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
    }
    
    @objc private func refreshBookings() {
        loadBookings()
    }
    
    @objc private func filterTapped() {
        let alert = UIAlertController(title: "Filter Bookings", message: "Select status", preferredStyle: .actionSheet)
        
        alert.addAction(UIAlertAction(title: "All", style: .default) { [weak self] _ in
            self?.loadBookings()
        })
        alert.addAction(UIAlertAction(title: "Confirmed", style: .default) { [weak self] _ in
            self?.filterByStatus("confirmed")
        })
        alert.addAction(UIAlertAction(title: "Cancelled", style: .default) { [weak self] _ in
            self?.filterByStatus("cancelled")
        })
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        
        present(alert, animated: true)
    }
    
    private func filterByStatus(_ status: String) {
        Task {
            do {
                let allBookings = try await HotelAPIService.shared.getAllBookings()
                self.bookings = allBookings.filter { $0.status == status }
                await MainActor.run {
                    tableView.reloadData()
                }
            } catch {
                await MainActor.run {
                    showError("Failed to filter bookings: \(error.localizedDescription)")
                }
            }
        }
    }

    private func loadBookings() {
        Task {
            do {
                self.bookings = try await HotelAPIService.shared.getAllBookings()
                await MainActor.run {
                    tableView.reloadData()
                    refreshControl.endRefreshing()
                }
            } catch {
                await MainActor.run {
                    refreshControl.endRefreshing()
                    showError("Failed to load bookings: \(error.localizedDescription)")
                }
            }
        }
    }
    
    private func cancelBooking(id: String) {
        Task {
            do {
                _ = try await HotelAPIService.shared.cancelBooking(id: id)
                await MainActor.run {
                    loadBookings()
                }
            } catch {
                await MainActor.run {
                    showError("Failed to cancel booking: \(error.localizedDescription)")
                }
            }
        }
    }
    
    private func deleteBooking(id: String) {
        Task {
            do {
                try await HotelAPIService.shared.deleteBooking(id: id)
                await MainActor.run {
                    loadBookings()
                }
            } catch {
                await MainActor.run {
                    showError("Failed to delete booking: \(error.localizedDescription)")
                }
            }
        }
    }

    private func showError(_ message: String) {
        let alert = UIAlertController(title: "Error", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }

    private func performEnhancedCheckIn(for booking: BookingWithDetails) {
        Task {
            do {
                // Fetch guest details
                let guest = try await HotelAPIService.shared.getGuest(id: String(booking.guestId))

                await MainActor.run {
                    // Create SwiftUI view
                    let checkInView = EnhancedCheckInView(booking: booking, guest: guest)
                    let hostingController = UIHostingController(rootView: checkInView)
                    hostingController.modalPresentationStyle = .fullScreen

                    // Present the check-in view
                    self.present(hostingController, animated: true)
                }
            } catch {
                await MainActor.run {
                    showError("Failed to load guest details: \(error.localizedDescription)")
                }
            }
        }
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

extension BookingListViewController: UITableViewDelegate {
    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        let booking = bookings[indexPath.row]
        showBookingDetails(booking)
    }
    
    func tableView(_ tableView: UITableView, trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        let booking = bookings[indexPath.row]

        var actions: [UIContextualAction] = []

        // Check-In action (only for confirmed bookings)
        if booking.status == "confirmed" {
            let checkInAction = UIContextualAction(style: .normal, title: "Check In") { [weak self] _, _, completion in
                self?.performEnhancedCheckIn(for: booking)
                completion(true)
            }
            checkInAction.backgroundColor = UIColor.systemGreen
            actions.append(checkInAction)
        }

        // Cancel action (only for confirmed bookings)
        if booking.status == "confirmed" {
            let cancelAction = UIContextualAction(style: .normal, title: "Cancel") { [weak self] _, _, completion in
                let alert = UIAlertController(
                    title: "Cancel Booking",
                    message: "Are you sure you want to cancel this booking?",
                    preferredStyle: .alert
                )

                alert.addAction(UIAlertAction(title: "Cancel Booking", style: .destructive) { _ in
                    self?.cancelBooking(id: String(booking.id))
                    completion(true)
                })
                alert.addAction(UIAlertAction(title: "Keep", style: .cancel) { _ in
                    completion(false)
                })

                self?.present(alert, animated: true)
            }
            cancelAction.backgroundColor = UIColor.systemOrange
            actions.append(cancelAction)
        }

        // Delete action
        let deleteAction = UIContextualAction(style: .destructive, title: "Delete") { [weak self] _, _, completion in
            let alert = UIAlertController(
                title: "Delete Booking",
                message: "Are you sure you want to permanently delete this booking?",
                preferredStyle: .alert
            )

            alert.addAction(UIAlertAction(title: "Delete", style: .destructive) { _ in
                self?.deleteBooking(id: String(booking.id))
                completion(true)
            })
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in
                completion(false)
            })

            self?.present(alert, animated: true)
        }
        actions.append(deleteAction)

        return UISwipeActionsConfiguration(actions: actions)
    }
    
    private func showBookingDetails(_ booking: BookingWithDetails) {
        let details = """
        Room: \(booking.roomNumber) (\(booking.roomType))
        Guest: \(booking.guestName)
        Email: \(booking.guestEmail)
        Check-in: \(booking.checkInDate)
        Check-out: \(booking.checkOutDate)
        Total: \(booking.totalAmountString)
        Status: \(booking.status.capitalized)
        """

        let alert = UIAlertController(title: "Booking Details", message: details, preferredStyle: .alert)

        if booking.status == "confirmed" {
            // Enhanced Check-In button
            alert.addAction(UIAlertAction(title: "Enhanced Check-In", style: .default) { [weak self] _ in
                self?.performEnhancedCheckIn(for: booking)
            })

            alert.addAction(UIAlertAction(title: "Cancel Booking", style: .destructive) { [weak self] _ in
                self?.cancelBooking(id: String(booking.id))
            })
        }

        alert.addAction(UIAlertAction(title: "Close", style: .cancel))
        present(alert, animated: true)
    }
}

class BookingCell: UITableViewCell {
    private let roomLabel = UILabel()
    private let datesLabel = UILabel()
    private let guestLabel = UILabel()
    private let statusLabel = UILabel()
    private let priceLabel = UILabel()

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        setupUI()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private func setupUI() {
        let topStack = UIStackView(arrangedSubviews: [roomLabel, priceLabel])
        topStack.axis = .horizontal
        topStack.distribution = .equalSpacing
        
        let stack = UIStackView(arrangedSubviews: [topStack, guestLabel, datesLabel, statusLabel])
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
        roomLabel.text = "Room \(booking.roomNumber)"
        roomLabel.font = .systemFont(ofSize: 18, weight: .semibold)

        priceLabel.text = booking.totalAmountString
        priceLabel.font = .systemFont(ofSize: 16, weight: .medium)
        priceLabel.textColor = .systemGreen

        guestLabel.text = "\(booking.guestName)"
        guestLabel.font = .systemFont(ofSize: 14)
        guestLabel.textColor = .secondaryLabel

        datesLabel.text = "\(booking.checkInDate) → \(booking.checkOutDate)"
        datesLabel.font = .systemFont(ofSize: 14)
        
        statusLabel.text = "Status: \(booking.status.capitalized)"
        statusLabel.font = .systemFont(ofSize: 13)
        
        // Color code status
        switch booking.status.lowercased() {
        case "confirmed":
            statusLabel.textColor = .systemGreen
        case "cancelled":
            statusLabel.textColor = .systemRed
        default:
            statusLabel.textColor = .systemOrange
        }
    }
}
