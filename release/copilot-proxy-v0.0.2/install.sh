#!/bin/bash
# Copilot Proxy - Mac/Linux Installer
# Run: chmod +x install.sh && ./install.sh

set -e

echo ""
echo "========================================"
echo "  Copilot Proxy Installer"
echo "========================================"
echo ""

# Find VS Code command (support both regular and insiders)
CODE_CMD=""
if command -v code &> /dev/null; then
    CODE_CMD="code"
elif command -v code-insiders &> /dev/null; then
    CODE_CMD="code-insiders"
fi

# Check for VS Code
echo "Checking for VS Code..."
if [ -z "$CODE_CMD" ]; then
    echo "ERROR: VS Code not found!"
    echo ""
    echo "Please install VS Code from: https://code.visualstudio.com/"
    echo ""
    exit 1
fi
echo "  VS Code found ($CODE_CMD)"

# Check for GitHub Copilot extension
echo "Checking for GitHub Copilot..."
if ! $CODE_CMD --list-extensions 2>/dev/null | grep -q "GitHub.copilot"; then
    echo "WARNING: GitHub Copilot extension not found!"
    echo ""
    echo "The extension will install, but you need GitHub Copilot to use it."
    echo "Install from: https://marketplace.visualstudio.com/items?itemName=GitHub.copilot"
    echo ""
    read -p "Continue anyway? (y/N) " response
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo "  GitHub Copilot found"
fi

# Find the .vsix file
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VSIX_FILE=$(find "$SCRIPT_DIR" -maxdepth 1 -name "*.vsix" | head -1)

if [ -z "$VSIX_FILE" ]; then
    echo "ERROR: No .vsix file found in the current directory!"
    exit 1
fi

# Install the extension
echo ""
echo "Installing extension..."
$CODE_CMD --install-extension "$VSIX_FILE" --force

echo ""
echo "========================================"
echo "  Installation Complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo "  1. Reload VS Code (Cmd+Shift+P -> 'Reload Window')"
echo "  2. The server starts automatically on port 8080"
echo "  3. Test with: curl http://localhost:8080/health"
echo ""
echo "See QUICKSTART.md for usage examples."
echo ""
