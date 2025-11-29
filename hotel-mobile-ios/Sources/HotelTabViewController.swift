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

        let reportsVC = PersonalizedReportsViewController()
        reportsVC.tabBarItem = UITabBarItem(title: "Reports", image: UIImage(systemName: "chart.bar"), tag: 3)

        let settingsVC = SettingsViewController()
        settingsVC.tabBarItem = UITabBarItem(title: "Settings", image: UIImage(systemName: "gear"), tag: 4)

        viewControllers = [roomSearchVC, guestListVC, bookingListVC, reportsVC, settingsVC]
    }
}
