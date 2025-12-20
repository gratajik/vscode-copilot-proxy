# VS Code API Reference

Documents all VS Code APIs used by the Copilot Proxy extension.

---

## Language Model API

The extension primarily uses the `vscode.lm` (Language Model) API to interact with GitHub Copilot models.

### vscode.lm.selectChatModels

**Purpose:** Get list of available chat models

**Usage:**

```typescript
const models = await vscode.lm.selectChatModels({});
```

**Returns:** `LanguageModelChat[]` - Array of available models

**Notes:**

- Returns models from GitHub Copilot
- May timeout if Copilot is not ready
- Results are cached for 60 seconds (MODEL_CACHE_TTL_MS)

**Reference:** [VS Code LM API](https://code.visualstudio.com/api/extension-guides/language-model)

---

### vscode.lm.onDidChangeChatModels

**Purpose:** Listen for model availability changes

**Usage:**

```typescript
vscode.lm.onDidChangeChatModels(() => {
    refreshModels();
});
```

**Notes:**

- Fires when models become available/unavailable
- Used to refresh model cache

---

### LanguageModelChat.sendRequest

**Purpose:** Send chat request to a model

**Usage:**

```typescript
const response = await model.sendRequest(
    messages,
    options,
    cancellationToken
);
```

**Parameters:**

- `messages: LanguageModelChatMessage[]` - Conversation history
- `options: LanguageModelChatRequestOptions` - Request options (optional)
- `token: CancellationToken` - For request cancellation

**Returns:** `LanguageModelChatResponse` with async iterable `text` property

---

### LanguageModelChatMessage

**Purpose:** Create chat messages for LM API

**Factory Methods:**

```typescript
LanguageModelChatMessage.User(content)     // Create user message
LanguageModelChatMessage.Assistant(content) // Create assistant message
```

**Notes:**

- No system role in VS Code API
- System messages converted to user messages

---

## Window API

### vscode.window.createOutputChannel

**Purpose:** Create output channel for logging

**Usage:**

```typescript
const outputChannel = vscode.window.createOutputChannel('Copilot Proxy');
outputChannel.appendLine('Log message');
outputChannel.show(true); // preserveFocus
```

---

### vscode.window.createStatusBarItem

**Purpose:** Create status bar item

**Usage:**

```typescript
const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100 // priority
);
statusBarItem.text = '$(radio-tower) Copilot Proxy: 8080';
statusBarItem.command = 'copilot-proxy.status';
statusBarItem.show();
```

**Icons:** Uses [Codicons](https://code.visualstudio.com/api/references/icons-in-labels)

- `$(radio-tower)` - Server running
- `$(circle-slash)` - Server stopped

---

### vscode.window.createWebviewPanel

**Purpose:** Create webview panel for status UI

**Usage:**

```typescript
const panel = vscode.window.createWebviewPanel(
    'copilotProxyStatus',    // viewType
    'Copilot Proxy',         // title
    vscode.ViewColumn.One,   // showColumn
    {
        enableScripts: true,
        retainContextWhenHidden: true
    }
);
panel.webview.html = getWebviewContent();
```

**Message Handling:**

```typescript
panel.webview.onDidReceiveMessage(async (message) => {
    switch (message.command) {
        case 'start': await startServer(); break;
        case 'stop': stopServer(); break;
    }
});
```

---

### vscode.window.showInformationMessage

**Purpose:** Show information notifications

**Usage:**

```typescript
vscode.window.showInformationMessage('Server started on port 8080');
```

---

### vscode.window.showErrorMessage

**Purpose:** Show error notifications

**Usage:**

```typescript
vscode.window.showErrorMessage('Port 8080 is already in use');
```

---

## Workspace API

### vscode.workspace.getConfiguration

**Purpose:** Access extension settings

**Usage:**

```typescript
const config = vscode.workspace.getConfiguration('copilotProxy');
const port = config.get<number>('port', 8080);
const autoStart = config.get<boolean>('autoStart', true);
```

**Update Settings:**

```typescript
await config.update('port', 9090, vscode.ConfigurationTarget.Global);
```

---

## Commands API

### vscode.commands.registerCommand

**Purpose:** Register extension commands

**Usage:**

```typescript
vscode.commands.registerCommand('copilot-proxy.start', startServer);
vscode.commands.registerCommand('copilot-proxy.stop', stopServer);
vscode.commands.registerCommand('copilot-proxy.status', showStatus);
```

---

### vscode.commands.executeCommand

**Purpose:** Execute VS Code commands

**Usage:**

```typescript
vscode.commands.executeCommand('workbench.action.openSettings', 'copilotProxy');
```

---

## Environment API

### vscode.env.clipboard

**Purpose:** Access clipboard

**Usage:**

```typescript
await vscode.env.clipboard.writeText('http://127.0.0.1:8080/v1/chat/completions');
```

---

## Cancellation API

### vscode.CancellationTokenSource

**Purpose:** Create cancellation tokens for async operations

**Usage:**

```typescript
const source = new vscode.CancellationTokenSource();
const timeoutId = setTimeout(() => source.cancel(), 300000);

try {
    const response = await model.sendRequest(messages, {}, source.token);
    // process response
} finally {
    clearTimeout(timeoutId);
    source.dispose();
}
```

---

## Extension Context

### ExtensionContext

**Purpose:** Extension lifecycle management

**Properties Used:**

- `context.subscriptions` - Disposables cleanup
- `context.extension.packageJSON.version` - Extension version

**Usage:**

```typescript
export function activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(outputChannel);
    context.subscriptions.push(statusBarItem);
    context.subscriptions.push(
        vscode.commands.registerCommand('copilot-proxy.start', startServer)
    );
}
```

---

## API Limitations

### Language Model API Limitations

| Limitation | Impact | Workaround |
|------------|--------|------------|
| No system role | System messages treated as user | Convert to user messages |
| No token counts | Can't report usage | Estimate from character count |
| No temperature control | Parameter ignored | Accept but don't forward |
| No max_tokens control | Parameter ignored | Accept but don't forward |
| No function calling (yet) | Tool calling not supported | Planned for future |

---

## References

- [VS Code Extension API](https://code.visualstudio.com/api)
- [VS Code LM API Guide](https://code.visualstudio.com/api/extension-guides/language-model)
- [Webview API Guide](https://code.visualstudio.com/api/extension-guides/webview)

---

**Created:** 2025-12-20
**Last Updated:** 2025-12-20
**Last Updated By:** Claude Code
