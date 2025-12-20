# Commands and Activation Reference

Documents all extension commands and activation events.

---

## Commands

The extension contributes three commands accessible via the Command Palette.

### copilot-proxy.start

**Title:** Copilot Proxy: Start Server

**Description:** Starts the HTTP proxy server.

**Behavior:**

1. Reads port from settings
2. Creates HTTP server bound to `127.0.0.1`
3. Loads available models from Copilot
4. Updates status bar and panel
5. Shows success/error notification

**Error Cases:**

- Port already in use: Shows error message
- Server already running: Shows info message

---

### copilot-proxy.stop

**Title:** Copilot Proxy: Stop Server

**Description:** Stops the HTTP proxy server.

**Behavior:**

1. Closes HTTP server
2. Updates status bar and panel
3. Shows success notification

**Error Cases:**

- Server not running: Shows info message

---

### copilot-proxy.status

**Title:** Copilot Proxy: Show Status

**Description:** Opens the status webview panel.

**Behavior:**

1. Refreshes model cache
2. Creates or reveals webview panel
3. Shows:
   - Server status (running/stopped)
   - Available models
   - API endpoints
   - Settings
   - Request logs (if enabled)

---

## Command Registration

Commands are registered in `activate()`:

```typescript
context.subscriptions.push(
    vscode.commands.registerCommand('copilot-proxy.start', startServer),
    vscode.commands.registerCommand('copilot-proxy.stop', stopServer),
    vscode.commands.registerCommand('copilot-proxy.status', showStatus)
);
```

---

## Activation Events

### onStartupFinished

**Location:** `package.json` -> `activationEvents`

```json
{
  "activationEvents": [
    "onStartupFinished"
  ]
}
```

**Description:** Extension activates after VS Code startup completes.

**Behavior:**

1. Creates output channel
2. Creates status bar item
3. Registers commands
4. Sets up model change listener
5. Auto-starts server (if `autoStart: true`)

---

## Extension Lifecycle

### activate(context)

**Called:** When extension activates (onStartupFinished)

**Actions:**

1. Create output channel for logging
2. Create status bar item
3. Register all commands
4. Subscribe to model changes
5. Check autoStart setting
6. Start server if autoStart enabled

**Code:**

```typescript
export function activate(context: vscode.ExtensionContext): void {
    outputChannel = vscode.window.createOutputChannel('Copilot Proxy');
    context.subscriptions.push(outputChannel);
    outputChannel.show(true);

    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right, 100
    );
    statusBarItem.command = 'copilot-proxy.status';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('copilot-proxy.start', startServer),
        vscode.commands.registerCommand('copilot-proxy.stop', stopServer),
        vscode.commands.registerCommand('copilot-proxy.status', showStatus)
    );

    // Listen for model changes
    context.subscriptions.push(
        vscode.lm.onDidChangeChatModels(() => {
            log('Chat models changed, refreshing...');
            refreshModels();
        })
    );

    // Auto-start
    const config = vscode.workspace.getConfiguration('copilotProxy');
    if (config.get<boolean>('autoStart', true)) {
        startServer();
    }
}
```

---

### deactivate()

**Called:** When extension deactivates (VS Code closing)

**Actions:**

1. Close HTTP server
2. Dispose webview panel
3. Log deactivation

**Code:**

```typescript
export function deactivate(): void {
    if (server) {
        server.close();
        server = null;
    }
    if (statusPanel) {
        statusPanel.dispose();
        statusPanel = undefined;
    }
    log('Extension deactivated');
}
```

---

## Status Bar Interaction

The status bar item triggers `copilot-proxy.status` when clicked.

**States:**

| State | Text | Icon |
|-------|------|------|
| Running | `Copilot Proxy: 8080` | `$(radio-tower)` |
| Stopped | `Copilot Proxy: Off` | `$(circle-slash)` |

**Tooltip:**

- Shows running state
- Shows model count
- Shows "Click to show status"

---

## Webview Message Commands

The status panel webview sends these commands:

| Command | Description | Handler Action |
|---------|-------------|----------------|
| `start` | Start server | Call `startServer()` |
| `stop` | Stop server | Call `stopServer()` |
| `copy` | Copy URL | Write to clipboard |
| `showLogs` | Show output | Reveal output channel |
| `openSettings` | Open settings | Execute VS Code command |
| `updateSetting` | Change setting | Update configuration |
| `refreshModels` | Reload models | Call `refreshModels()` |
| `clearLogs` | Clear request logs | Reset log array |

---

## Command Palette Entries

Commands appear in Command Palette with these titles:

- `Copilot Proxy: Start Server`
- `Copilot Proxy: Stop Server`
- `Copilot Proxy: Show Status`

To invoke: `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)

---

**Created:** 2025-12-20
**Last Updated:** 2025-12-20
**Last Updated By:** Claude Code
