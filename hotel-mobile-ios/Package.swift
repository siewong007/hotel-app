// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "HotelMobileIOS",
    platforms: [
        .iOS(.v15)
    ],
    products: [
        .library(
            name: "HotelMobileIOS",
            targets: ["HotelMobileIOS"]
        )
    ],
    dependencies: [],
    targets: [
        .target(
            name: "HotelMobileIOS",
            dependencies: [],
            path: "Sources",
            resources: [
                .process("LaunchScreen.storyboard")
            ]
        )
    ]
)
