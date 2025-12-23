import UIKit

class RoomSearchViewController: UIViewController {

    private let searchButton = UIButton(type: .system)
    private let roomTypeTextField = UITextField()
    private let maxPriceTextField = UITextField()
    private let tableView = UITableView()
    private let guestNameTextField = UITextField()
    private let guestEmailTextField = UITextField()
    private let bookButton = UIButton(type: .system)

    private var rooms: [Room] = []
    private var guests: [Guest] = []
    private var selectedRoom: Room?

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Room Search"
        setupUI()
        loadData()
    }

    private func setupUI() {
        view.backgroundColor = .systemBackground

        // Search section
        let searchStack = UIStackView()
        searchStack.axis = .vertical
        searchStack.spacing = 16
        searchStack.translatesAutoresizingMaskIntoConstraints = false

        let roomTypeLabel = UILabel()
        roomTypeLabel.text = "Room Type (Optional):"
        roomTypeLabel.font = .systemFont(ofSize: 16)
        roomTypeTextField.borderStyle = .roundedRect
        roomTypeTextField.placeholder = "e.g., Deluxe, Standard, Suite"

        let maxPriceLabel = UILabel()
        maxPriceLabel.text = "Max Price (Optional):"
        maxPriceLabel.font = .systemFont(ofSize: 16)
        maxPriceTextField.borderStyle = .roundedRect
        maxPriceTextField.placeholder = "e.g., 200"
        maxPriceTextField.keyboardType = .decimalPad

        searchButton.setTitle("Search Rooms", for: .normal)
        searchButton.backgroundColor = .systemBlue
        searchButton.setTitleColor(.white, for: .normal)
        searchButton.layer.cornerRadius = 8
        searchButton.addTarget(self, action: #selector(searchRooms), for: .touchUpInside)

        searchStack.addArrangedSubview(roomTypeLabel)
        searchStack.addArrangedSubview(roomTypeTextField)
        searchStack.addArrangedSubview(maxPriceLabel)
        searchStack.addArrangedSubview(maxPriceTextField)
        searchStack.addArrangedSubview(searchButton)

        // Table view
        tableView.translatesAutoresizingMaskIntoConstraints = false
        tableView.register(RoomCell.self, forCellReuseIdentifier: "RoomCell")
        tableView.dataSource = self
        tableView.delegate = self

        // Booking section
        let bookingStack = UIStackView()
        bookingStack.axis = .vertical
        bookingStack.spacing = 12
        bookingStack.translatesAutoresizingMaskIntoConstraints = false

        let guestNameLabel = UILabel()
        guestNameLabel.text = "Guest Name:"
        guestNameLabel.font = .systemFont(ofSize: 16)
        guestNameTextField.borderStyle = .roundedRect
        guestNameTextField.placeholder = "Enter guest name"

        let guestEmailLabel = UILabel()
        guestEmailLabel.text = "Guest Email:"
        guestEmailLabel.font = .systemFont(ofSize: 16)
        guestEmailTextField.borderStyle = .roundedRect
        guestEmailTextField.placeholder = "Enter email address"
        guestEmailTextField.keyboardType = .emailAddress

        bookButton.setTitle("Book Selected Room", for: .normal)
        bookButton.backgroundColor = .systemGreen
        bookButton.setTitleColor(.white, for: .normal)
        bookButton.layer.cornerRadius = 8
        bookButton.addTarget(self, action: #selector(bookRoom), for: .touchUpInside)

        bookingStack.addArrangedSubview(guestNameLabel)
        bookingStack.addArrangedSubview(guestNameTextField)
        bookingStack.addArrangedSubview(guestEmailLabel)
        bookingStack.addArrangedSubview(guestEmailTextField)
        bookingStack.addArrangedSubview(bookButton)

        view.addSubview(searchStack)
        view.addSubview(tableView)
        view.addSubview(bookingStack)

        NSLayoutConstraint.activate([
            searchStack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 20),
            searchStack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            searchStack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),

            tableView.topAnchor.constraint(equalTo: searchStack.bottomAnchor, constant: 20),
            tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tableView.heightAnchor.constraint(equalToConstant: 250),

            bookingStack.topAnchor.constraint(equalTo: tableView.bottomAnchor, constant: 20),
            bookingStack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            bookingStack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
        ])
    }

    private func loadData() {
        Task {
            do {
                async let roomsResult = HotelAPIService.shared.getAllRooms()
                async let guestsResult = HotelAPIService.shared.getAllGuests()

                self.rooms = try await roomsResult
                self.guests = try await guestsResult

                await MainActor.run {
                    tableView.reloadData()
                }
            } catch {
                await MainActor.run {
                    showError("Failed to load data: \(error.localizedDescription)")
                }
            }
        }
    }

    @objc private func searchRooms() {
        let roomType = roomTypeTextField.text?.isEmpty == false ? roomTypeTextField.text : nil
        let maxPrice = maxPriceTextField.text.flatMap { Double($0) }

        Task {
            do {
                let searchResults = try await HotelAPIService.shared.searchRooms(roomType: roomType, maxPrice: maxPrice)
                await MainActor.run {
                    self.rooms = searchResults
                    tableView.reloadData()
                }
            } catch {
                await MainActor.run {
                    showError("Search failed: \(error.localizedDescription)")
                }
            }
        }
    }

    @objc private func bookRoom() {
        guard let selectedRoom = selectedRoom else {
            showError("Please select a room first")
            return
        }

        guard let name = guestNameTextField.text, !name.isEmpty,
              let email = guestEmailTextField.text, !email.isEmpty else {
            showError("Please enter guest name and email")
            return
        }

        Task {
            do {
                // Create guest first
                let guest = try await HotelAPIService.shared.createGuest(name: name, email: email)

                // Create booking
                let dateFormatter = ISO8601DateFormatter()
                dateFormatter.formatOptions = [.withFullDate, .withTime, .withColonSeparatorInTime]
                let checkIn = dateFormatter.string(from: Date())
                let checkOut = dateFormatter.string(from: Date().addingTimeInterval(86400)) // +1 day

                let booking = try await HotelAPIService.shared.createBooking(
                    guestId: String(guest.id),
                    roomId: String(selectedRoom.id),
                    checkIn: checkIn,
                    checkOut: checkOut
                )

                await MainActor.run {
                    showSuccess("Room booked successfully! Booking ID: \(booking.id)")
                    loadData() // Refresh data
                    clearForm()
                }
            } catch {
                await MainActor.run {
                    showError("Booking failed: \(error.localizedDescription)")
                }
            }
        }
    }

    private func clearForm() {
        guestNameTextField.text = ""
        guestEmailTextField.text = ""
        selectedRoom = nil
    }

    private func showError(_ message: String) {
        let alert = UIAlertController(title: "Error", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }

    private func showSuccess(_ message: String) {
        let alert = UIAlertController(title: "Success", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}

extension RoomSearchViewController: UITableViewDataSource, UITableViewDelegate {
    func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        return rooms.count
    }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "RoomCell", for: indexPath) as! RoomCell
        let room = rooms[indexPath.row]
        cell.configure(with: room)
        return cell
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        selectedRoom = rooms[indexPath.row]
    }
}

class RoomCell: UITableViewCell {
    private let roomTypeLabel = UILabel()
    private let priceLabel = UILabel()
    private let availabilityLabel = UILabel()

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        setupUI()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private func setupUI() {
        let stack = UIStackView(arrangedSubviews: [roomTypeLabel, priceLabel, availabilityLabel])
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

    func configure(with room: Room) {
        roomTypeLabel.text = "\(room.roomNumber) - \(room.roomType)"
        roomTypeLabel.font = .systemFont(ofSize: 18, weight: .semibold)

        priceLabel.text = room.displayPrice
        priceLabel.font = .systemFont(ofSize: 16)
        priceLabel.textColor = .systemGreen

        availabilityLabel.text = room.availabilityText
        availabilityLabel.font = .systemFont(ofSize: 14)
        availabilityLabel.textColor = room.available ? .systemGreen : .systemRed
    }
}
