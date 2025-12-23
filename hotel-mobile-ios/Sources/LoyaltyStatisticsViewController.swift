import UIKit

class LoyaltyStatisticsViewController: UIViewController {

    private let apiService = HotelAPIService.shared
    private var statistics: LoyaltyStatistics?
    private var isLoading = false

    private let scrollView: UIScrollView = {
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        return scroll
    }()

    private let contentStackView: UIStackView = {
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 20
        stack.translatesAutoresizingMaskIntoConstraints = false
        return stack
    }()

    private let loadingIndicator: UIActivityIndicatorView = {
        let indicator = UIActivityIndicatorView(style: .large)
        indicator.hidesWhenStopped = true
        indicator.translatesAutoresizingMaskIntoConstraints = false
        return indicator
    }()

    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
        loadStatistics()
    }

    private func setupUI() {
        title = "Loyalty Statistics"
        view.backgroundColor = .systemGroupedBackground

        view.addSubview(scrollView)
        view.addSubview(loadingIndicator)
        scrollView.addSubview(contentStackView)

        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            contentStackView.topAnchor.constraint(equalTo: scrollView.topAnchor, constant: 20),
            contentStackView.leadingAnchor.constraint(equalTo: scrollView.leadingAnchor, constant: 20),
            contentStackView.trailingAnchor.constraint(equalTo: scrollView.trailingAnchor, constant: -20),
            contentStackView.bottomAnchor.constraint(equalTo: scrollView.bottomAnchor, constant: -20),
            contentStackView.widthAnchor.constraint(equalTo: scrollView.widthAnchor, constant: -40),

            loadingIndicator.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            loadingIndicator.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])

        let refreshButton = UIBarButtonItem(barButtonSystemItem: .refresh, target: self, action: #selector(refreshTapped))
        navigationItem.rightBarButtonItem = refreshButton
    }

    @objc private func refreshTapped() {
        loadStatistics()
    }

    private func loadStatistics() {
        guard !isLoading else { return }
        isLoading = true
        loadingIndicator.startAnimating()

        Task {
            do {
                let stats = try await apiService.getLoyaltyStatistics()
                await MainActor.run {
                    self.statistics = stats
                    self.displayStatistics()
                    self.isLoading = false
                    self.loadingIndicator.stopAnimating()
                }
            } catch {
                await MainActor.run {
                    self.isLoading = false
                    self.loadingIndicator.stopAnimating()
                    self.showError(error)
                }
            }
        }
    }

    private func displayStatistics() {
        contentStackView.arrangedSubviews.forEach { $0.removeFromSuperview() }

        guard let stats = statistics else { return }

        // Overview Cards
        let overviewStack = createOverviewCards(stats: stats)
        contentStackView.addArrangedSubview(overviewStack)

        // Members by Tier Section
        let tierSection = createTierSection(stats: stats)
        contentStackView.addArrangedSubview(tierSection)

        // Top Members Section
        let topMembersSection = createTopMembersSection(stats: stats)
        contentStackView.addArrangedSubview(topMembersSection)

        // Recent Transactions Section
        let transactionsSection = createTransactionsSection(stats: stats)
        contentStackView.addArrangedSubview(transactionsSection)
    }

    private func createOverviewCards(stats: LoyaltyStatistics) -> UIView {
        let containerStack = UIStackView()
        containerStack.axis = .vertical
        containerStack.spacing = 12

        let row1 = UIStackView()
        row1.axis = .horizontal
        row1.spacing = 12
        row1.distribution = .fillEqually

        let row2 = UIStackView()
        row2.axis = .horizontal
        row2.spacing = 12
        row2.distribution = .fillEqually

        row1.addArrangedSubview(createStatCard(title: "Total Members", value: "\(stats.totalMembers)", color: .systemBlue))
        row1.addArrangedSubview(createStatCard(title: "Active Members", value: "\(stats.activeMembers)", color: .systemGreen))

        row2.addArrangedSubview(createStatCard(title: "Points Issued", value: formatNumber(stats.totalPointsIssued), color: .systemOrange))
        row2.addArrangedSubview(createStatCard(title: "Points Redeemed", value: formatNumber(stats.totalPointsRedeemed), color: .systemPurple))

        containerStack.addArrangedSubview(row1)
        containerStack.addArrangedSubview(row2)

        return containerStack
    }

    private func createStatCard(title: String, value: String, color: UIColor) -> UIView {
        let card = UIView()
        card.backgroundColor = .systemBackground
        card.layer.cornerRadius = 12
        card.layer.shadowColor = UIColor.black.cgColor
        card.layer.shadowOpacity = 0.1
        card.layer.shadowOffset = CGSize(width: 0, height: 2)
        card.layer.shadowRadius = 4

        let stack = UIStackView()
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false

        let titleLabel = UILabel()
        titleLabel.text = title
        titleLabel.font = .systemFont(ofSize: 12, weight: .medium)
        titleLabel.textColor = .secondaryLabel
        titleLabel.textAlignment = .center

        let valueLabel = UILabel()
        valueLabel.text = value
        valueLabel.font = .systemFont(ofSize: 24, weight: .bold)
        valueLabel.textColor = color
        valueLabel.textAlignment = .center

        stack.addArrangedSubview(titleLabel)
        stack.addArrangedSubview(valueLabel)

        card.addSubview(stack)

        NSLayoutConstraint.activate([
            card.heightAnchor.constraint(equalToConstant: 100),
            stack.centerXAnchor.constraint(equalTo: card.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: card.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: card.leadingAnchor, constant: 12),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: card.trailingAnchor, constant: -12)
        ])

        return card
    }

    private func createTierSection(stats: LoyaltyStatistics) -> UIView {
        let section = createSectionCard(title: "Members by Tier")
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false

        for tier in stats.membersByTier {
            let tierView = createTierRow(tier: tier)
            stack.addArrangedSubview(tierView)
        }

        section.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: section.topAnchor, constant: 50),
            stack.leadingAnchor.constraint(equalTo: section.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: section.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: section.bottomAnchor, constant: -16)
        ])

        return section
    }

    private func createTierRow(tier: TierStatistics) -> UIView {
        let row = UIView()
        row.translatesAutoresizingMaskIntoConstraints = false

        let nameLabel = UILabel()
        nameLabel.text = tier.tierName
        nameLabel.font = .systemFont(ofSize: 15, weight: .medium)
        nameLabel.translatesAutoresizingMaskIntoConstraints = false

        let countLabel = UILabel()
        countLabel.text = "\(tier.count) (\(String(format: "%.1f", tier.percentage))%)"
        countLabel.font = .systemFont(ofSize: 14)
        countLabel.textColor = .secondaryLabel
        countLabel.translatesAutoresizingMaskIntoConstraints = false

        let progressBar = UIView()
        progressBar.backgroundColor = .systemGray5
        progressBar.layer.cornerRadius = 4
        progressBar.translatesAutoresizingMaskIntoConstraints = false

        let progressFill = UIView()
        progressFill.backgroundColor = colorForTier(tier.tierLevel)
        progressFill.layer.cornerRadius = 4
        progressFill.translatesAutoresizingMaskIntoConstraints = false

        row.addSubview(nameLabel)
        row.addSubview(countLabel)
        row.addSubview(progressBar)
        progressBar.addSubview(progressFill)

        let fillWidth = CGFloat(tier.percentage) / 100.0

        NSLayoutConstraint.activate([
            row.heightAnchor.constraint(greaterThanOrEqualToConstant: 50),

            nameLabel.topAnchor.constraint(equalTo: row.topAnchor, constant: 4),
            nameLabel.leadingAnchor.constraint(equalTo: row.leadingAnchor),

            countLabel.topAnchor.constraint(equalTo: row.topAnchor, constant: 4),
            countLabel.trailingAnchor.constraint(equalTo: row.trailingAnchor),

            progressBar.topAnchor.constraint(equalTo: nameLabel.bottomAnchor, constant: 8),
            progressBar.leadingAnchor.constraint(equalTo: row.leadingAnchor),
            progressBar.trailingAnchor.constraint(equalTo: row.trailingAnchor),
            progressBar.bottomAnchor.constraint(equalTo: row.bottomAnchor, constant: -4),
            progressBar.heightAnchor.constraint(equalToConstant: 8),

            progressFill.topAnchor.constraint(equalTo: progressBar.topAnchor),
            progressFill.leadingAnchor.constraint(equalTo: progressBar.leadingAnchor),
            progressFill.bottomAnchor.constraint(equalTo: progressBar.bottomAnchor),
            progressFill.widthAnchor.constraint(equalTo: progressBar.widthAnchor, multiplier: fillWidth)
        ])

        return row
    }

    private func createTopMembersSection(stats: LoyaltyStatistics) -> UIView {
        let section = createSectionCard(title: "Top Members")
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false

        let topMembers = Array(stats.topMembers.prefix(5))
        for (index, member) in topMembers.enumerated() {
            let memberView = createTopMemberRow(member: member, rank: index + 1)
            stack.addArrangedSubview(memberView)

            if index < topMembers.count - 1 {
                let separator = UIView()
                separator.backgroundColor = .separator
                separator.translatesAutoresizingMaskIntoConstraints = false
                separator.heightAnchor.constraint(equalToConstant: 1).isActive = true
                stack.addArrangedSubview(separator)
            }
        }

        section.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: section.topAnchor, constant: 50),
            stack.leadingAnchor.constraint(equalTo: section.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: section.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: section.bottomAnchor, constant: -16)
        ])

        return section
    }

    private func createTopMemberRow(member: TopMember, rank: Int) -> UIView {
        let row = UIView()
        row.translatesAutoresizingMaskIntoConstraints = false

        let rankLabel = UILabel()
        rankLabel.text = "#\(rank)"
        rankLabel.font = .systemFont(ofSize: 18, weight: .bold)
        rankLabel.textColor = rank <= 3 ? .systemOrange : .secondaryLabel
        rankLabel.translatesAutoresizingMaskIntoConstraints = false

        let nameLabel = UILabel()
        nameLabel.text = member.guestName
        nameLabel.font = .systemFont(ofSize: 15, weight: .medium)
        nameLabel.translatesAutoresizingMaskIntoConstraints = false

        let emailLabel = UILabel()
        emailLabel.text = member.guestEmail
        emailLabel.font = .systemFont(ofSize: 12)
        emailLabel.textColor = .secondaryLabel
        emailLabel.translatesAutoresizingMaskIntoConstraints = false

        let pointsLabel = UILabel()
        pointsLabel.text = "\(formatNumber(member.lifetimePoints)) pts"
        pointsLabel.font = .systemFont(ofSize: 14, weight: .semibold)
        pointsLabel.textColor = .systemBlue
        pointsLabel.translatesAutoresizingMaskIntoConstraints = false

        row.addSubview(rankLabel)
        row.addSubview(nameLabel)
        row.addSubview(emailLabel)
        row.addSubview(pointsLabel)

        NSLayoutConstraint.activate([
            row.heightAnchor.constraint(greaterThanOrEqualToConstant: 50),

            rankLabel.leadingAnchor.constraint(equalTo: row.leadingAnchor),
            rankLabel.centerYAnchor.constraint(equalTo: row.centerYAnchor),
            rankLabel.widthAnchor.constraint(equalToConstant: 40),

            nameLabel.leadingAnchor.constraint(equalTo: rankLabel.trailingAnchor, constant: 12),
            nameLabel.topAnchor.constraint(equalTo: row.topAnchor, constant: 4),

            emailLabel.leadingAnchor.constraint(equalTo: rankLabel.trailingAnchor, constant: 12),
            emailLabel.topAnchor.constraint(equalTo: nameLabel.bottomAnchor, constant: 2),
            emailLabel.bottomAnchor.constraint(equalTo: row.bottomAnchor, constant: -4),

            pointsLabel.trailingAnchor.constraint(equalTo: row.trailingAnchor),
            pointsLabel.centerYAnchor.constraint(equalTo: row.centerYAnchor)
        ])

        return row
    }

    private func createTransactionsSection(stats: LoyaltyStatistics) -> UIView {
        let section = createSectionCard(title: "Recent Activity")
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false

        let recentTransactions = Array(stats.recentTransactions.prefix(10))
        for (index, transaction) in recentTransactions.enumerated() {
            let transactionView = createTransactionRow(transaction: transaction)
            stack.addArrangedSubview(transactionView)

            if index < recentTransactions.count - 1 {
                let separator = UIView()
                separator.backgroundColor = .separator
                separator.translatesAutoresizingMaskIntoConstraints = false
                separator.heightAnchor.constraint(equalToConstant: 1).isActive = true
                stack.addArrangedSubview(separator)
            }
        }

        section.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: section.topAnchor, constant: 50),
            stack.leadingAnchor.constraint(equalTo: section.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: section.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: section.bottomAnchor, constant: -16)
        ])

        return section
    }

    private func createTransactionRow(transaction: RecentTransaction) -> UIView {
        let row = UIView()
        row.translatesAutoresizingMaskIntoConstraints = false

        let typeIcon = UILabel()
        typeIcon.text = transaction.transactionType == "earn" ? "+" : "-"
        typeIcon.font = .systemFont(ofSize: 20, weight: .bold)
        typeIcon.textColor = transaction.transactionType == "earn" ? .systemGreen : .systemRed
        typeIcon.translatesAutoresizingMaskIntoConstraints = false

        let nameLabel = UILabel()
        nameLabel.text = transaction.guestName
        nameLabel.font = .systemFont(ofSize: 15, weight: .medium)
        nameLabel.translatesAutoresizingMaskIntoConstraints = false

        let descLabel = UILabel()
        descLabel.text = transaction.description ?? transaction.transactionType.capitalized
        descLabel.font = .systemFont(ofSize: 12)
        descLabel.textColor = .secondaryLabel
        descLabel.translatesAutoresizingMaskIntoConstraints = false

        let pointsLabel = UILabel()
        pointsLabel.text = "\(transaction.pointsAmount) pts"
        pointsLabel.font = .systemFont(ofSize: 14, weight: .semibold)
        pointsLabel.textColor = transaction.transactionType == "earn" ? .systemGreen : .systemRed
        pointsLabel.translatesAutoresizingMaskIntoConstraints = false

        row.addSubview(typeIcon)
        row.addSubview(nameLabel)
        row.addSubview(descLabel)
        row.addSubview(pointsLabel)

        NSLayoutConstraint.activate([
            row.heightAnchor.constraint(greaterThanOrEqualToConstant: 50),

            typeIcon.leadingAnchor.constraint(equalTo: row.leadingAnchor),
            typeIcon.centerYAnchor.constraint(equalTo: row.centerYAnchor),
            typeIcon.widthAnchor.constraint(equalToConstant: 30),

            nameLabel.leadingAnchor.constraint(equalTo: typeIcon.trailingAnchor, constant: 12),
            nameLabel.topAnchor.constraint(equalTo: row.topAnchor, constant: 4),

            descLabel.leadingAnchor.constraint(equalTo: typeIcon.trailingAnchor, constant: 12),
            descLabel.topAnchor.constraint(equalTo: nameLabel.bottomAnchor, constant: 2),
            descLabel.bottomAnchor.constraint(equalTo: row.bottomAnchor, constant: -4),

            pointsLabel.trailingAnchor.constraint(equalTo: row.trailingAnchor),
            pointsLabel.centerYAnchor.constraint(equalTo: row.centerYAnchor)
        ])

        return row
    }

    private func createSectionCard(title: String) -> UIView {
        let card = UIView()
        card.backgroundColor = .systemBackground
        card.layer.cornerRadius = 12
        card.layer.shadowColor = UIColor.black.cgColor
        card.layer.shadowOpacity = 0.1
        card.layer.shadowOffset = CGSize(width: 0, height: 2)
        card.layer.shadowRadius = 4
        card.translatesAutoresizingMaskIntoConstraints = false

        let titleLabel = UILabel()
        titleLabel.text = title
        titleLabel.font = .systemFont(ofSize: 18, weight: .bold)
        titleLabel.translatesAutoresizingMaskIntoConstraints = false

        card.addSubview(titleLabel)

        NSLayoutConstraint.activate([
            titleLabel.topAnchor.constraint(equalTo: card.topAnchor, constant: 16),
            titleLabel.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16)
        ])

        return card
    }

    private func colorForTier(_ level: Int) -> UIColor {
        switch level {
        case 1: return UIColor(red: 0.8, green: 0.5, blue: 0.2, alpha: 1.0) // Bronze
        case 2: return UIColor(red: 0.75, green: 0.75, blue: 0.75, alpha: 1.0) // Silver
        case 3: return UIColor(red: 1.0, green: 0.84, blue: 0.0, alpha: 1.0) // Gold
        case 4: return UIColor(red: 0.9, green: 0.95, blue: 1.0, alpha: 1.0) // Platinum
        default: return .systemGray
        }
    }

    private func formatNumber(_ number: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        return formatter.string(from: NSNumber(value: number)) ?? "\(number)"
    }

    private func showError(_ error: Error) {
        let alert = UIAlertController(
            title: "Error",
            message: error.localizedDescription,
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}
