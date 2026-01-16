# Hotel Desktop Application Build Script
# This script builds the complete desktop application bundle

param(
    [switch]$Release,
    [switch]$SkipBackend,
    [switch]$SkipFrontend
)

$ErrorActionPreference = "Stop"
$RootDir = $PSScriptRoot
$BackendDir = Join-Path $RootDir "hotel-app-be"
$DesktopDir = Join-Path $RootDir "hotel-desktop"
$SidecarDir = Join-Path $DesktopDir "src-tauri\binaries"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Hotel Desktop Application Build" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Detect target triple
$target = "x86_64-pc-windows-msvc"
Write-Host "Target: $target" -ForegroundColor Yellow

# Step 1: Build Backend with SQLite
if (-not $SkipBackend) {
    Write-Host ""
    Write-Host "[1/4] Building Backend with SQLite..." -ForegroundColor Green
    Push-Location $BackendDir

    try {
        if ($Release) {
            cargo build --release --no-default-features --features sqlite
        } else {
            cargo build --no-default-features --features sqlite
        }

        # Copy backend binary to sidecar location
        $buildDir = if ($Release) { "release" } else { "debug" }
        $sourceBinary = Join-Path $BackendDir "target\$buildDir\hotel-app-be.exe"
        $destBinary = Join-Path $SidecarDir "hotel-app-be-$target.exe"

        if (-not (Test-Path $SidecarDir)) {
            New-Item -ItemType Directory -Path $SidecarDir -Force | Out-Null
        }

        Copy-Item $sourceBinary $destBinary -Force
        Write-Host "Backend binary copied to: $destBinary" -ForegroundColor Yellow
    }
    finally {
        Pop-Location
    }
} else {
    Write-Host "[1/4] Skipping Backend build" -ForegroundColor Yellow
}

# Step 2: Install Desktop Dependencies
if (-not $SkipFrontend) {
    Write-Host ""
    Write-Host "[2/4] Installing Desktop Dependencies..." -ForegroundColor Green
    Push-Location $DesktopDir

    try {
        npm install
    }
    finally {
        Pop-Location
    }
} else {
    Write-Host "[2/4] Skipping Frontend dependencies" -ForegroundColor Yellow
}

# Step 3: Copy Frontend Code (if not already done)
Write-Host ""
Write-Host "[3/4] Checking Frontend Code..." -ForegroundColor Green
$webFeDir = Join-Path $RootDir "hotel-web-fe\src"
$desktopSrcDir = Join-Path $DesktopDir "src"

# Check if we need to copy the frontend code
$featuresDir = Join-Path $desktopSrcDir "features"
if (-not (Test-Path $featuresDir)) {
    Write-Host "Copying frontend code from hotel-web-fe..." -ForegroundColor Yellow
    # Note: Manual step - copy and adapt the React code
    Write-Host "WARNING: Frontend code needs to be manually copied and adapted from hotel-web-fe" -ForegroundColor Red
    Write-Host "  1. Copy src/features, src/context, src/types, src/utils from hotel-web-fe" -ForegroundColor Yellow
    Write-Host "  2. Update imports to use Vite syntax (import.meta.env instead of process.env)" -ForegroundColor Yellow
    Write-Host "  3. Update API client to use Tauri detection" -ForegroundColor Yellow
} else {
    Write-Host "Frontend code already present" -ForegroundColor Yellow
}

# Step 4: Build Tauri Application
Write-Host ""
Write-Host "[4/4] Building Tauri Application..." -ForegroundColor Green
Push-Location $DesktopDir

try {
    if ($Release) {
        npm run tauri build
    } else {
        npm run tauri build -- --debug
    }
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Build Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan

$installerDir = Join-Path $DesktopDir "src-tauri\target\release\bundle\nsis"
if (Test-Path $installerDir) {
    Write-Host "Installer location: $installerDir" -ForegroundColor Yellow
    Get-ChildItem $installerDir -Filter "*.exe" | ForEach-Object {
        Write-Host "  - $($_.Name)" -ForegroundColor White
    }
}
