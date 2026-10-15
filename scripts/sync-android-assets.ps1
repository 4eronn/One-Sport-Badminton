$ErrorActionPreference = "Stop"
$rootDir = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $rootDir "android\app\src\main\assets"

if (!(Test-Path $dest)) {
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
}
$vendorDest = Join-Path $dest "vendor"
if (!(Test-Path $vendorDest)) {
    New-Item -ItemType Directory -Path $vendorDest -Force | Out-Null
}

Write-Host "Syncing web assets to $dest..."

$filesToCopy = @(
    "index.html",
    "badminton-service.js",
    "minisoccer.html",
    "manifest.json",
    "sw.js",
    "onesport-home-hero.jpg"
)

foreach ($f in $filesToCopy) {
    $srcPath = Join-Path $rootDir $f
    if (Test-Path $srcPath) {
        Copy-Item -Path $srcPath -Destination $dest -Force
    }
}

Get-ChildItem -Path $rootDir -Filter "logo*.png" | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $dest -Force
}

$vendorSrc = Join-Path $rootDir "vendor"
if (Test-Path $vendorSrc) {
    Copy-Item -Path "$vendorSrc\*" -Destination $vendorDest -Recurse -Force
}

Write-Host "Assets synced successfully."
