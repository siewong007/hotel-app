import UIKit

class PersonalizedReportsViewController: UIViewController {
    
    private let scrollView = UIScrollView()
    private let contentView = UIView()
    private let periodSegmentedControl = UISegmentedControl(items: ["Week", "Month", "Year"])
    private let refreshButton = UIButton(type: .system)
    
    private var report: PersonalizedReport?
    private var loadingIndicator = UIActivityIndicatorView(style: .large)
    
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "My Reports"
        setupUI()
        loadReport()
    }
    
    private func setupUI() {
        view.backgroundColor = .systemBackground
        
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        contentView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scrollView)
        scrollView.addSubview(contentView)
        
        // Period selector
        periodSegmentedControl.selectedSegmentIndex = 1 // Default to month
        periodSegmentedControl.addTarget(self, action: #selector(periodChanged), for: .valueChanged)
        periodSegmentedControl.translatesAutoresizingMaskIntoConstraints = false
        
        // Refresh button
        refreshButton.setTitle("Refresh", for: .normal)
        refreshButton.addTarget(self, action: #selector(refreshTapped), for: .touchUpInside)
        refreshButton.translatesAutoresizingMaskIntoConstraints = false
        
        let headerStack = UIStackView(arrangedSubviews: [periodSegmentedControl, refreshButton])
        headerStack.axis = .horizontal
        headerStack.spacing = 16
        headerStack.translatesAutoresizingMaskIntoConstraints = false
        
        contentView.addSubview(headerStack)
        
        loadingIndicator.hidesWhenStopped = true
        loadingIndicator.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(loadingIndicator)
        
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
            
            headerStack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 20),
            headerStack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            headerStack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            
            loadingIndicator.centerXAnchor.constraint(equalTo: contentView.centerXAnchor),
            loadingIndicator.topAnchor.constraint(equalTo: headerStack.bottomAnchor, constant: 40)
        ])
    }
    
    private func loadReport() {
        let period = periodSegmentedControl.selectedSegmentIndex == 0 ? "week" :
                    periodSegmentedControl.selectedSegmentIndex == 1 ? "month" : "year"
        
        loadingIndicator.startAnimating()
        
        Task {
            do {
                let reportData = try await HotelAPIService.shared.getPersonalizedReport(period: period)
                await MainActor.run {
                    self.report = reportData
                    self.renderReport()
                    self.loadingIndicator.stopAnimating()
                }
            } catch {
                await MainActor.run {
                    self.loadingIndicator.stopAnimating()
                    self.showError("Failed to load report: \(error.localizedDescription)")
                }
            }
        }
    }
    
    private func renderReport() {
        guard let report = report else { return }
        
        // Clear existing views
        contentView.subviews.forEach { view in
            if view != periodSegmentedControl && view != refreshButton && view != loadingIndicator {
                view.removeFromSuperview()
            }
        }
        
        var lastView: UIView = periodSegmentedControl
        var topOffset: CGFloat = 80
        
        // Report Context Card
        let contextCard = createCard(title: "Report Context")
        let contextLabel = UILabel()
        contextLabel.numberOfLines = 0
        contextLabel.font = .systemFont(ofSize: 14)
        contextLabel.text = """
        Scope: \(report.reportScope == "all" ? "System-wide" : "Personal")
        Roles: \(report.userRoles.joined(separator: ", "))
        Generated: \(formatDate(report.generatedAt))
        """
        contextLabel.translatesAutoresizingMaskIntoConstraints = false
        contextCard.addSubview(contextLabel)
        
        NSLayoutConstraint.activate([
            contextLabel.topAnchor.constraint(equalTo: contextCard.topAnchor, constant: 40),
            contextLabel.leadingAnchor.constraint(equalTo: contextCard.leadingAnchor, constant: 16),
            contextLabel.trailingAnchor.constraint(equalTo: contextCard.trailingAnchor, constant: -16),
            contextLabel.bottomAnchor.constraint(equalTo: contextCard.bottomAnchor, constant: -16)
        ])
        
        contentView.addSubview(contextCard)
        NSLayoutConstraint.activate([
            contextCard.topAnchor.constraint(equalTo: lastView.bottomAnchor, constant: 20),
            contextCard.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            contextCard.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20)
        ])
        lastView = contextCard
        topOffset += 120
        
        // Summary Cards
        let summaryStack = UIStackView()
        summaryStack.axis = .vertical
        summaryStack.spacing = 12
        summaryStack.translatesAutoresizingMaskIntoConstraints = false
        
        let bookingsCard = createMetricCard(title: "Total Bookings", value: "\(report.summary.totalBookings)", color: .systemBlue)
        let revenueCard = createMetricCard(title: "Total Revenue", value: formatCurrency(report.summary.totalRevenue), color: .systemGreen)
        let avgCard = createMetricCard(title: "Avg Booking", value: formatCurrency(report.summary.averageBookingValue), color: .systemOrange)
        let occupancyCard = createMetricCard(title: "Occupancy", value: String(format: "%.1f%%", report.summary.occupancyRate), color: .systemPurple)
        
        summaryStack.addArrangedSubview(bookingsCard)
        summaryStack.addArrangedSubview(revenueCard)
        summaryStack.addArrangedSubview(avgCard)
        summaryStack.addArrangedSubview(occupancyCard)
        
        contentView.addSubview(summaryStack)
        NSLayoutConstraint.activate([
            summaryStack.topAnchor.constraint(equalTo: lastView.bottomAnchor, constant: 20),
            summaryStack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            summaryStack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20)
        ])
        lastView = summaryStack
        topOffset += 400
        
        // Insights
        if !report.insights.isEmpty {
            let insightsCard = createCard(title: "Key Insights")
            let insightsStack = UIStackView()
            insightsStack.axis = .vertical
            insightsStack.spacing = 8
            insightsStack.translatesAutoresizingMaskIntoConstraints = false
            
            for insight in report.insights {
                let insightLabel = UILabel()
                insightLabel.text = "• \(insight)"
                insightLabel.numberOfLines = 0
                insightLabel.font = .systemFont(ofSize: 14)
                insightsStack.addArrangedSubview(insightLabel)
            }
            
            insightsCard.addSubview(insightsStack)
            NSLayoutConstraint.activate([
                insightsStack.topAnchor.constraint(equalTo: insightsCard.topAnchor, constant: 40),
                insightsStack.leadingAnchor.constraint(equalTo: insightsCard.leadingAnchor, constant: 16),
                insightsStack.trailingAnchor.constraint(equalTo: insightsCard.trailingAnchor, constant: -16),
                insightsStack.bottomAnchor.constraint(equalTo: insightsCard.bottomAnchor, constant: -16)
            ])
            
            contentView.addSubview(insightsCard)
            NSLayoutConstraint.activate([
                insightsCard.topAnchor.constraint(equalTo: lastView.bottomAnchor, constant: 20),
                insightsCard.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
                insightsCard.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20)
            ])
            lastView = insightsCard
            topOffset += CGFloat(80 + report.insights.count * 30)
        }
        
        // Recent Bookings
        if !report.recentBookings.isEmpty {
            let bookingsCard = createCard(title: "Recent Bookings")
            let bookingsStack = UIStackView()
            bookingsStack.axis = .vertical
            bookingsStack.spacing = 12
            bookingsStack.translatesAutoresizingMaskIntoConstraints = false
            
            for booking in report.recentBookings.prefix(5) {
                let bookingView = createBookingView(booking: booking)
                bookingsStack.addArrangedSubview(bookingView)
            }
            
            bookingsCard.addSubview(bookingsStack)
            NSLayoutConstraint.activate([
                bookingsStack.topAnchor.constraint(equalTo: bookingsCard.topAnchor, constant: 40),
                bookingsStack.leadingAnchor.constraint(equalTo: bookingsCard.leadingAnchor, constant: 16),
                bookingsStack.trailingAnchor.constraint(equalTo: bookingsCard.trailingAnchor, constant: -16),
                bookingsStack.bottomAnchor.constraint(equalTo: bookingsCard.bottomAnchor, constant: -16)
            ])
            
            contentView.addSubview(bookingsCard)
            NSLayoutConstraint.activate([
                bookingsCard.topAnchor.constraint(equalTo: lastView.bottomAnchor, constant: 20),
                bookingsCard.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
                bookingsCard.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
                bookingsCard.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -20)
            ])
        }
    }
    
    private func createCard(title: String) -> UIView {
        let card = UIView()
        card.backgroundColor = .secondarySystemBackground
        card.layer.cornerRadius = 12
        card.translatesAutoresizingMaskIntoConstraints = false
        
        let titleLabel = UILabel()
        titleLabel.text = title
        titleLabel.font = .systemFont(ofSize: 18, weight: .bold)
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(titleLabel)
        
        NSLayoutConstraint.activate([
            titleLabel.topAnchor.constraint(equalTo: card.topAnchor, constant: 16),
            titleLabel.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            titleLabel.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16)
        ])
        
        return card
    }
    
    private func createMetricCard(title: String, value: String, color: UIColor) -> UIView {
        let card = UIView()
        card.backgroundColor = .secondarySystemBackground
        card.layer.cornerRadius = 12
        card.translatesAutoresizingMaskIntoConstraints = false
        
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 4
        stack.translatesAutoresizingMaskIntoConstraints = false
        
        let titleLabel = UILabel()
        titleLabel.text = title
        titleLabel.font = .systemFont(ofSize: 14)
        titleLabel.textColor = .secondaryLabel
        
        let valueLabel = UILabel()
        valueLabel.text = value
        valueLabel.font = .systemFont(ofSize: 24, weight: .bold)
        valueLabel.textColor = color
        
        stack.addArrangedSubview(titleLabel)
        stack.addArrangedSubview(valueLabel)
        card.addSubview(stack)
        
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: card.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: card.centerYAnchor),
            card.heightAnchor.constraint(equalToConstant: 80)
        ])
        
        return card
    }
    
    private func createBookingView(booking: ReportBooking) -> UIView {
        let view = UIView()
        view.backgroundColor = .tertiarySystemBackground
        view.layer.cornerRadius = 8
        view.translatesAutoresizingMaskIntoConstraints = false
        
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 4
        stack.translatesAutoresizingMaskIntoConstraints = false
        
        let guestLabel = UILabel()
        guestLabel.text = booking.guest_name
        guestLabel.font = .systemFont(ofSize: 16, weight: .semibold)
        
        let roomLabel = UILabel()
        roomLabel.text = "Room \(booking.room_number) - \(booking.room_type)"
        roomLabel.font = .systemFont(ofSize: 14)
        roomLabel.textColor = .secondaryLabel
        
        let datesLabel = UILabel()
        datesLabel.text = "\(formatDate(booking.check_in)) - \(formatDate(booking.check_out))"
        datesLabel.font = .systemFont(ofSize: 12)
        datesLabel.textColor = .secondaryLabel
        
        let priceLabel = UILabel()
        priceLabel.text = formatCurrency(Double(booking.total_price) ?? 0)
        priceLabel.font = .systemFont(ofSize: 14, weight: .semibold)
        priceLabel.textColor = .systemGreen
        
        stack.addArrangedSubview(guestLabel)
        stack.addArrangedSubview(roomLabel)
        stack.addArrangedSubview(datesLabel)
        stack.addArrangedSubview(priceLabel)
        
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 12),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
            stack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -12)
        ])
        
        return view
    }
    
    @objc private func periodChanged() {
        loadReport()
    }
    
    @objc private func refreshTapped() {
        loadReport()
    }
    
    private func formatCurrency(_ amount: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = "USD"
        return formatter.string(from: NSNumber(value: amount)) ?? "$0.00"
    }
    
    private func formatDate(_ dateString: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate, .withTime, .withColonSeparatorInTime]
        if let date = formatter.date(from: dateString) {
            let displayFormatter = DateFormatter()
            displayFormatter.dateStyle = .short
            return displayFormatter.string(from: date)
        }
        return dateString
    }
    
    private func showError(_ message: String) {
        let alert = UIAlertController(title: "Error", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}

