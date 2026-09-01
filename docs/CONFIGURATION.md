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
| `allowedOrigins` | array | [] | Explicit CORS origin allowlist (no wildcards) |
| `allowAutoToolExecution` | boolean | false | Gate for proxy-side automatic VS Code tool execution |

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
- Logs are metadata-only (no raw prompt/response content); error entries show a bounded error category rather than raw exception text

---

### copilotProxy.allowedOrigins

**Type:** `array` (of strings)
**Default:** `[]` (empty - no browser origins allowed)

Explicit allowlist of browser origins (e.g., `http://localhost:3000`) permitted to receive CORS headers from the proxy.

**Example:**

```json
{
    "copilotProxy.allowedOrigins": ["http://localhost:3000", "http://127.0.0.1:5173"]
}
```

**Notes:**

- No wildcard (`*`) support - only exact origin strings are matched and echoed back
- If a request's `Origin` header is absent or not present in this list, no `Access-Control-Allow-Origin` header is sent
- Default is empty, meaning no browser-based cross-origin requests are permitted out of the box

---

### copilotProxy.allowAutoToolExecution

**Type:** `boolean`
**Default:** `false`

Gates whether the proxy is permitted to automatically execute VS Code-registered tools server-side when a client requests `tool_execution: "auto"`.

**Example:**

```json
{
    "copilotProxy.allowAutoToolExecution": true
}
```

**Notes:**

- When `false` (default), requests with `tool_execution: "auto"` fall back to pass-through mode - clients cannot self-enable auto-execution via the request body
- When `true`, the proxy will invoke VS Code tools on the client's behalf, bounded by `max_tool_rounds` (1-100)
- Enable only if you trust the tools registered in your VS Code environment, since auto-execution runs with VS Code's own permissions

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
