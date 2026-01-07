# Hotel Desktop Application - Windows Build Script
# This script builds the desktop application for Windows
# It ALWAYS builds with the latest frontend and backend code.

param(
    [switch]$Release,
    [switch]$Debug,
    [switch]$Clean,
    [switch]$SkipFeInstall,
    [switch]$SkipBeRebuild,
    [switch]$Help,
    [string]$Target = "x86_64-pc-windows-msvc"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$FrontendDir = Join-Path (Split-Path -Parent $ProjectDir) "hotel-web-fe"
$BackendDir = Join-Path (Split-Path -Parent $ProjectDir) "hotel-app-be"

if ($Help) {
    Write-Host "Usage: .\build-windows.ps1 [OPTIONS]" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Release        Build in release mode (default)"
    Write-Host "  -Debug          Build in debug mode"
    Write-Host "  -Clean          Clean all build artifacts before building"
    Write-Host "  -SkipFeInstall  Skip frontend npm install (use existing node_modules)"
    Write-Host "  -SkipBeRebuild  Skip explicit backend rebuild"
    Write-Host "  -Target         Specify build target (default: x86_64-pc-windows-msvc)"
    Write-Host "  -Help           Show this help message"
    Write-Host ""
    Write-Host "This script ALWAYS ensures:" -ForegroundColor Yellow
    Write-Host "  - Frontend is rebuilt with latest code"
    Write-Host "  - Backend crate is recompiled with latest code"
    Write-Host "  - All migrations are bundled from latest BE"
    exit 0
}

Write-Host "Hotel Desktop - Windows Build Script" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Display build configuration
Write-Host "Build Configuration:" -ForegroundColor Cyan
Write-Host "  Release mode: $(-not $Debug)"
Write-Host "  Clean build: $Clean"
Write-Host "  Skip FE install: $SkipFeInstall"
Write-Host "  Skip BE rebuild: $SkipBeRebuild"
Write-Host ""

# Check prerequisites
function Check-Prerequisites {
    Write-Host "Checking prerequisites..." -ForegroundColor Yellow

    # Check Rust
    if (-not (Get-Command "rustc" -ErrorAction SilentlyContinue)) {
        Write-Host "ERROR: Rust is not installed. Please install from https://rustup.rs" -ForegroundColor Red
        exit 1
    }
    $rustVersion = rustc --version
    Write-Host "  Rust: $rustVersion" -ForegroundColor Green

    # Check Node.js
    if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
        Write-Host "ERROR: Node.js is not installed. Please install from https://nodejs.org" -ForegroundColor Red
        exit 1
    }
    $nodeVersion = node --version
    Write-Host "  Node.js: $nodeVersion" -ForegroundColor Green

    # Check npm
    if (-not (Get-Command "npm" -ErrorAction SilentlyContinue)) {
        Write-Host "ERROR: npm is not installed." -ForegroundColor Red
        exit 1
    }
    $npmVersion = npm --version
    Write-Host "  npm: $npmVersion" -ForegroundColor Green

    # Check target
    $targets = rustup target list --installed
    if ($targets -notcontains $Target) {
        Write-Host "Adding Rust target: $Target" -ForegroundColor Yellow
        rustup target add $Target
    }

    Write-Host "Prerequisites check passed!" -ForegroundColor Green
    Write-Host ""
}

# Clean build artifacts
function Clean-Build {
    Write-Host "Cleaning build artifacts..." -ForegroundColor Yellow

    $targetDir = Join-Path $ProjectDir "src-tauri\target"
    if (Test-Path $targetDir) {
        Remove-Item -Recurse -Force $targetDir
        Write-Host "  Removed: $targetDir" -ForegroundColor Gray
    }

    $frontendBuild = Join-Path $FrontendDir "build"
    if (Test-Path $frontendBuild) {
        Remove-Item -Recurse -Force $frontendBuild
        Write-Host "  Removed: $frontendBuild" -ForegroundColor Gray
    }

    # Also clean backend target to ensure fresh compilation
    $backendTarget = Join-Path $BackendDir "target"
    if (Test-Path $backendTarget) {
        Remove-Item -Recurse -Force $backendTarget
        Write-Host "  Removed: $backendTarget" -ForegroundColor Gray
    }

    Write-Host "Clean complete!" -ForegroundColor Green
    Write-Host ""
}

# Build frontend (always rebuilds with latest code)
function Build-Frontend {
    Write-Host "Building frontend with latest code..." -ForegroundColor Yellow

    Push-Location $FrontendDir
    try {
        # Always remove old build to ensure fresh output
        $buildDir = Join-Path $FrontendDir "build"
        if (Test-Path $buildDir) {
            Remove-Item -Recurse -Force $buildDir
            Write-Host "  Removed old frontend build" -ForegroundColor Gray
        }

        # Install dependencies (clean install by default)
        if (-not $SkipFeInstall) {
            Write-Host "  Installing frontend dependencies..." -ForegroundColor Gray
            npm ci --legacy-peer-deps
        } else {
            Write-Host "  Skipping npm install (using existing node_modules)" -ForegroundColor Gray
        }

        # Build the frontend
        Write-Host "  Building React application..." -ForegroundColor Gray
        npm run build

        Write-Host "Frontend build complete!" -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
    Write-Host ""
}

# Rebuild backend crate to ensure latest code is compiled
function Rebuild-Backend {
    if ($SkipBeRebuild) {
        Write-Host "Skipping explicit backend rebuild" -ForegroundColor Yellow
        Write-Host ""
        return
    }

    Write-Host "Ensuring backend is up to date..." -ForegroundColor Yellow

    $libRs = Join-Path $BackendDir "src\lib.rs"
    if (Test-Path $libRs) {
        # Touch lib.rs to force cargo to recheck the crate
        (Get-Item $libRs).LastWriteTime = Get-Date
        Write-Host "  Marked backend for recompilation" -ForegroundColor Gray
    }

    Write-Host "Backend will be recompiled during Tauri build" -ForegroundColor Green
    Write-Host ""
}

# Build Tauri application
function Build-Tauri {
    param([bool]$IsRelease)

    $buildType = if ($IsRelease) { "release" } else { "debug" }
    Write-Host "Building Tauri application ($buildType)..." -ForegroundColor Yellow

    Push-Location $ProjectDir
    try {
        if ($IsRelease) {
            npm run build
        } else {
            # For debug builds, we need to run tauri build with debug flag
            npx tauri build --debug
        }
        Write-Host "Tauri build complete!" -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
    Write-Host ""
}

# Main execution
Check-Prerequisites

if ($Clean) {
    Clean-Build
}

# Determine build type
$isReleaseBuild = $Release -or (-not $Debug)

# Always rebuild frontend with latest code
Build-Frontend

# Ensure backend is marked for recompilation
Rebuild-Backend

Build-Tauri -IsRelease $isReleaseBuild

# Display output location
$bundleDir = Join-Path $ProjectDir "src-tauri\target"
if ($isReleaseBuild) {
    $bundleDir = Join-Path $bundleDir "release\bundle"
} else {
    $bundleDir = Join-Path $bundleDir "debug"
}

Write-Host "Build completed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Output location:" -ForegroundColor Cyan

if (Test-Path (Join-Path $bundleDir "nsis")) {
    $nsisPath = Join-Path $bundleDir "nsis"
    Write-Host "  NSIS Installer: $nsisPath" -ForegroundColor White
    Get-ChildItem $nsisPath -Filter "*.exe" | ForEach-Object {
        Write-Host "    - $($_.Name)" -ForegroundColor Gray
    }
}

if (Test-Path (Join-Path $bundleDir "msi")) {
    $msiPath = Join-Path $bundleDir "msi"
    Write-Host "  MSI Installer: $msiPath" -ForegroundColor White
    Get-ChildItem $msiPath -Filter "*.msi" | ForEach-Object {
        Write-Host "    - $($_.Name)" -ForegroundColor Gray
    }
}

# Print build summary
Write-Host ""
Write-Host "Build Summary:" -ForegroundColor Cyan
Write-Host "  Frontend: Built from $FrontendDir"
Write-Host "  Backend:  Compiled from $BackendDir"
Write-Host "  Migrations: Bundled from $BackendDir\database\migrations"
Write-Host ""
Write-Host "Done!" -ForegroundColor Cyan
