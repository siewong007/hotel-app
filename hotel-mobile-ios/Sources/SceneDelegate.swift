import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = (scene as? UIWindowScene) else { return }

        window = UIWindow(windowScene: windowScene)
        
        // Show main interface (existing tab bar controller)
        showMainInterface()
        
        // Listen for login/logout notifications
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleLogin),
            name: .userDidLogin,
            object: nil
        )
        
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleLogout),
            name: .userDidLogout,
            object: nil
        )
        
        window?.makeKeyAndVisible()
    }
    
    private func showMainInterface() {
        // Use existing HotelTabViewController with all tabs
        let mainViewController = HotelTabViewController()
        window?.rootViewController = mainViewController
    }
    
    private func showLoginInterface() {
        // Create a simple login view
        let loginVC = UIViewController()
        loginVC.view.backgroundColor = .systemBackground
        
        let label = UILabel()
        label.text = "Login Required"
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        loginVC.view.addSubview(label)
        
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: loginVC.view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: loginVC.view.centerYAnchor)
        ])
        
        let navController = UINavigationController(rootViewController: loginVC)
        window?.rootViewController = navController
    }
    
    @objc private func handleLogin() {
        showMainInterface()
    }
    
    @objc private func handleLogout() {
        showLoginInterface()
    }

    func sceneDidDisconnect(_ scene: UIScene) {}

    func sceneDidBecomeActive(_ scene: UIScene) {}

    func sceneWillResignActive(_ scene: UIScene) {}

    func sceneWillEnterForeground(_ scene: UIScene) {}

    func sceneDidEnterBackground(_ scene: UIScene) {}
}
