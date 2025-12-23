import UIKit

/// Main tab controller for the hotel app
class HotelTabViewController: UITabBarController {
    
    override func viewDidLoad() {
        super.viewDidLoad()
        
        setupTabs()
        setupAppearance()
    }
    
    private func setupTabs() {
        let roomsVC = RoomListViewController()
        roomsVC.tabBarItem = UITabBarItem(
            title: "Available Rooms",
            image: UIImage(systemName: "bed.double.fill"),
            selectedImage: UIImage(systemName: "bed.double.fill")
        )
        let roomsNav = UINavigationController(rootViewController: roomsVC)
        
        let bookingsVC = MyBookingsViewController()
        bookingsVC.tabBarItem = UITabBarItem(
            title: "My Bookings",
            image: UIImage(systemName: "calendar"),
            selectedImage: UIImage(systemName: "calendar")
        )
        let bookingsNav = UINavigationController(rootViewController: bookingsVC)
        
        let profileVC = ProfileViewController()
        profileVC.tabBarItem = UITabBarItem(
            title: "Profile",
            image: UIImage(systemName: "person.circle"),
            selectedImage: UIImage(systemName: "person.circle.fill")
        )
        let profileNav = UINavigationController(rootViewController: profileVC)
        
        viewControllers = [roomsNav, bookingsNav, profileNav]
    }
    
    private func setupAppearance() {
        tabBar.tintColor = .systemBlue
        tabBar.unselectedItemTintColor = .systemGray
    }
}
