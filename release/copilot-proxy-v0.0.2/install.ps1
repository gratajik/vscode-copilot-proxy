# Copilot Proxy - Windows Installer
# Run: powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Copilot Proxy Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check for VS Code
Write-Host "Checking for VS Code..." -ForegroundColor Yellow
$codePath = Get-Command code -ErrorAction SilentlyContinue
if (-not $codePath) {
    Write-Host "ERROR: VS Code not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install VS Code from: https://code.visualstudio.com/" -ForegroundColor White
    Write-Host ""
    exit 1
}
Write-Host "  VS Code found" -ForegroundColor Green

# Check for GitHub Copilot extension
Write-Host "Checking for GitHub Copilot..." -ForegroundColor Yellow
$extensions = code --list-extensions 2>$null
if ($extensions -notcontains "GitHub.copilot") {
    Write-Host "WARNING: GitHub Copilot extension not found!" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "The extension will install, but you need GitHub Copilot to use it." -ForegroundColor White
    Write-Host "Install from: https://marketplace.visualstudio.com/items?itemName=GitHub.copilot" -ForegroundColor White
    Write-Host ""
    $response = Read-Host "Continue anyway? (y/N)"
    if ($response -ne "y" -and $response -ne "Y") {
        exit 1
    }
} else {
    Write-Host "  GitHub Copilot found" -ForegroundColor Green
}

# Find the .vsix file
$vsixFile = Get-ChildItem -Path $PSScriptRoot -Filter "*.vsix" | Select-Object -First 1
if (-not $vsixFile) {
    Write-Host "ERROR: No .vsix file found in the current directory!" -ForegroundColor Red
    exit 1
}

# Install the extension
Write-Host ""
Write-Host "Installing extension..." -ForegroundColor Yellow
code --install-extension "$($vsixFile.FullName)" --force

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to install extension!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Installation Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Reload VS Code (Ctrl+Shift+P -> 'Reload Window')" -ForegroundColor White
Write-Host "  2. The server starts automatically on port 8080" -ForegroundColor White
Write-Host "  3. Test with: curl http://127.0.0.1:8080/health" -ForegroundColor White
Write-Host ""
Write-Host "See QUICKSTART.md for usage examples." -ForegroundColor Yellow
Write-Host ""
