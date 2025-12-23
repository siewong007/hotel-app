import UIKit

/// Detail view for a specific room with booking capability
class RoomDetailViewController: UIViewController {
    
    private let room: Room
    private let checkInDate: Date
    private let checkOutDate: Date
    private let numberOfGuests: Int
    
    private let scrollView = UIScrollView()
    private let contentView = UIView()
    private let imageView = UIImageView()
    private let roomTitleLabel = UILabel()
    private let priceLabel = UILabel()
    private let descriptionLabel = UILabel()
    private let amenitiesStackView = UIStackView()
    private let bookButton = UIButton(type: .system)
    private let activityIndicator = UIActivityIndicatorView(style: .medium)
    
    init(room: Room, checkInDate: Date, checkOutDate: Date, numberOfGuests: Int) {
        self.room = room
        self.checkInDate = checkInDate
        self.checkOutDate = checkOutDate
        self.numberOfGuests = numberOfGuests
        super.init(nibName: nil, bundle: nil)
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    override func viewDidLoad() {
        super.viewDidLoad()
        
        setupUI()
        setupConstraints()
        configureWithRoom()
    }
    
    private func setupUI() {
        view.backgroundColor = .systemBackground
        title = "Room Details"
        
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        contentView.translatesAutoresizingMaskIntoConstraints = false
        
        // Image View
        imageView.contentMode = .scaleAspectFill
        imageView.clipsToBounds = true
        imageView.backgroundColor = .systemGray5
        imageView.translatesAutoresizingMaskIntoConstraints = false
        
        // Room Title
        roomTitleLabel.font = .systemFont(ofSize: 24, weight: .bold)
        roomTitleLabel.numberOfLines = 0
        roomTitleLabel.translatesAutoresizingMaskIntoConstraints = false
        
        // Price Label
        priceLabel.font = .systemFont(ofSize: 28, weight: .bold)
        priceLabel.textColor = .systemBlue
        priceLabel.translatesAutoresizingMaskIntoConstraints = false
        
        // Description
        descriptionLabel.font = .systemFont(ofSize: 16)
        descriptionLabel.textColor = .secondaryLabel
        descriptionLabel.numberOfLines = 0
        descriptionLabel.translatesAutoresizingMaskIntoConstraints = false
        
        // Amenities Stack View
        amenitiesStackView.axis = .vertical
        amenitiesStackView.spacing = 8
        amenitiesStackView.translatesAutoresizingMaskIntoConstraints = false
        
        // Book Button
        bookButton.setTitle("Book Now", for: .normal)
        bookButton.titleLabel?.font = .systemFont(ofSize: 18, weight: .semibold)
        bookButton.backgroundColor = .systemBlue
        bookButton.setTitleColor(.white, for: .normal)
        bookButton.layer.cornerRadius = 12
        bookButton.translatesAutoresizingMaskIntoConstraints = false
        bookButton.addTarget(self, action: #selector(bookNowTapped), for: .touchUpInside)
        
        // Activity Indicator
        activityIndicator.hidesWhenStopped = true
        activityIndicator.translatesAutoresizingMaskIntoConstraints = false
        
        // Add to view hierarchy
        view.addSubview(scrollView)
        scrollView.addSubview(contentView)
        
        contentView.addSubview(imageView)
        contentView.addSubview(roomTitleLabel)
        contentView.addSubview(priceLabel)
        contentView.addSubview(descriptionLabel)
        contentView.addSubview(amenitiesStackView)
        contentView.addSubview(bookButton)
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
            
            imageView.topAnchor.constraint(equalTo: contentView.topAnchor),
            imageView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            imageView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            imageView.heightAnchor.constraint(equalToConstant: 250),
            
            roomTitleLabel.topAnchor.constraint(equalTo: imageView.bottomAnchor, constant: 20),
            roomTitleLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            roomTitleLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            
            priceLabel.topAnchor.constraint(equalTo: roomTitleLabel.bottomAnchor, constant: 8),
            priceLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            
            descriptionLabel.topAnchor.constraint(equalTo: priceLabel.bottomAnchor, constant: 20),
            descriptionLabel.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            descriptionLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            
            amenitiesStackView.topAnchor.constraint(equalTo: descriptionLabel.bottomAnchor, constant: 20),
            amenitiesStackView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            amenitiesStackView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            
            bookButton.topAnchor.constraint(equalTo: amenitiesStackView.bottomAnchor, constant: 30),
            bookButton.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            bookButton.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            bookButton.heightAnchor.constraint(equalToConstant: 50),
            bookButton.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -30),
            
            activityIndicator.centerXAnchor.constraint(equalTo: bookButton.centerXAnchor),
            activityIndicator.centerYAnchor.constraint(equalTo: bookButton.centerYAnchor)
        ])
    }
    
    private func configureWithRoom() {
        roomTitleLabel.text = "\(room.roomType.rawValue.capitalized) - Room \(room.roomNumber)"
        
        let nights = Calendar.current.dateComponents([.day], from: checkInDate, to: checkOutDate).day ?? 1
        let totalPrice = room.pricePerNight * Decimal(nights)
        priceLabel.text = "$\(totalPrice) total ($\(room.pricePerNight)/night x \(nights) nights)"
        
        descriptionLabel.text = room.description
        
        // Add amenities
        let amenitiesTitle = UILabel()
        amenitiesTitle.text = "Amenities"
        amenitiesTitle.font = .systemFont(ofSize: 18, weight: .semibold)
        amenitiesStackView.addArrangedSubview(amenitiesTitle)
        
        for amenity in room.amenities {
            let amenityView = createAmenityView(amenity: amenity)
            amenitiesStackView.addArrangedSubview(amenityView)
        }
        
        // Load image
        if let imageURLString = room.images.first, let imageURL = URL(string: imageURLString) {
            loadImage(from: imageURL)
        } else {
            imageView.image = UIImage(systemName: "bed.double.fill")
            imageView.tintColor = .systemGray3
        }
    }
    
    private func createAmenityView(amenity: String) -> UIView {
        let container = UIView()
        
        let icon = UIImageView(image: UIImage(systemName: "checkmark.circle.fill"))
        icon.tintColor = .systemGreen
        icon.translatesAutoresizingMaskIntoConstraints = false
        
        let label = UILabel()
        label.text = amenity
        label.font = .systemFont(ofSize: 14)
        label.translatesAutoresizingMaskIntoConstraints = false
        
        container.addSubview(icon)
        container.addSubview(label)
        
        NSLayoutConstraint.activate([
            icon.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            icon.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 20),
            icon.heightAnchor.constraint(equalToConstant: 20),
            
            label.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 8),
            label.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            label.topAnchor.constraint(equalTo: container.topAnchor),
            label.bottomAnchor.constraint(equalTo: container.bottomAnchor)
        ])
        
        return container
    }
    
    @objc private func bookNowTapped() {
        // Check if user needs eKYC verification
        guard let user = AuthManager.shared.currentUser else {
            showAlert(title: "Not Authenticated", message: "Please log in to book a room")
            return
        }
        
        guard let guest = user.guest else {
            showAlert(title: "Error", message: "Guest information not found")
            return
        }
        
        // Check eKYC status
        if guest.eKYCStatus != .verified {
            showEKYCRequiredAlert()
            return
        }
        
        // Proceed with booking
        createBooking(guestId: guest.id)
    }
    
    private func createBooking(guestId: String) {
        setLoading(true)
        
        Task {
            do {
                let booking = try await APIManager.shared.createBooking(
                    guestId: guestId,
                    roomId: room.id,
                    checkIn: checkInDate,
                    checkOut: checkOutDate,
                    numberOfGuests: numberOfGuests,
                    specialRequests: nil
                )
                
                await MainActor.run {
                    setLoading(false)
                    showBookingConfirmation(booking: booking)
                }
            } catch {
                await MainActor.run {
                    setLoading(false)
                    showAlert(title: "Booking Failed", message: error.localizedDescription)
                }
            }
        }
    }
    
    private func showEKYCRequiredAlert() {
        let alert = UIAlertController(
            title: "Verification Required",
            message: "You need to complete eKYC verification before booking a room. Would you like to start the verification process?",
            preferredStyle: .alert
        )
        
        alert.addAction(UIAlertAction(title: "Verify Now", style: .default) { [weak self] _ in
            self?.navigateToEKYC()
        })
        
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        
        present(alert, animated: true)
    }
    
    private func navigateToEKYC() {
        let ekycVC = EKYCViewController()
        navigationController?.pushViewController(ekycVC, animated: true)
    }
    
    private func showBookingConfirmation(booking: Booking) {
        let alert = UIAlertController(
            title: "Booking Confirmed!",
            message: "Your booking has been confirmed. Booking ID: \(booking.id)",
            preferredStyle: .alert
        )
        
        alert.addAction(UIAlertAction(title: "View My Bookings", style: .default) { [weak self] _ in
            self?.navigationController?.tabBarController?.selectedIndex = 1
            self?.navigationController?.popToRootViewController(animated: false)
        })
        
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in
            self?.navigationController?.popViewController(animated: true)
        })
        
        present(alert, animated: true)
    }
    
    private func loadImage(from url: URL) {
        Task {
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                if let image = UIImage(data: data) {
                    await MainActor.run {
                        self.imageView.image = image
                    }
                }
            } catch {
                await MainActor.run {
                    self.imageView.image = UIImage(systemName: "bed.double.fill")
                    self.imageView.tintColor = .systemGray3
                }
            }
        }
    }
    
    private func setLoading(_ loading: Bool) {
        bookButton.isEnabled = !loading
        
        if loading {
            activityIndicator.startAnimating()
            bookButton.setTitle("", for: .normal)
        } else {
            activityIndicator.stopAnimating()
            bookButton.setTitle("Book Now", for: .normal)
        }
    }
    
    private func showAlert(title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}
