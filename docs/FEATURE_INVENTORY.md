# Feature Inventory

A comprehensive catalog of all features in the VS Code Copilot Proxy extension.

---

## Recently Added

| Date | Feature | Description |
|------|---------|-------------|
| 2025-12-20 | Knowledge Management | Documentation organization and feature discovery system |
| 2025-12-20 | Tool Calling | OpenAI-compatible function/tool calling support (planned) |

---

## Feature Status Legend

| Status | Description |
|--------|-------------|
| Complete | Feature fully implemented and tested |
| In Progress | Feature partially implemented |
| Not Started | Feature planned but not yet started |

---

## Core Features

### Copilot Proxy (Core)

**Status:** Complete
**Location:** `docs/features/copilot-proxy/`

OpenAI-compatible HTTP API server that proxies requests through VS Code's Language Model API (GitHub Copilot).

| Item | Path |
|------|------|
| Design | `docs/features/copilot-proxy/design.md` |
| Tasks | `docs/features/copilot-proxy/TASKS.md` |
| Source | `src/extension.ts`, `src/core.ts` |

**Key Files:**

- `src/extension.ts` - HTTP server, request handlers, webview UI
- `src/core.ts` - Shared utilities, validation, model matching

---

### Webview Status Panel

**Status:** Complete
**Location:** `docs/features/webview-status-panel/`

Rich HTML webview panel for displaying server status, available models, settings, and request logs.

| Item | Path |
|------|------|
| Design | `docs/features/webview-status-panel/design.md` |
| Tasks | `docs/features/webview-status-panel/TASKS.md` |
| Source | `src/extension.ts` (getWebviewContent, showStatus, updateStatusPanel) |

---

### Code Health Refactor

**Status:** Complete
**Location:** `docs/features/code-health-refactor/`

Refactoring effort to improve code organization, extract shared utilities, and add unit testing.

| Item | Path |
|------|------|
| Design | `docs/features/code-health-refactor/design.md` |
| Tasks | `docs/features/code-health-refactor/TASKS.md` |
| Source | `src/core.ts`, `src/test/` |

---

### Security Hardening

**Status:** Complete
**Location:** `docs/features/security-hardening/`

Security improvements including localhost-only CORS, request size limits, timeouts, and XSS prevention.

| Item | Path |
|------|------|
| Design | `docs/features/security-hardening/design.md` |
| Tasks | `docs/features/security-hardening/TASKS.md` |
| Source | `src/core.ts` (getCorsHeaders, isLocalhostOrigin, escapeHtml) |

---

## Planned Features

### Tool Calling

**Status:** Not Started
**Location:** `docs/features/tool-calling/`

OpenAI-compatible function/tool calling support with optional auto-execute mode.

| Item | Path |
|------|------|
| Design | `docs/features/tool-calling/design.md` |
| Tasks | `docs/features/tool-calling/TASKS.md` |
| Source | TBD |

**Phases:**

1. Core Interfaces - Type definitions for tools
2. Tools Endpoint - GET /v1/tools, request handling
3. Response Handling - Tool call responses (streaming/non-streaming)
4. Auto-Execute Mode - Automatic tool invocation
5. Unit Testing
6. Integration Testing
7. E2E Testing
8. Documentation

---

### Knowledge Management

**Status:** In Progress
**Location:** `docs/features/knowledge-management/`

Documentation organization and feature discovery system to prevent duplication and track implementations.

| Item | Path |
|------|------|
| Design | `docs/features/knowledge-management/design.md` |
| Tasks | `docs/features/knowledge-management/TASKS.md` |
| Source | `scripts/check-docs.js`, `scripts/update-inventory.js` |

**Phases:**

1. Foundation - Documentation organization, FEATURE_INVENTORY
2. Automated Checks - Scripts for doc validation
3. Code-Doc Sync - Source-to-doc mapping
4. Extension-Specific - VS Code API and config documentation

---

## File-to-Feature Mapping

### Source Files

| File | Features |
|------|----------|
| `src/extension.ts` | Copilot Proxy, Webview Status Panel |
| `src/core.ts` | Copilot Proxy, Code Health Refactor, Security Hardening |
| `src/test/core.test.ts` | Code Health Refactor |

### Documentation Files

| Directory | Feature |
|-----------|---------|
| `docs/features/copilot-proxy/` | Copilot Proxy |
| `docs/features/webview-status-panel/` | Webview Status Panel |
| `docs/features/code-health-refactor/` | Code Health Refactor |
| `docs/features/security-hardening/` | Security Hardening |
| `docs/features/tool-calling/` | Tool Calling |
| `docs/features/knowledge-management/` | Knowledge Management |

---

## Configuration Reference

See `docs/CONFIGURATION.md` for detailed configuration documentation.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `copilotProxy.port` | number | 8080 | Server port |
| `copilotProxy.autoStart` | boolean | true | Auto-start on activation |
| `copilotProxy.defaultModel` | string | "" | Default model ID |
| `copilotProxy.logRequestsToUI` | boolean | false | Log requests to UI panel |
| `copilotProxy.rawLogging` | boolean | false | Verbose output logging |

---

## Commands

| Command | Title | Description |
|---------|-------|-------------|
| `copilot-proxy.start` | Start Server | Start the HTTP proxy server |
| `copilot-proxy.stop` | Stop Server | Stop the HTTP proxy server |
| `copilot-proxy.status` | Show Status | Open the status webview panel |

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/chat/completions` | Chat completion (streaming/non-streaming) |
| GET | `/v1/models` | List available models |
| GET | `/health` | Health check |

---

## Maintenance

### Adding a New Feature

1. Create `docs/features/<name>/design.md` and `TASKS.md`
2. Add entry to this file under appropriate section
3. Update "Recently Added" section
4. Follow `.claude/task-workflow.md` format

### Completing a Feature

1. Update status in this file
2. Update TASKS.md with completion timestamps
3. Review and update design.md if implementation differed

### Running Documentation Checks

```bash
npm run docs:check      # Validate documentation structure
npm run docs:inventory  # Update feature inventory
```

---

**Created:** 2025-12-20
**Last Updated:** 2025-12-20
**Last Updated By:** Claude Code
