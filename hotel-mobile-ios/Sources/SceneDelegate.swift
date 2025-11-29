import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = (scene as? UIWindowScene) else { return }

        window = UIWindow(windowScene: windowScene)
        
        // Check authentication status
        if AuthManager.shared.isAuthenticated {
            showMainInterface()
        } else {
            showLoginInterface()
        }
        
        // Listen for login/logout notifications
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleLogin),
            name: NSNotification.Name("UserDidLogin"),
            object: nil
        )
        
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleLogout),
            name: NSNotification.Name("UserDidLogout"),
            object: nil
        )
        
        window?.makeKeyAndVisible()
    }
    
    private func showMainInterface() {
        let mainViewController = HotelTabViewController()
        window?.rootViewController = mainViewController
    }
    
    private func showLoginInterface() {
        let loginViewController = LoginViewController()
        let navController = UINavigationController(rootViewController: loginViewController)
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
