import UIKit

class HotelTabViewController: UITabBarController {

    override func viewDidLoad() {
        super.viewDidLoad()
        setupTabs()
    }

    private func setupTabs() {
        let roomSearchVC = RoomSearchViewController()
        roomSearchVC.tabBarItem = UITabBarItem(title: "Rooms", image: UIImage(systemName: "bed.double"), tag: 0)

        let guestListVC = GuestListViewController()
        guestListVC.tabBarItem = UITabBarItem(title: "Guests", image: UIImage(systemName: "person.2"), tag: 1)

        let bookingListVC = BookingListViewController()
        bookingListVC.tabBarItem = UITabBarItem(title: "Bookings", image: UIImage(systemName: "calendar"), tag: 2)

        let loyaltyVC = UINavigationController(rootViewController: LoyaltyStatisticsViewController())
        loyaltyVC.tabBarItem = UITabBarItem(title: "Loyalty", image: UIImage(systemName: "star.circle"), tag: 3)

        let profileVC = UINavigationController(rootViewController: UserProfileViewController())
        profileVC.tabBarItem = UITabBarItem(title: "Profile", image: UIImage(systemName: "person.circle"), tag: 4)

        let reportsVC = PersonalizedReportsViewController()
        reportsVC.tabBarItem = UITabBarItem(title: "Reports", image: UIImage(systemName: "chart.bar"), tag: 5)

        let settingsVC = SettingsViewController()
        settingsVC.tabBarItem = UITabBarItem(title: "Settings", image: UIImage(systemName: "gear"), tag: 6)

        viewControllers = [roomSearchVC, guestListVC, bookingListVC, loyaltyVC, profileVC, reportsVC, settingsVC]
    }
}
