# Create Release Package for GitHub
# Run from project root: .\scripts\create-release.ps1

$ErrorActionPreference = "Stop"

# Get version from package.json
$packageJson = Get-Content -Path "package.json" -Raw | ConvertFrom-Json
$version = $packageJson.version
$releaseName = "copilot-proxy-v$version"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Creating Release: $releaseName" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Compile
Write-Host "[1/5] Compiling TypeScript..." -ForegroundColor Yellow
npm run compile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Compilation failed!" -ForegroundColor Red
    exit 1
}
Write-Host "  Done" -ForegroundColor Green

# Step 2: Package extension
Write-Host "[2/5] Packaging extension..." -ForegroundColor Yellow
vsce package --allow-star-activation --allow-missing-repository
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Packaging failed!" -ForegroundColor Red
    exit 1
}
Write-Host "  Done" -ForegroundColor Green

# Step 3: Create release folder
Write-Host "[3/5] Creating release folder..." -ForegroundColor Yellow
$releaseDir = "release\$releaseName"
if (Test-Path $releaseDir) {
    Remove-Item -Recurse -Force $releaseDir
}
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
New-Item -ItemType Directory -Path "$releaseDir\examples" -Force | Out-Null
Write-Host "  Done" -ForegroundColor Green

# Step 4: Copy files
Write-Host "[4/5] Copying files..." -ForegroundColor Yellow

# Copy .vsix
$vsixFile = Get-ChildItem -Filter "*.vsix" | Select-Object -First 1
Copy-Item $vsixFile.FullName -Destination $releaseDir
Write-Host "  - $($vsixFile.Name)"

# Copy install scripts
Copy-Item "dist\install.ps1" -Destination $releaseDir
Write-Host "  - install.ps1"

Copy-Item "dist\install.sh" -Destination $releaseDir
Write-Host "  - install.sh"

# Copy quickstart
Copy-Item "dist\QUICKSTART.md" -Destination $releaseDir
Write-Host "  - QUICKSTART.md"

# Copy examples
Copy-Item "examples\vscode_llm_example_simple.py" -Destination "$releaseDir\examples\"
Write-Host "  - examples\vscode_llm_example_simple.py"

Copy-Item "examples\vscode_llm_example_full.py" -Destination "$releaseDir\examples\"
Write-Host "  - examples\vscode_llm_example_full.py"

Write-Host "  Done" -ForegroundColor Green

# Step 5: Create zip
Write-Host "[5/5] Creating zip file..." -ForegroundColor Yellow
$zipPath = "release\$releaseName.zip"
if (Test-Path $zipPath) {
    Remove-Item -Force $zipPath
}
Compress-Archive -Path $releaseDir -DestinationPath $zipPath
Write-Host "  Done" -ForegroundColor Green

# Summary
$zipSize = (Get-Item $zipPath).Length / 1KB
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Release Created Successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Output: $zipPath" -ForegroundColor Cyan
Write-Host "Size: $([math]::Round($zipSize, 1)) KB" -ForegroundColor Cyan
Write-Host ""
Write-Host "Contents:" -ForegroundColor Yellow
Get-ChildItem -Recurse $releaseDir | ForEach-Object {
    $relativePath = $_.FullName.Replace((Get-Item $releaseDir).FullName, "").TrimStart("\")
    if ($_.PSIsContainer) {
        Write-Host "  $relativePath\" -ForegroundColor Gray
    } else {
        Write-Host "  $relativePath" -ForegroundColor White
    }
}
Write-Host ""
Write-Host "Upload to GitHub Releases:" -ForegroundColor Yellow
Write-Host "  https://github.com/gratajik/vscode-copilot-proxy/releases/new" -ForegroundColor White
Write-Host ""
