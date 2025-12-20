# Configuration Reference

Complete reference for all VS Code Copilot Proxy settings.

---

## Settings Overview

All settings are prefixed with `copilotProxy.` in VS Code settings.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `port` | number | 8080 | Server port |
| `autoStart` | boolean | true | Start on activation |
| `defaultModel` | string | "" | Default model ID |
| `logRequestsToUI` | boolean | false | Show requests in UI |
| `rawLogging` | boolean | false | Verbose output logging |

---

## Detailed Settings

### copilotProxy.port

**Type:** `number`
**Default:** `8080`
**Range:** 1-65535

The port number the HTTP proxy server listens on.

**Example:**

```json
{
    "copilotProxy.port": 9090
}
```

**Notes:**

- Server binds to `127.0.0.1` (localhost only)
- Changing port requires server restart
- Port conflicts show error notification

---

### copilotProxy.autoStart

**Type:** `boolean`
**Default:** `true`

Automatically start the proxy server when VS Code launches.

**Example:**

```json
{
    "copilotProxy.autoStart": false
}
```

**Notes:**

- Uses `onStartupFinished` activation event
- Can manually start via command palette

---

### copilotProxy.defaultModel

**Type:** `string`
**Default:** `""` (empty - use first available)

Default model to use when not specified in API request.

**Example:**

```json
{
    "copilotProxy.defaultModel": "copilot-gpt-4"
}
```

**Notes:**

- Leave empty to use first available model
- Can be model ID or partial name
- Uses fuzzy matching (e.g., "claude" matches Claude models)

---

### copilotProxy.logRequestsToUI

**Type:** `boolean`
**Default:** `false`

Log all API requests and responses to the status panel UI.

**Example:**

```json
{
    "copilotProxy.logRequestsToUI": true
}
```

**Notes:**

- Shows request logs in status panel table
- Includes: time, model, message count, I/O chars, duration, status
- Maximum 50 entries stored
- Clear logs via panel button

---

### copilotProxy.rawLogging

**Type:** `boolean`
**Default:** `false`

Log raw request/response content to the output channel.

**Example:**

```json
{
    "copilotProxy.rawLogging": true
}
```

**Notes:**

- Very verbose - may impact performance
- Logs full JSON request bodies
- Logs full response content
- Useful for debugging

---

## Internal Constants

These values are defined in code and not configurable via settings.

| Constant | Value | Location | Description |
|----------|-------|----------|-------------|
| `MAX_REQUEST_BODY_SIZE` | 10MB | core.ts | Maximum request size |
| `REQUEST_TIMEOUT_MS` | 120000 (2min) | core.ts | Request timeout |
| `KEEP_ALIVE_TIMEOUT_MS` | 65000 | core.ts | Connection keep-alive |
| `HEADERS_TIMEOUT_MS` | 60000 | core.ts | Headers timeout |
| `MODEL_CACHE_TTL_MS` | 60000 (1min) | core.ts | Model cache TTL |
| `MAX_REQUEST_LOGS` | 50 | extension.ts | Max log entries |

---

## Configuration via package.json

Settings are defined in `package.json` under `contributes.configuration`:

```json
{
  "contributes": {
    "configuration": {
      "title": "Copilot Proxy",
      "properties": {
        "copilotProxy.port": {
          "type": "number",
          "default": 8080,
          "description": "Port number for the proxy server"
        }
        // ... other settings
      }
    }
  }
}
```

---

## Accessing Settings in Code

**Read settings:**

```typescript
const config = vscode.workspace.getConfiguration('copilotProxy');
const port = config.get<number>('port', 8080);
```

**Update settings:**

```typescript
const config = vscode.workspace.getConfiguration('copilotProxy');
await config.update('port', 9090, vscode.ConfigurationTarget.Global);
```

---

## Settings UI

Settings can be modified via:

1. **Settings UI:** `Ctrl+,` -> Search "copilot proxy"
2. **Settings JSON:** `Ctrl+Shift+P` -> "Preferences: Open Settings (JSON)"
3. **Status Panel:** Click settings in the webview panel

---

## Environment-Specific Settings

| Scope | File | Use Case |
|-------|------|----------|
| User | `settings.json` | Personal preferences |
| Workspace | `.vscode/settings.json` | Project-specific |

**Example workspace settings:**

```json
// .vscode/settings.json
{
    "copilotProxy.port": 9090,
    "copilotProxy.autoStart": false
}
```

---

**Created:** 2025-12-20
**Last Updated:** 2025-12-20
**Last Updated By:** Claude Code
