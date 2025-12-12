# Rebuild and reinstall the extension
Write-Host "Compiling..." -ForegroundColor Cyan
npm run compile
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "Packaging..." -ForegroundColor Cyan
vsce package --allow-star-activation --allow-missing-repository
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "Installing..." -ForegroundColor Cyan
code --install-extension vscode-copilot-proxy-0.0.1.vsix --force

Write-Host "Done! Reload VS Code window (Ctrl+Shift+P -> 'Reload Window')" -ForegroundColor Green
