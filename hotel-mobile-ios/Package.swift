// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "HotelMobileIOS",
    platforms: [
        .iOS(.v15)
    ],
    products: [
        .executable(
            name: "HotelMobileIOS",
            targets: ["HotelMobileIOS"]
        )
    ],
    dependencies: [],
    targets: [
        .executableTarget(
            name: "HotelMobileIOS",
            dependencies: []
        )
    ]
)
