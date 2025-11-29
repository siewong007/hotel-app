import Foundation

class AuthManager {
    static let shared = AuthManager()
    
    private let accessTokenKey = "accessToken"
    private let refreshTokenKey = "refreshToken"
    private let userKey = "user"
    private let rolesKey = "roles"
    private let permissionsKey = "permissions"
    
    private init() {}
    
    // MARK: - Token Management
    
    var accessToken: String? {
        get {
            return UserDefaults.standard.string(forKey: accessTokenKey)
        }
        set {
            if let token = newValue {
                UserDefaults.standard.set(token, forKey: accessTokenKey)
            } else {
                UserDefaults.standard.removeObject(forKey: accessTokenKey)
            }
        }
    }
    
    var refreshToken: String? {
        get {
            return UserDefaults.standard.string(forKey: refreshTokenKey)
        }
        set {
            if let token = newValue {
                UserDefaults.standard.set(token, forKey: refreshTokenKey)
            } else {
                UserDefaults.standard.removeObject(forKey: refreshTokenKey)
            }
        }
    }
    
    // MARK: - User Management
    
    var currentUser: User? {
        get {
            guard let data = UserDefaults.standard.data(forKey: userKey),
                  let user = try? JSONDecoder().decode(User.self, from: data) else {
                return nil
            }
            return user
        }
        set {
            if let user = newValue,
               let data = try? JSONEncoder().encode(user) {
                UserDefaults.standard.set(data, forKey: userKey)
            } else {
                UserDefaults.standard.removeObject(forKey: userKey)
            }
        }
    }
    
    var roles: [String] {
        get {
            return UserDefaults.standard.stringArray(forKey: rolesKey) ?? []
        }
        set {
            UserDefaults.standard.set(newValue, forKey: rolesKey)
        }
    }
    
    var permissions: [String] {
        get {
            return UserDefaults.standard.stringArray(forKey: permissionsKey) ?? []
        }
        set {
            UserDefaults.standard.set(newValue, forKey: permissionsKey)
        }
    }
    
    // MARK: - Authentication State
    
    var isAuthenticated: Bool {
        return accessToken != nil && currentUser != nil
    }
    
    // MARK: - Permission Checking
    
    func hasPermission(_ permission: String) -> Bool {
        return permissions.contains(permission)
    }
    
    func hasRole(_ role: String) -> Bool {
        return roles.contains(role)
    }
    
    // MARK: - Login/Logout
    
    func saveAuth(_ authResponse: AuthResponse) {
        accessToken = authResponse.access_token
        refreshToken = authResponse.refresh_token
        currentUser = authResponse.user
        roles = authResponse.roles
        permissions = authResponse.permissions
    }
    
    func logout() {
        accessToken = nil
        refreshToken = nil
        currentUser = nil
        roles = []
        permissions = []
    }
}

