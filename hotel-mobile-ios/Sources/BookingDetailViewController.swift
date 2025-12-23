import UIKit

/// Detail view for a specific booking
class BookingDetailViewController: UIViewController {
    
    private let bookingId: String
    private var bookingResponse: BookingResponse?
    
    private let scrollView = UIScrollView()
    private let contentView = UIView()
    
    private let statusBadge = UIView()
    private let statusLabel = UILabel()
    private let bookingIdLabel = UILabel()
    
    private let roomImageView = UIImageView()
    private let roomTitleLabel = UILabel()
    
    private let detailsStackView = UIStackView()
    
    private let activityIndicator = UIActivityIndicatorView(style: .large)
    
    private let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()
    
    init(bookingId: String) {
        self.bookingId = bookingId
        super.init(nibName: nil, bundle: nil)
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    override func viewDidLoad() {
        super.viewDidLoad()
        
        setupUI()
        setupConstraints()
        loadBookingDetails()
    }
    
    private func setupUI() {
        view.backgroundColor = .systemBackground
        title = "Booking Details"
        
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        contentView.translatesAutoresizingMaskIntoConstraints = false
        
        // Status Badge
        statusBadge.layer.cornerRadius = 8
        statusBadge.translatesAutoresizingMaskIntoConstraints = false
        
        statusLabel.font = .systemFont(ofSize: 16, weight: .semibold)
        statusLabel.textColor = .white
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        
        statusBadge.addSubview(statusLabel)
        
        // Booking ID
        bookingIdLabel.font = .systemFont(ofSize: 14)
        bookingIdLabel.textColor = .secondaryLabel
        bookingIdLabel.translatesAutoresizingMaskIntoConstraints = false
        
        // Room Image
        roomImageView.contentMode = .scaleAspectFill
        roomImageView.clipsToBounds = true
        roomImageView.backgroundColor = .systemGray5
        roomImageView.layer.cornerRadius = 12
        roomImageView.translatesAutoresizingMaskIntoConstraints = false
        
        // Room Title
        roomTitleLabel.font = .systemFont(ofSize: 20, weight: .bold)
        roomTitleLabel.numberOfLines = 0
        roomTitleLabel.translatesAutoresizingMaskIntoConstraints = false
        
        // Details Stack
        detailsStackView.axis = .vertical
        detailsStackView.spacing = 16
        detailsStackView.translatesAutoresizingMaskIntoConstraints = false
        
        // Activity Indicator
        activityIndicator.hidesWhenStopped = true
        activityIndicator.translatesAutoresizingMaskIntoConstraints = false
        
        // Add to view hierarchy
        view.addSubview(scrollView)
        scrollView.addSubview(contentView)
        
        contentView.addSubview(statusBadge)
        contentView.addSubview(bookingIdLabel)
        contentView.addSubview(roomImageView)
        contentView.addSubview(roomTitleLabel)
        contentView.addSubview(detailsStackView)
        view.addSubview(activityIndicator)
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
            
            statusBadge.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 20),
            statusBadge.centerXAnchor.constraint(equalTo: contentView.centerXAnchor),
            
            statusLabel.topAnchor.constraint(equalTo: statusBadge.topAnchor, constant: 8),
            statusLabel.leadingAnchor.constraint(equalTo: statusBadge.leadingAnchor, constant: 16),
            statusLabel.trailingAnchor.constraint(equalTo: statusBadge.trailingAnchor, constant: -16),
            statusLabel.bottomAnchor.constraint(equalTo: statusBadge.bottomAnchor, constant: -8),
            
            bookingIdLabel.topAnchor.constraint(equalTo: statusBadge.bottomAnchor, constant: 8),
            bookingIdLabel.centerXAnchor.constraint(equalTo: contentView.centerXAnchor),
            
            roomImageView.topAnchor.constraint(equalTo: bookingIdLabel.bottomAnchor, constant: 20),
            roomImageView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            roomImageView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            roomImageView.heightAnchor.constraint(equalToConstant: 200),
            
            roomTitleLabel.topAnchor.constraint(equalTo: roomImageView.bottomAnchor, constant: 16),
            roomTitleLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            roomTitleLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            
            detailsStackView.topAnchor.constraint(equalTo: roomTitleLabel.bottomAnchor, constant: 24),
            detailsStackView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            detailsStackView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            detailsStackView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -30),
            
            activityIndicator.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            activityIndicator.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
    }
    
    private func loadBookingDetails() {
        activityIndicator.startAnimating()
        
        Task {
            do {
                let response = try await APIManager.shared.getBookingDetails(bookingId: bookingId)
                
                await MainActor.run {
                    self.bookingResponse = response
                    configureView(with: response)
                    activityIndicator.stopAnimating()
                }
            } catch {
                await MainActor.run {
                    activityIndicator.stopAnimating()
                    showAlert(title: "Error", message: "Failed to load booking details: \(error.localizedDescription)")
                }
            }
        }
    }
    
    private func configureView(with response: BookingResponse) {
        let booking = response.booking
        let room = response.room
        let guest = response.guest
        
        // Status
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
        
        // Booking ID
        bookingIdLabel.text = "Booking ID: \(booking.id)"
        
        // Room
        roomTitleLabel.text = "\(room.roomType.rawValue.capitalized) - Room \(room.roomNumber)"
        
        if let imageURLString = room.images.first, let imageURL = URL(string: imageURLString) {
            loadImage(from: imageURL)
        } else {
            roomImageView.image = UIImage(systemName: "bed.double.fill")
            roomImageView.tintColor = .systemGray3
        }
        
        // Details
        detailsStackView.addArrangedSubview(createDetailRow(label: "Guest", value: guest.fullName))
        detailsStackView.addArrangedSubview(createDetailRow(label: "Check-in", value: dateFormatter.string(from: booking.checkInDate)))
        detailsStackView.addArrangedSubview(createDetailRow(label: "Check-out", value: dateFormatter.string(from: booking.checkOutDate)))
        detailsStackView.addArrangedSubview(createDetailRow(label: "Nights", value: "\(booking.numberOfNights)"))
        detailsStackView.addArrangedSubview(createDetailRow(label: "Guests", value: "\(booking.numberOfGuests)"))
        detailsStackView.addArrangedSubview(createDetailRow(label: "Total Amount", value: "$\(booking.totalAmount)"))
        detailsStackView.addArrangedSubview(createDetailRow(label: "Payment Status", value: booking.paymentStatus.rawValue.capitalized))
        
        if let specialRequests = booking.specialRequests, !specialRequests.isEmpty {
            detailsStackView.addArrangedSubview(createDetailRow(label: "Special Requests", value: specialRequests))
        }
        
        detailsStackView.addArrangedSubview(createDetailRow(label: "Booked On", value: dateFormatter.string(from: booking.createdAt)))
    }
    
    private func createDetailRow(label: String, value: String) -> UIView {
        let container = UIView()
        container.backgroundColor = .systemGroupedBackground
        container.layer.cornerRadius = 8
        
        let labelView = UILabel()
        labelView.text = label
        labelView.font = .systemFont(ofSize: 14, weight: .medium)
        labelView.textColor = .secondaryLabel
        labelView.translatesAutoresizingMaskIntoConstraints = false
        
        let valueView = UILabel()
        valueView.text = value
        valueView.font = .systemFont(ofSize: 16)
        valueView.numberOfLines = 0
        valueView.textAlignment = .right
        valueView.translatesAutoresizingMaskIntoConstraints = false
        
        container.addSubview(labelView)
        container.addSubview(valueView)
        
        NSLayoutConstraint.activate([
            container.heightAnchor.constraint(greaterThanOrEqualToConstant: 50),
            
            labelView.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 16),
            labelView.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            labelView.widthAnchor.constraint(equalTo: container.widthAnchor, multiplier: 0.4),
            
            valueView.leadingAnchor.constraint(equalTo: labelView.trailingAnchor, constant: 8),
            valueView.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -16),
            valueView.topAnchor.constraint(equalTo: container.topAnchor, constant: 12),
            valueView.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -12)
        ])
        
        return container
    }
    
    private func loadImage(from url: URL) {
        Task {
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                if let image = UIImage(data: data) {
                    await MainActor.run {
                        self.roomImageView.image = image
                    }
                }
            } catch {
                await MainActor.run {
                    self.roomImageView.image = UIImage(systemName: "bed.double.fill")
                    self.roomImageView.tintColor = .systemGray3
                }
            }
        }
    }
    
    private func showAlert(title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in
            self?.navigationController?.popViewController(animated: true)
        })
        present(alert, animated: true)
    }
}
