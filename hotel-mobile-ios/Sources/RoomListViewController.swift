import UIKit

/// View controller to display available rooms for booking
class RoomListViewController: UIViewController {
    
    private var rooms: [Room] = []
    private var checkInDate = Date()
    private var checkOutDate = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
    private var numberOfGuests = 1
    
    private let tableView = UITableView()
    private let searchHeaderView = UIView()
    private let checkInButton = UIButton(type: .system)
    private let checkOutButton = UIButton(type: .system)
    private let guestsButton = UIButton(type: .system)
    private let searchButton = UIButton(type: .system)
    private let activityIndicator = UIActivityIndicatorView(style: .large)
    
    private let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter
    }()
    
    override func viewDidLoad() {
        super.viewDidLoad()
        
        setupUI()
        setupConstraints()
        loadRooms()
    }
    
    private func setupUI() {
        view.backgroundColor = .systemBackground
        title = "Available Rooms"
        
        // Search Header
        searchHeaderView.backgroundColor = .systemGroupedBackground
        searchHeaderView.translatesAutoresizingMaskIntoConstraints = false
        
        // Check-in Button
        checkInButton.setTitle("Check-in: \(dateFormatter.string(from: checkInDate))", for: .normal)
        checkInButton.titleLabel?.font = .systemFont(ofSize: 14)
        checkInButton.backgroundColor = .white
        checkInButton.setTitleColor(.systemBlue, for: .normal)
        checkInButton.layer.cornerRadius = 8
        checkInButton.layer.borderWidth = 1
        checkInButton.layer.borderColor = UIColor.systemGray4.cgColor
        checkInButton.translatesAutoresizingMaskIntoConstraints = false
        checkInButton.addTarget(self, action: #selector(selectCheckInDate), for: .touchUpInside)
        
        // Check-out Button
        checkOutButton.setTitle("Check-out: \(dateFormatter.string(from: checkOutDate))", for: .normal)
        checkOutButton.titleLabel?.font = .systemFont(ofSize: 14)
        checkOutButton.backgroundColor = .white
        checkOutButton.setTitleColor(.systemBlue, for: .normal)
        checkOutButton.layer.cornerRadius = 8
        checkOutButton.layer.borderWidth = 1
        checkOutButton.layer.borderColor = UIColor.systemGray4.cgColor
        checkOutButton.translatesAutoresizingMaskIntoConstraints = false
        checkOutButton.addTarget(self, action: #selector(selectCheckOutDate), for: .touchUpInside)
        
        // Guests Button
        guestsButton.setTitle("Guests: \(numberOfGuests)", for: .normal)
        guestsButton.titleLabel?.font = .systemFont(ofSize: 14)
        guestsButton.backgroundColor = .white
        guestsButton.setTitleColor(.systemBlue, for: .normal)
        guestsButton.layer.cornerRadius = 8
        guestsButton.layer.borderWidth = 1
        guestsButton.layer.borderColor = UIColor.systemGray4.cgColor
        guestsButton.translatesAutoresizingMaskIntoConstraints = false
        guestsButton.addTarget(self, action: #selector(selectGuests), for: .touchUpInside)
        
        // Search Button
        searchButton.setTitle("Search Rooms", for: .normal)
        searchButton.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        searchButton.backgroundColor = .systemBlue
        searchButton.setTitleColor(.white, for: .normal)
        searchButton.layer.cornerRadius = 8
        searchButton.translatesAutoresizingMaskIntoConstraints = false
        searchButton.addTarget(self, action: #selector(searchRooms), for: .touchUpInside)
        
        // Table View
        tableView.delegate = self
        tableView.dataSource = self
        tableView.register(RoomTableViewCell.self, forCellReuseIdentifier: "RoomCell")
        tableView.rowHeight = UITableView.automaticDimension
        tableView.estimatedRowHeight = 200
        tableView.translatesAutoresizingMaskIntoConstraints = false
        
        // Activity Indicator
        activityIndicator.hidesWhenStopped = true
        activityIndicator.translatesAutoresizingMaskIntoConstraints = false
        
        // Add to view hierarchy
        view.addSubview(searchHeaderView)
        searchHeaderView.addSubview(checkInButton)
        searchHeaderView.addSubview(checkOutButton)
        searchHeaderView.addSubview(guestsButton)
        searchHeaderView.addSubview(searchButton)
        view.addSubview(tableView)
        view.addSubview(activityIndicator)
    }
    
    private func setupConstraints() {
        NSLayoutConstraint.activate([
            searchHeaderView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            searchHeaderView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            searchHeaderView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            searchHeaderView.heightAnchor.constraint(equalToConstant: 160),
            
            checkInButton.topAnchor.constraint(equalTo: searchHeaderView.topAnchor, constant: 16),
            checkInButton.leadingAnchor.constraint(equalTo: searchHeaderView.leadingAnchor, constant: 16),
            checkInButton.trailingAnchor.constraint(equalTo: searchHeaderView.trailingAnchor, constant: -16),
            checkInButton.heightAnchor.constraint(equalToConstant: 40),
            
            checkOutButton.topAnchor.constraint(equalTo: checkInButton.bottomAnchor, constant: 8),
            checkOutButton.leadingAnchor.constraint(equalTo: searchHeaderView.leadingAnchor, constant: 16),
            checkOutButton.trailingAnchor.constraint(equalTo: searchHeaderView.trailingAnchor, constant: -16),
            checkOutButton.heightAnchor.constraint(equalToConstant: 40),
            
            guestsButton.topAnchor.constraint(equalTo: checkOutButton.bottomAnchor, constant: 8),
            guestsButton.leadingAnchor.constraint(equalTo: searchHeaderView.leadingAnchor, constant: 16),
            guestsButton.trailingAnchor.constraint(equalTo: searchHeaderView.centerXAnchor, constant: -4),
            guestsButton.heightAnchor.constraint(equalToConstant: 40),
            
            searchButton.topAnchor.constraint(equalTo: checkOutButton.bottomAnchor, constant: 8),
            searchButton.leadingAnchor.constraint(equalTo: searchHeaderView.centerXAnchor, constant: 4),
            searchButton.trailingAnchor.constraint(equalTo: searchHeaderView.trailingAnchor, constant: -16),
            searchButton.heightAnchor.constraint(equalToConstant: 40),
            
            tableView.topAnchor.constraint(equalTo: searchHeaderView.bottomAnchor),
            tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            
            activityIndicator.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            activityIndicator.centerYAnchor.constraint(equalTo: tableView.centerYAnchor)
        ])
    }
    
    private func loadRooms() {
        activityIndicator.startAnimating()
        
        Task {
            do {
                let rooms = try await APIManager.shared.getAvailableRooms(
                    checkIn: checkInDate,
                    checkOut: checkOutDate,
                    guests: numberOfGuests
                )
                
                await MainActor.run {
                    self.rooms = rooms
                    tableView.reloadData()
                    activityIndicator.stopAnimating()
                }
            } catch {
                await MainActor.run {
                    activityIndicator.stopAnimating()
                    showAlert(title: "Error", message: "Failed to load rooms: \(error.localizedDescription)")
                }
            }
        }
    }
    
    @objc private func selectCheckInDate() {
        showDatePicker(title: "Select Check-in Date", currentDate: checkInDate) { [weak self] date in
            self?.checkInDate = date
            self?.checkInButton.setTitle("Check-in: \(self?.dateFormatter.string(from: date) ?? "")", for: .normal)
        }
    }
    
    @objc private func selectCheckOutDate() {
        showDatePicker(title: "Select Check-out Date", currentDate: checkOutDate) { [weak self] date in
            self?.checkOutDate = date
            self?.checkOutButton.setTitle("Check-out: \(self?.dateFormatter.string(from: date) ?? "")", for: .normal)
        }
    }
    
    @objc private func selectGuests() {
        let alert = UIAlertController(title: "Number of Guests", message: nil, preferredStyle: .actionSheet)
        
        for i in 1...10 {
            alert.addAction(UIAlertAction(title: "\(i) Guest\(i > 1 ? "s" : "")", style: .default) { [weak self] _ in
                self?.numberOfGuests = i
                self?.guestsButton.setTitle("Guests: \(i)", for: .normal)
            })
        }
        
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        
        if let popoverController = alert.popoverPresentationController {
            popoverController.sourceView = guestsButton
            popoverController.sourceRect = guestsButton.bounds
        }
        
        present(alert, animated: true)
    }
    
    @objc private func searchRooms() {
        loadRooms()
    }
    
    private func showDatePicker(title: String, currentDate: Date, completion: @escaping (Date) -> Void) {
        let alert = UIAlertController(title: title, message: "\n\n\n\n\n\n\n\n", preferredStyle: .actionSheet)
        
        let datePicker = UIDatePicker()
        datePicker.datePickerMode = .date
        datePicker.date = currentDate
        datePicker.minimumDate = Date()
        datePicker.preferredDatePickerStyle = .wheels
        datePicker.translatesAutoresizingMaskIntoConstraints = false
        
        alert.view.addSubview(datePicker)
        
        NSLayoutConstraint.activate([
            datePicker.centerXAnchor.constraint(equalTo: alert.view.centerXAnchor),
            datePicker.topAnchor.constraint(equalTo: alert.view.topAnchor, constant: 50)
        ])
        
        alert.addAction(UIAlertAction(title: "Select", style: .default) { _ in
            completion(datePicker.date)
        })
        
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        
        if let popoverController = alert.popoverPresentationController {
            popoverController.sourceView = view
            popoverController.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
            popoverController.permittedArrowDirections = []
        }
        
        present(alert, animated: true)
    }
    
    private func showAlert(title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}

// MARK: - UITableViewDelegate & DataSource
extension RoomListViewController: UITableViewDelegate, UITableViewDataSource {
    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        return rooms.count
    }
    
    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "RoomCell", for: indexPath) as! RoomTableViewCell
        cell.configure(with: rooms[indexPath.row])
        return cell
    }
    
    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        
        let room = rooms[indexPath.row]
        let detailVC = RoomDetailViewController(
            room: room,
            checkInDate: checkInDate,
            checkOutDate: checkOutDate,
            numberOfGuests: numberOfGuests
        )
        navigationController?.pushViewController(detailVC, animated: true)
    }
}

// MARK: - Room Table View Cell
class RoomTableViewCell: UITableViewCell {
    private let roomImageView = UIImageView()
    private let roomTypeLabel = UILabel()
    private let roomDescriptionLabel = UILabel()
    private let priceLabel = UILabel()
    private let amenitiesLabel = UILabel()
    
    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        setupUI()
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    private func setupUI() {
        roomImageView.contentMode = .scaleAspectFill
        roomImageView.clipsToBounds = true
        roomImageView.backgroundColor = .systemGray5
        roomImageView.layer.cornerRadius = 8
        roomImageView.translatesAutoresizingMaskIntoConstraints = false
        
        roomTypeLabel.font = .systemFont(ofSize: 18, weight: .semibold)
        roomTypeLabel.translatesAutoresizingMaskIntoConstraints = false
        
        roomDescriptionLabel.font = .systemFont(ofSize: 14)
        roomDescriptionLabel.textColor = .secondaryLabel
        roomDescriptionLabel.numberOfLines = 2
        roomDescriptionLabel.translatesAutoresizingMaskIntoConstraints = false
        
        priceLabel.font = .systemFont(ofSize: 20, weight: .bold)
        priceLabel.textColor = .systemBlue
        priceLabel.translatesAutoresizingMaskIntoConstraints = false
        
        amenitiesLabel.font = .systemFont(ofSize: 12)
        amenitiesLabel.textColor = .tertiaryLabel
        amenitiesLabel.numberOfLines = 1
        amenitiesLabel.translatesAutoresizingMaskIntoConstraints = false
        
        contentView.addSubview(roomImageView)
        contentView.addSubview(roomTypeLabel)
        contentView.addSubview(roomDescriptionLabel)
        contentView.addSubview(priceLabel)
        contentView.addSubview(amenitiesLabel)
        
        NSLayoutConstraint.activate([
            roomImageView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
            roomImageView.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 12),
            roomImageView.widthAnchor.constraint(equalToConstant: 100),
            roomImageView.heightAnchor.constraint(equalToConstant: 100),
            roomImageView.bottomAnchor.constraint(lessThanOrEqualTo: contentView.bottomAnchor, constant: -12),
            
            roomTypeLabel.leadingAnchor.constraint(equalTo: roomImageView.trailingAnchor, constant: 12),
            roomTypeLabel.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 12),
            roomTypeLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            
            roomDescriptionLabel.leadingAnchor.constraint(equalTo: roomImageView.trailingAnchor, constant: 12),
            roomDescriptionLabel.topAnchor.constraint(equalTo: roomTypeLabel.bottomAnchor, constant: 4),
            roomDescriptionLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            
            amenitiesLabel.leadingAnchor.constraint(equalTo: roomImageView.trailingAnchor, constant: 12),
            amenitiesLabel.topAnchor.constraint(equalTo: roomDescriptionLabel.bottomAnchor, constant: 4),
            amenitiesLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
            
            priceLabel.leadingAnchor.constraint(equalTo: roomImageView.trailingAnchor, constant: 12),
            priceLabel.topAnchor.constraint(equalTo: amenitiesLabel.bottomAnchor, constant: 8),
            priceLabel.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -12)
        ])
    }
    
    func configure(with room: Room) {
        roomTypeLabel.text = "\(room.roomType.rawValue.capitalized) - Room \(room.roomNumber)"
        roomDescriptionLabel.text = room.description
        priceLabel.text = "$\(room.pricePerNight)/night"
        amenitiesLabel.text = room.amenities.prefix(3).joined(separator: " • ")
        
        // Load image if available
        if let imageURLString = room.images.first, let imageURL = URL(string: imageURLString) {
            loadImage(from: imageURL)
        } else {
            roomImageView.image = UIImage(systemName: "bed.double.fill")
            roomImageView.tintColor = .systemGray3
        }
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
}
